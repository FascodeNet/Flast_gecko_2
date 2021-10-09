/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

const EXPORTED_SYMBOLS = ["UrlbarQuickSuggest", "KeywordTree"];

const { XPCOMUtils } = ChromeUtils.import(
  "resource://gre/modules/XPCOMUtils.jsm"
);

const { Services } = ChromeUtils.import("resource://gre/modules/Services.jsm");

XPCOMUtils.defineLazyModuleGetters(this, {
  BrowserWindowTracker: "resource:///modules/BrowserWindowTracker.jsm",
  RemoteSettings: "resource://services-settings/remote-settings.js",
  UrlbarPrefs: "resource:///modules/UrlbarPrefs.jsm",
  NimbusFeatures: "resource://nimbus/ExperimentAPI.jsm",
  UrlbarProviderQuickSuggest:
    "resource:///modules/UrlbarProviderQuickSuggest.jsm",
});

XPCOMUtils.defineLazyGlobalGetters(this, ["TextDecoder"]);

const log = console.createInstance({
  prefix: "QuickSuggest",
  maxLogLevel: UrlbarPrefs.get("quicksuggest.log") ? "All" : "Warn",
});

const RS_COLLECTION = "quicksuggest";

// Categories that should show "Firefox Suggest" instead of "Sponsored"
const NONSPONSORED_IAB_CATEGORIES = new Set(["5 - Education"]);

const FEATURE_AVAILABLE = "quickSuggestEnabled";
const SEEN_DIALOG_PREF = "quicksuggest.showedOnboardingDialog";
const RESTARTS_PREF = "quicksuggest.seenRestarts";

// This is a score in the range [0, 1] used by the provider to compare
// suggestions from remote settings to suggestions from Merino. Remote settings
// suggestions don't have a natural score so we hardcode a value, and we choose
// a low value to allow Merino to experiment with a broad range of scores.
const SUGGESTION_SCORE = 0.2;

/**
 * Fetches the suggestions data from RemoteSettings and builds the tree
 * to provide suggestions for UrlbarProviderQuickSuggest.
 */
class Suggestions {
  // The RemoteSettings client.
  _rs = null;
  // Let tests wait for init to complete.
  _initPromise = null;
  // Resolver function stored to call when init is complete.
  _initResolve = null;
  // A tree that maps keywords to a result.
  _tree = new KeywordTree();
  // A map of the result data.
  _results = new Map();

  async init() {
    if (this._initPromise) {
      return this._initPromise;
    }
    this._initPromise = Promise.resolve();
    if (UrlbarPrefs.get(FEATURE_AVAILABLE)) {
      this._initPromise = new Promise(resolve => (this._initResolve = resolve));
      Services.tm.idleDispatchToMainThread(this.onEnabledUpdate.bind(this));
    } else {
      NimbusFeatures.urlbar.onUpdate(this.onEnabledUpdate.bind(this));
    }
    UrlbarPrefs.addObserver(this);
    return this._initPromise;
  }

  /*
   * Handle queries from the Urlbar.
   */
  async query(phrase) {
    log.info("Handling query for", phrase);
    phrase = phrase.toLowerCase();
    let resultID = this._tree.get(phrase);
    if (resultID === null) {
      return null;
    }
    let result = this._results.get(resultID);
    if (!result) {
      return null;
    }
    let d = new Date();
    let pad = number => number.toString().padStart(2, "0");
    let date =
      `${d.getFullYear()}${pad(d.getMonth() + 1)}` +
      `${pad(d.getDate())}${pad(d.getHours())}`;
    let icon = await this.fetchIcon(result.icon);
    return {
      full_keyword: this.getFullKeyword(phrase, result.keywords),
      title: result.title,
      url: result.url.replace("%YYYYMMDDHH%", date),
      click_url: result.click_url.replace("%YYYYMMDDHH%", date),
      // impression_url doesn't have any parameters
      impression_url: result.impression_url,
      block_id: result.id,
      advertiser: result.advertiser.toLocaleLowerCase(),
      is_sponsored: !NONSPONSORED_IAB_CATEGORIES.has(result.iab_category),
      score: SUGGESTION_SCORE,
      icon,
    };
  }

  /**
   * Gets the full keyword (i.e., suggestion) for a result and query.  The data
   * doesn't include full keywords, so we make our own based on the result's
   * keyword phrases and a particular query.  We use two heuristics:
   *
   * (1) Find the first keyword phrase that has more words than the query.  Use
   *     its first `queryWords.length` words as the full keyword.  e.g., if the
   *     query is "moz" and `result.keywords` is ["moz", "mozi", "mozil",
   *     "mozill", "mozilla", "mozilla firefox"], pick "mozilla firefox", pop
   *     off the "firefox" and use "mozilla" as the full keyword.
   * (2) If there isn't any keyword phrase with more words, then pick the
   *     longest phrase.  e.g., pick "mozilla" in the previous example (assuming
   *     the "mozilla firefox" phrase isn't there).  That might be the query
   *     itself.
   *
   * @param {string} query
   *   The query string that matched `result`.
   * @param {array} keywords
   *   An array of result keywords.
   * @returns {string}
   *   The full keyword.
   */
  getFullKeyword(query, keywords) {
    let longerPhrase;
    let trimmedQuery = query.trim();
    let queryWords = trimmedQuery.split(" ");

    for (let phrase of keywords) {
      if (phrase.startsWith(query)) {
        let trimmedPhrase = phrase.trim();
        let phraseWords = trimmedPhrase.split(" ");
        // As an exception to (1), if the query ends with a space, then look for
        // phrases with one more word so that the suggestion includes a word
        // following the space.
        let extra = query.endsWith(" ") ? 1 : 0;
        let len = queryWords.length + extra;
        if (len < phraseWords.length) {
          // We found a phrase with more words.
          return phraseWords.slice(0, len).join(" ");
        }
        if (
          query.length < phrase.length &&
          (!longerPhrase || longerPhrase.length < trimmedPhrase.length)
        ) {
          // We found a longer phrase with the same number of words.
          longerPhrase = trimmedPhrase;
        }
      }
    }
    return longerPhrase || trimmedQuery;
  }

  /**
   * Called when a urlbar pref changes. The onboarding dialog will set the
   * `browser.urlbar.suggest.quicksuggest` prefs if the user has opted in, at
   * which point we can start showing results.
   *
   * @param {string} pref
   *   The name of the pref relative to `browser.urlbar`.
   */
  onPrefChanged(pref) {
    switch (pref) {
      // Both sponsored and non-sponsored results come from the same remote
      // settings dataset, so we only need to listen for `suggest.quicksuggest`
      // and not also `suggest.quicksuggest.sponsored`.
      case "suggest.quicksuggest":
        this.onEnabledUpdate();
        break;
    }
  }

  /*
   * Called when an update that may change whether this feature is enabled
   * or not has occured.
   *
   * Quick suggest is controlled by the following preferences. All three must be
   * enabled to show sponsored results. The first two must be enabled to show
   * non-sponsored results.
   *
   * * `quicksuggest.enabled`: The global toggle for the entire quick suggest
   *   feature. This pref can be overridden by the `quickSuggestEnabled` Nimbus
   *   variable. If false, neither sponsored nor non-sponsored suggestions will
   *   be shown. If true, then we look at the individual prefs
   *   `suggest.quicksuggest` and `suggest.quicksuggest.sponsored`.
   *
   * * `suggest.quicksuggest`: Whether any quick suggest results are shown. This
   *    must be true to show both non-sponsored and sponsored results.
   *
   * * `suggest.quicksuggest.sponsored`: Whether sponsored quick suggest results
   *    are shown. Both this pref and `suggest.quicksuggest` must be true to
   *    show sponsored results.
   */
  onEnabledUpdate() {
    if (
      UrlbarPrefs.get(FEATURE_AVAILABLE) &&
      UrlbarPrefs.get("suggest.quicksuggest")
    ) {
      this._setupRemoteSettings();
    }
  }

  /*
   * An onboarding dialog can be shown to the users who are enrolled into
   * the QuickSuggest experiments or rollouts. This behavior is controlled
   * by the pref `browser.urlbar.quicksuggest.shouldShowOnboardingDialog`
   * which can be remotely configured by Nimbus.
   *
   * Given that the release may overlap with another onboarding dialog, we may
   * wait for a few restarts before showing the QuickSuggest dialog. This can
   * be remotely configured by Nimbus through
   * `quickSuggestShowOnboardingDialogAfterNRestarts`, the default is 0.
   */
  async maybeShowOnboardingDialog() {
    // If quicksuggest is not available, the onboarding dialog is configured to
    // be skipped, the user has already seen the dialog, or has otherwise opted
    // in already, then we won't show the quicksuggest onboarding.
    if (
      !UrlbarPrefs.get(FEATURE_AVAILABLE) ||
      !UrlbarPrefs.get("quickSuggestShouldShowOnboardingDialog") ||
      UrlbarPrefs.get(SEEN_DIALOG_PREF) ||
      UrlbarPrefs.get("suggest.quicksuggest") ||
      UrlbarPrefs.get("suggest.quicksuggest.sponsored")
    ) {
      return;
    }

    // Wait a number of restarts after the user will have seen the mr1 onboarding dialog
    // before showing the quicksuggest one.
    let restartsSeen = UrlbarPrefs.get(RESTARTS_PREF);
    if (
      restartsSeen <
      UrlbarPrefs.get("quickSuggestShowOnboardingDialogAfterNRestarts")
    ) {
      UrlbarPrefs.set(RESTARTS_PREF, restartsSeen + 1);
      return;
    }

    let params = { accept: false, openSettings: false, learnMore: false };
    let win = BrowserWindowTracker.getTopWindow();
    await win.gDialogBox.open(
      "chrome://browser/content/urlbar/quicksuggestOnboarding.xhtml",
      params
    );

    UrlbarPrefs.set(SEEN_DIALOG_PREF, true);

    let telemetryEventObject;
    if (params.accept) {
      // Opting in enables both non-sponsored and sponsored results.
      UrlbarPrefs.set("suggest.quicksuggest", true);
      UrlbarPrefs.set("suggest.quicksuggest.sponsored", true);
      telemetryEventObject = "accept";
    } else if (params.openSettings) {
      win.openPreferences("privacy-locationBar");
      telemetryEventObject = "settings";
    } else if (params.learnMore) {
      win.openTrustedLinkIn(UrlbarProviderQuickSuggest.helpUrl, "tab", {
        fromChrome: true,
      });
      telemetryEventObject = "learn_more";
    } else {
      telemetryEventObject = "not_now";
    }

    Services.telemetry.recordEvent(
      "contextservices.quicksuggest",
      "opt_in_dialog",
      telemetryEventObject
    );
  }

  /*
   * Set up RemoteSettings listeners.
   */
  async _setupRemoteSettings() {
    this._rs = RemoteSettings(RS_COLLECTION);
    this._rs.on("sync", this._onSettingsSync.bind(this));
    await this._ensureAttachmentsDownloaded();
    if (this._initResolve) {
      this._initResolve();
      this._initResolve = null;
    }
  }

  /*
   * Called when RemoteSettings updates are received.
   */
  async _onSettingsSync({ data: { deleted } }) {
    const toDelete = deleted?.filter(d => d.attachment);
    // Remove local files of deleted records
    if (toDelete) {
      await Promise.all(
        toDelete.map(entry => this._rs.attachments.delete(entry))
      );
    }
    await this._ensureAttachmentsDownloaded();
  }

  /*
   * We store our RemoteSettings data in attachments, ensure the attachments
   * are saved locally.
   */
  async _ensureAttachmentsDownloaded() {
    // Make sure we don't re-enter this method, which can happen due to a cycle
    // created by our remote settings sync listener as follows:
    //
    // Pref change -> onPrefChanged -> onEnabledUpdate -> _setupRemoteSettings
    // -> _ensureAttachmentsDownloaded -> this._rs.get -> RemoteSettingsClient
    // calls sync on itself -> RemoteSettingsClient emits a sync event ->
    // _onSettingsSync -> _ensureAttachmentsDownloaded
    //
    // Because RemoteSettingsClient awaits when it emits its sync event, we get
    // a deadlock in that call stack. Quick suggest will not be able to complete
    // initialization and return suggestions until something else causes it to
    // fetch the data again. Restarting the app also fixes it because it seems
    // RemoteSettingsClient takes a different code path on initialization after
    // restart, presumably because the data was successfully downloaded and
    // cached before the deadlock.
    if (this._ensureAttachmentsDownloadedRunning) {
      return;
    }
    this._ensureAttachmentsDownloadedRunning = true;
    try {
      await this._ensureAttachmentsDownloadedHelper();
    } finally {
      this._ensureAttachmentsDownloadedRunning = false;
    }
  }

  async _ensureAttachmentsDownloadedHelper() {
    log.info("_ensureAttachmentsDownloaded started");
    let dataOpts = { useCache: true };
    let data = await this._rs.get({ filters: { type: "data" } });
    await Promise.all(
      data.map(r => this._rs.attachments.download(r, dataOpts))
    );

    let icons = await this._rs.get({ filters: { type: "icon" } });
    await Promise.all(icons.map(r => this._rs.attachments.download(r)));

    await this._createTree();
    log.info("_ensureAttachmentsDownloaded complete");
  }

  /*
   * Recreate the KeywordTree on startup or with RemoteSettings updates.
   */
  async _createTree() {
    log.info("Building new KeywordTree");
    this._results = new Map();
    this._tree = new KeywordTree();
    let data = await this._rs.get({ filters: { type: "data" } });

    for (let record of data) {
      let { buffer } = await this._rs.attachments.download(record, {
        useCache: true,
      });
      let json = JSON.parse(new TextDecoder("utf-8").decode(buffer));
      this._processSuggestionsJSON(json);
    }
  }

  /*
   * Handle incoming suggestions data and add to local data.
   */
  async _processSuggestionsJSON(json) {
    for (let result of json) {
      this._results.set(result.id, result);
      for (let keyword of result.keywords) {
        this._tree.set(keyword, result.id);
      }
    }
  }

  /*
   * Fetch the icon from RemoteSettings attachments.
   */
  async fetchIcon(path) {
    if (!path) {
      return null;
    }
    let record = (
      await this._rs.get({
        filters: { id: `icon-${path}` },
      })
    ).pop();
    if (!record) {
      return null;
    }
    return this._rs.attachments.download(record);
  }
}

// Token used as a key to store results within the Map, cannot be used
// within a keyword.
const RESULT_KEY = "^";

/**
 * This is an implementation of a Map based Tree. We can store
 * multiple keywords that point to a single term, for example:
 *
 *   tree.add("headphones", "headphones");
 *   tree.add("headph", "headphones");
 *   tree.add("earphones", "headphones");
 *
 *   tree.get("headph") == "headphones"
 *
 * The tree can store multiple prefixes to a term efficiently
 * so ["hea", "head", "headp", "headph", "headpho", ...] wont lead
 * to duplication in memory. The tree will only return a result
 * for keywords that have been explcitly defined and not attempt
 * to guess based on prefix.
 *
 * Once a tree have been build, it can be flattened with `.flatten`
 * the tree can then be serialised and deserialised with `.toJSON`
 * and `.fromJSON`.
 */
class KeywordTree {
  constructor() {
    this.tree = new Map();
  }

  static get SUGGESTION_SCORE() {
    return SUGGESTION_SCORE;
  }

  /*
   * Set a keyword for a result.
   */
  set(keyword, id) {
    if (keyword.includes(RESULT_KEY)) {
      throw new Error(`"${RESULT_KEY}" is reserved`);
    }
    let tree = this.tree;
    for (let x = 0, c = ""; (c = keyword.charAt(x)); x++) {
      let child = tree.get(c) || new Map();
      tree.set(c, child);
      tree = child;
    }
    tree.set(RESULT_KEY, id);
  }

  /**
   * Get the result for a given phrase.
   *
   * @param {string} query
   *   The query string.
   * @returns {*}
   *   The matching result in the tree or null if there isn't a match.
   */
  get(query) {
    query = query.trimStart() + RESULT_KEY;
    let node = this.tree;
    let phrase = "";
    while (phrase.length < query.length) {
      // First, assume the tree isn't flattened and try to look up the next char
      // in the query.
      let key = query[phrase.length];
      let child = node.get(key);
      if (!child) {
        // Not found, so fall back to looking through all of the node's keys.
        key = null;
        for (let childKey of node.keys()) {
          let childPhrase = phrase + childKey;
          if (childPhrase == query.substring(0, childPhrase.length)) {
            key = childKey;
            break;
          }
        }
        if (!key) {
          return null;
        }
        child = node.get(key);
      }
      node = child;
      phrase += key;
    }
    if (phrase.length != query.length) {
      return null;
    }
    // At this point, `node` is the found result.
    return node;
  }

  /*
   * We flatten the tree by combining consecutive single branch keywords
   * with the same results into a longer keyword. so ["a", ["b", ["c"]]]
   * becomes ["abc"], we need to be careful that the result matches so
   * if a prefix search for "hello" only starts after 2 characters it will
   * be flattened to ["he", ["llo"]].
   */
  flatten() {
    this._flatten("", this.tree, null);
  }

  /**
   * Recursive flatten() helper.
   *
   * @param {string} key
   *   The key for `node` in `parent`.
   * @param {Map} node
   *   The currently visited node.
   * @param {Map} parent
   *   The parent of `node`, or null if `node` is the root.
   */
  _flatten(key, node, parent) {
    // Flatten the node's children.  We need to store node.entries() in an array
    // rather than iterating over them directly because _flatten() can modify
    // them during iteration.
    for (let [childKey, child] of [...node.entries()]) {
      if (childKey != RESULT_KEY) {
        this._flatten(childKey, child, node);
      }
    }
    // If the node has a single child, then replace the node in `parent` with
    // the child.
    if (node.size == 1 && parent) {
      parent.delete(key);
      let childKey = [...node.keys()][0];
      parent.set(key + childKey, node.get(childKey));
    }
  }

  /*
   * Turn a tree into a serialisable JSON object.
   */
  toJSONObject(map = this.tree) {
    let tmp = {};
    for (let [key, val] of map) {
      if (val instanceof Map) {
        tmp[key] = this.toJSONObject(val);
      } else {
        tmp[key] = val;
      }
    }
    return tmp;
  }

  /*
   * Build a tree from a serialisable JSON object that was built
   * with `toJSON`.
   */
  fromJSON(json) {
    this.tree = this.JSONObjectToMap(json);
  }

  JSONObjectToMap(obj) {
    let map = new Map();
    for (let key of Object.keys(obj)) {
      if (typeof obj[key] == "object") {
        map.set(key, this.JSONObjectToMap(obj[key]));
      } else {
        map.set(key, obj[key]);
      }
    }
    return map;
  }
}

let UrlbarQuickSuggest = new Suggestions();
UrlbarQuickSuggest.init();
