/* Any copyright is dedicated to the Public Domain.
 * http://creativecommons.org/publicdomain/zero/1.0/ */

/**
 * This file tests urlbar telemetry for Quick Suggest results.
 */

"use strict";

XPCOMUtils.defineLazyModuleGetters(this, {
  CONTEXTUAL_SERVICES_PING_TYPES:
    "resource:///modules/PartnerLinkAttribution.jsm",
  PartnerLinkAttribution: "resource:///modules/PartnerLinkAttribution.jsm",
  TelemetryEnvironment: "resource://gre/modules/TelemetryEnvironment.jsm",
  UrlbarProviderQuickSuggest:
    "resource:///modules/UrlbarProviderQuickSuggest.jsm",
  UrlbarQuickSuggest: "resource:///modules/UrlbarQuickSuggest.jsm",
  NimbusFeatures: "resource://nimbus/ExperimentAPI.jsm",
});

const TEST_SJS =
  "http://mochi.test:8888/browser/browser/components/urlbar/tests/browser/quicksuggest.sjs";
const TEST_URL = TEST_SJS + "?q=frabbits";
const TEST_SEARCH_STRING = "frab";
const TEST_DATA = [
  {
    id: 1,
    url: TEST_URL,
    title: "frabbits",
    keywords: [TEST_SEARCH_STRING],
    click_url: "http://click.reporting.test.com/",
    impression_url: "http://impression.reporting.test.com/",
    advertiser: "Test-Advertiser",
  },
];

const TEST_HELP_URL = "http://example.com/help";

const TELEMETRY_SCALARS = {
  IMPRESSION: "contextual.services.quicksuggest.impression",
  CLICK: "contextual.services.quicksuggest.click",
  HELP: "contextual.services.quicksuggest.help",
};

const TELEMETRY_EVENT_CATEGORY = "contextservices.quicksuggest";

const EXPERIMENT_PREF = "browser.urlbar.quicksuggest.enabled";
const SUGGEST_PREF = "suggest.quicksuggest";

const DEFAULT_SCENARIO = UrlbarPrefs.get("quicksuggest.scenario");

// Spy for the custom impression/click sender
let spy;

add_task(async function init() {
  sandbox = sinon.createSandbox();
  spy = sandbox.spy(
    PartnerLinkAttribution._pingCentre,
    "sendStructuredIngestionPing"
  );

  await PlacesUtils.history.clear();
  await PlacesUtils.bookmarks.eraseEverything();
  await UrlbarTestUtils.formHistory.clear();

  // Add a mock engine so we don't hit the network.
  await SearchTestUtils.installSearchExtension();
  let oldDefaultEngine = await Services.search.getDefault();
  Services.search.setDefault(Services.search.getEngineByName("Example"));

  // Set up Quick Suggest.
  await UrlbarTestUtils.ensureQuickSuggestInit(TEST_DATA);
  UrlbarProviderQuickSuggest._helpUrl = TEST_HELP_URL;

  // Enable local telemetry recording for the duration of the test.
  let oldCanRecord = Services.telemetry.canRecordExtended;
  Services.telemetry.canRecordExtended = true;

  Services.telemetry.clearScalars();

  registerCleanupFunction(async () => {
    sandbox.restore();
    Services.search.setDefault(oldDefaultEngine);
    Services.telemetry.canRecordExtended = oldCanRecord;
    delete UrlbarProviderQuickSuggest._helpUrl;
  });
});

// Tests the impression scalar and the custom impression ping.
add_task(async function impression() {
  await BrowserTestUtils.withNewTab("about:blank", async () => {
    await UrlbarTestUtils.promiseAutocompleteResultPopup({
      window,
      value: TEST_SEARCH_STRING,
      fireInputEvent: true,
    });
    let index = 1;
    await assertIsQuickSuggest(index);
    await UrlbarTestUtils.promisePopupClose(window, () => {
      EventUtils.synthesizeKey("KEY_Enter");
    });
    assertScalars({ [TELEMETRY_SCALARS.IMPRESSION]: index + 1 });
    assertCustomImpression(index);
  });
  await PlacesUtils.history.clear();
});

// Tests the impression scalar and the custom impression ping for "online" scenario.
add_task(async function impression_online() {
  await UrlbarTestUtils.withExperiment({
    valueOverrides: {
      // Make sure Merino is disabled so we don't hit the network.
      merinoEnabled: false,
      quickSuggestScenario: "online",
      quickSuggestShouldShowOnboardingDialog: false,
    },
    callback: async () => {
      spy.resetHistory();
      UrlbarPrefs.set("suggest.quicksuggest", true);
      UrlbarPrefs.set("suggest.quicksuggest.sponsored", true);
      await BrowserTestUtils.withNewTab("about:blank", async () => {
        await UrlbarTestUtils.promiseAutocompleteResultPopup({
          window,
          value: TEST_SEARCH_STRING,
          fireInputEvent: true,
        });
        let index = 1;
        await assertIsQuickSuggest(index);
        await UrlbarTestUtils.promisePopupClose(window, () => {
          EventUtils.synthesizeKey("KEY_Enter");
        });
        assertScalars({ [TELEMETRY_SCALARS.IMPRESSION]: index + 1 });
        assertCustomImpression(index, "online");
      });
      await PlacesUtils.history.clear();
    },
  });
});

// Makes sure the impression scalar and the custom impression are not incremented
// when the urlbar engagement is abandoned.
add_task(async function noImpression_abandonment() {
  await BrowserTestUtils.withNewTab("about:blank", async () => {
    spy.resetHistory();
    await UrlbarTestUtils.promiseAutocompleteResultPopup({
      window,
      value: TEST_SEARCH_STRING,
      fireInputEvent: true,
    });
    await assertIsQuickSuggest();
    await UrlbarTestUtils.promisePopupClose(window, () => {
      gURLBar.blur();
    });
    assertScalars({});
    assertNoCustomImpression();
  });
});

// Makes sure the impression scalar and the custom impression are not incremented
// when a Quick Suggest result is not present.
add_task(async function noImpression_noQuickSuggestResult() {
  await BrowserTestUtils.withNewTab("about:blank", async () => {
    spy.resetHistory();
    await UrlbarTestUtils.promiseAutocompleteResultPopup({
      window,
      value: "noImpression_noQuickSuggestResult",
      fireInputEvent: true,
    });
    await assertNoQuickSuggestResults();
    await UrlbarTestUtils.promisePopupClose(window, () => {
      EventUtils.synthesizeKey("KEY_Enter");
    });
    assertScalars({});
    assertNoCustomImpression();
  });
  await PlacesUtils.history.clear();
});

// Tests the click scalar and the custom click ping by picking a Quick Suggest
// result with the keyboard.
add_task(async function click_keyboard() {
  await BrowserTestUtils.withNewTab("about:blank", async () => {
    spy.resetHistory();
    await UrlbarTestUtils.promiseAutocompleteResultPopup({
      window,
      value: TEST_SEARCH_STRING,
      fireInputEvent: true,
    });
    let index = 1;
    await assertIsQuickSuggest(index);
    await UrlbarTestUtils.promisePopupClose(window, () => {
      EventUtils.synthesizeKey("KEY_ArrowDown");
      EventUtils.synthesizeKey("KEY_Enter");
    });
    assertScalars({
      [TELEMETRY_SCALARS.IMPRESSION]: index + 1,
      [TELEMETRY_SCALARS.CLICK]: index + 1,
    });
    assertCustomClick(index);
  });
  await PlacesUtils.history.clear();
});

// Tests the click scalar and the custom click ping by picking a Quick Suggest
// result with the mouse.
add_task(async function click_mouse() {
  await BrowserTestUtils.withNewTab("about:blank", async () => {
    spy.resetHistory();
    await UrlbarTestUtils.promiseAutocompleteResultPopup({
      window,
      value: TEST_SEARCH_STRING,
      fireInputEvent: true,
    });
    let index = 1;
    let result = await assertIsQuickSuggest(index);
    await UrlbarTestUtils.promisePopupClose(window, () => {
      EventUtils.synthesizeMouseAtCenter(result.element.row, {});
    });
    assertScalars({
      [TELEMETRY_SCALARS.IMPRESSION]: index + 1,
      [TELEMETRY_SCALARS.CLICK]: index + 1,
    });
    assertCustomClick(index);
  });
  await PlacesUtils.history.clear();
});

// Tests the impression and click scalars and the custom click ping by picking a
// Quick Suggest result when it's shown before search suggestions.
add_task(async function click_beforeSearchSuggestions() {
  await SpecialPowers.pushPrefEnv({
    set: [["browser.urlbar.showSearchSuggestionsFirst", false]],
  });
  await BrowserTestUtils.withNewTab("about:blank", async () => {
    await withSuggestions(async () => {
      spy.resetHistory();
      await UrlbarTestUtils.promiseAutocompleteResultPopup({
        window,
        value: TEST_SEARCH_STRING,
        fireInputEvent: true,
      });
      let resultCount = UrlbarTestUtils.getResultCount(window);
      Assert.greaterOrEqual(
        resultCount,
        4,
        "Result count >= 1 heuristic + 1 quick suggest + 2 suggestions"
      );
      let index = resultCount - 3;
      await assertIsQuickSuggest(index);
      await UrlbarTestUtils.promisePopupClose(window, () => {
        EventUtils.synthesizeKey("KEY_ArrowDown", { repeat: index });
        EventUtils.synthesizeKey("KEY_Enter");
      });
      assertScalars({
        [TELEMETRY_SCALARS.IMPRESSION]: index + 1,
        [TELEMETRY_SCALARS.CLICK]: index + 1,
      });
      assertCustomClick(index);
    });
  });
  await PlacesUtils.history.clear();
  await SpecialPowers.popPrefEnv();
});

// Tests the help scalar by picking a Quick Suggest result help button with the
// keyboard.
add_task(async function help_keyboard() {
  spy.resetHistory();
  await UrlbarTestUtils.promiseAutocompleteResultPopup({
    window,
    value: TEST_SEARCH_STRING,
    fireInputEvent: true,
  });
  let index = 1;
  let result = await assertIsQuickSuggest(index);
  let helpButton = result.element.row._elements.get("helpButton");
  Assert.ok(helpButton, "The result has a help button");
  let helpLoadPromise = BrowserTestUtils.waitForNewTab(gBrowser);
  await UrlbarTestUtils.promisePopupClose(window, () => {
    EventUtils.synthesizeKey("KEY_ArrowDown", { repeat: 2 });
    EventUtils.synthesizeKey("KEY_Enter");
  });
  await helpLoadPromise;
  Assert.equal(gBrowser.currentURI.spec, TEST_HELP_URL, "Help URL loaded");
  assertScalars({
    [TELEMETRY_SCALARS.IMPRESSION]: index + 1,
    [TELEMETRY_SCALARS.HELP]: index + 1,
  });
  assertNoCustomClick();
  BrowserTestUtils.removeTab(gBrowser.selectedTab);
  await PlacesUtils.history.clear();
});

// Tests the help scalar by picking a Quick Suggest result help button with the
// mouse.
add_task(async function help_mouse() {
  spy.resetHistory();
  await UrlbarTestUtils.promiseAutocompleteResultPopup({
    window,
    value: TEST_SEARCH_STRING,
    fireInputEvent: true,
  });
  let index = 1;
  let result = await assertIsQuickSuggest(index);
  let helpButton = result.element.row._elements.get("helpButton");
  Assert.ok(helpButton, "The result has a help button");
  let helpLoadPromise = BrowserTestUtils.waitForNewTab(gBrowser);
  await UrlbarTestUtils.promisePopupClose(window, () => {
    EventUtils.synthesizeMouseAtCenter(helpButton, {});
  });
  await helpLoadPromise;
  Assert.equal(gBrowser.currentURI.spec, TEST_HELP_URL, "Help URL loaded");
  assertScalars({
    [TELEMETRY_SCALARS.IMPRESSION]: index + 1,
    [TELEMETRY_SCALARS.HELP]: index + 1,
  });
  assertNoCustomClick();
  BrowserTestUtils.removeTab(gBrowser.selectedTab);
  await PlacesUtils.history.clear();
});

// Tests telemetry recorded when toggling the `suggest.quicksuggest` pref:
// * contextservices.quicksuggest enable_toggled event telemetry
// * TelemetryEnvironment
add_task(async function enableToggled() {
  Services.telemetry.clearEvents();

  // Toggle the suggest.quicksuggest pref twice.  We should get two events.
  let enabled = UrlbarPrefs.get(SUGGEST_PREF);
  for (let i = 0; i < 2; i++) {
    enabled = !enabled;
    UrlbarPrefs.set(SUGGEST_PREF, enabled);
    TelemetryTestUtils.assertEvents([
      {
        category: TELEMETRY_EVENT_CATEGORY,
        method: "enable_toggled",
        object: enabled ? "enabled" : "disabled",
      },
    ]);
    Assert.equal(
      TelemetryEnvironment.currentEnvironment.settings.userPrefs[
        "browser.urlbar.suggest.quicksuggest"
      ],
      enabled,
      "suggest.quicksuggest is correct in TelemetryEnvironment"
    );
  }

  // Set the main quicksuggest.enabled pref to false and toggle the
  // suggest.quicksuggest pref again.  We shouldn't get any events.
  await SpecialPowers.pushPrefEnv({
    set: [[EXPERIMENT_PREF, false]],
  });
  enabled = !enabled;
  UrlbarPrefs.set(SUGGEST_PREF, enabled);
  TelemetryTestUtils.assertEvents([], { category: TELEMETRY_EVENT_CATEGORY });
  await SpecialPowers.popPrefEnv();

  // Set the pref back to what it was at the start of the task.
  UrlbarPrefs.set(SUGGEST_PREF, !enabled);
});

// Tests telemetry recorded when toggling the `suggest.quicksuggest.sponsored`
// pref:
// * contextservices.quicksuggest enable_toggled event telemetry *
// * TelemetryEnvironment
add_task(async function sponsoredToggled() {
  Services.telemetry.clearEvents();

  // Toggle the suggest.quicksuggest.sponsored pref twice. We should get two
  // events.
  let enabled = UrlbarPrefs.get("suggest.quicksuggest.sponsored");
  for (let i = 0; i < 2; i++) {
    enabled = !enabled;
    UrlbarPrefs.set("suggest.quicksuggest.sponsored", enabled);
    TelemetryTestUtils.assertEvents([
      {
        category: TELEMETRY_EVENT_CATEGORY,
        method: "sponsored_toggled",
        object: enabled ? "enabled" : "disabled",
      },
    ]);
    Assert.equal(
      TelemetryEnvironment.currentEnvironment.settings.userPrefs[
        "browser.urlbar.suggest.quicksuggest.sponsored"
      ],
      enabled,
      "suggest.quicksuggest.sponsored is correct in TelemetryEnvironment"
    );
  }

  // Set the main quicksuggest.enabled pref to false and toggle the
  // suggest.quicksuggest pref again. We shouldn't get any events.
  await SpecialPowers.pushPrefEnv({
    set: [[EXPERIMENT_PREF, false]],
  });
  enabled = !enabled;
  UrlbarPrefs.set("suggest.quicksuggest.sponsored", enabled);
  TelemetryTestUtils.assertEvents([], { category: TELEMETRY_EVENT_CATEGORY });
  await SpecialPowers.popPrefEnv();

  // Set the pref back to what it was at the start of the task.
  UrlbarPrefs.set("suggest.quicksuggest.sponsored", !enabled);
});

// Tests the Nimbus "exposure" event gets recorded when the user is enrolled in
// a Nimbus experiment for urlbar
add_task(async function nimbusExposure() {
  // Exposure event recording is queued to the idle thread, so wait for idle
  // before we start so any events from previous tasks will have been recorded
  // and won't interfere with this task.
  await new Promise(resolve => Services.tm.idleDispatchToMainThread(resolve));

  Services.telemetry.clearEvents();
  NimbusFeatures.urlbar._sendExposureEventOnce = true;
  UrlbarProviderQuickSuggest._recordedExposureEvent = false;
  let doExperimentCleanup = await UrlbarTestUtils.enrollExperiment({
    valueOverrides: {
      // Make sure Merino is disabled so we don't hit the network.
      merinoEnabled: false,
      quickSuggestEnabled: true,
      quickSuggestShouldShowOnboardingDialog: false,
    },
  });

  // This filter is needed to exclude the enrollment event.
  let filter = {
    category: "normandy",
    method: "expose",
    object: "nimbus_experiment",
  };

  // No exposure event should be recorded after only enrolling.
  Assert.ok(
    !UrlbarProviderQuickSuggest._recordedExposureEvent,
    "_recordedExposureEvent remains false after enrolling"
  );
  TelemetryTestUtils.assertEvents([], filter);

  // Do a search that doesn't trigger a quick suggest result. No exposure event
  // should be recorded.
  await UrlbarTestUtils.promiseAutocompleteResultPopup({
    window,
    value: "nimbusExposure no result",
    fireInputEvent: true,
  });
  await assertNoQuickSuggestResults();
  await UrlbarTestUtils.promisePopupClose(window);
  Assert.ok(
    !UrlbarProviderQuickSuggest._recordedExposureEvent,
    "_recordedExposureEvent remains false after no quick suggest result"
  );
  TelemetryTestUtils.assertEvents([], filter);

  // Do a search that does trigger a quick suggest result. The exposure event
  // should be recorded.
  await UrlbarTestUtils.promiseAutocompleteResultPopup({
    window,
    value: TEST_SEARCH_STRING,
    fireInputEvent: true,
  });
  await assertIsQuickSuggest(1);
  Assert.ok(
    UrlbarProviderQuickSuggest._recordedExposureEvent,
    "_recordedExposureEvent is true after showing quick suggest result"
  );

  // The event recording is queued to the idle thread when the search starts, so
  // likewise queue the assert to idle instead of doing it immediately.
  await new Promise(resolve => {
    Services.tm.idleDispatchToMainThread(() => {
      TelemetryTestUtils.assertEvents(
        [
          {
            category: "normandy",
            method: "expose",
            object: "nimbus_experiment",
            extra: {
              branchSlug: "control",
              featureId: "urlbar",
            },
          },
        ],
        filter
      );
      resolve();
    });
  });

  await UrlbarTestUtils.promisePopupClose(window);

  await doExperimentCleanup();
});

// The contextservices.quicksuggest enable_toggled and sponsored_toggled events
// should not be recorded when the scenario changes. TelemetryEnvironment should
// record the new `suggest.quicksuggest` pref values.
add_task(async function updateScenario() {
  // Make sure the prefs don't have user values that would mask the default
  // values set below.
  UrlbarPrefs.clear("quicksuggest.scenario");
  UrlbarPrefs.clear("suggest.quicksuggest");
  UrlbarPrefs.clear("suggest.quicksuggest.sponsored");
  Services.telemetry.clearEvents();

  // check initial defaults
  let defaults = Services.prefs.getDefaultBranch("browser.urlbar.");
  Assert.equal(
    defaults.getCharPref("quicksuggest.scenario"),
    "offline",
    "Default scenario is offline initially"
  );
  Assert.ok(
    defaults.getBoolPref("suggest.quicksuggest"),
    "suggest.quicksuggest is true initially"
  );
  Assert.ok(
    defaults.getBoolPref("suggest.quicksuggest.sponsored"),
    "suggest.quicksuggest.sponsored is true initially"
  );
  Assert.ok(
    TelemetryEnvironment.currentEnvironment.settings.userPrefs[
      "browser.urlbar.suggest.quicksuggest"
    ],
    "suggest.quicksuggest is true in TelemetryEnvironment"
  );
  Assert.ok(
    TelemetryEnvironment.currentEnvironment.settings.userPrefs[
      "browser.urlbar.suggest.quicksuggest.sponsored"
    ],
    "suggest.quicksuggest.sponsored is true in TelemetryEnvironment"
  );

  // set online
  defaults.setCharPref("quicksuggest.scenario", "online");
  Assert.ok(
    !defaults.getBoolPref("suggest.quicksuggest"),
    "suggest.quicksuggest is false after setting online scenario"
  );
  Assert.ok(
    !defaults.getBoolPref("suggest.quicksuggest.sponsored"),
    "suggest.quicksuggest.sponsored is false after setting online scenario"
  );
  TelemetryTestUtils.assertEvents([]);
  Assert.ok(
    !TelemetryEnvironment.currentEnvironment.settings.userPrefs[
      "browser.urlbar.suggest.quicksuggest"
    ],
    "suggest.quicksuggest is false in TelemetryEnvironment"
  );
  Assert.ok(
    !TelemetryEnvironment.currentEnvironment.settings.userPrefs[
      "browser.urlbar.suggest.quicksuggest.sponsored"
    ],
    "suggest.quicksuggest.sponsored is false in TelemetryEnvironment"
  );

  // set back to offline
  defaults.setCharPref("quicksuggest.scenario", "offline");
  Assert.ok(
    defaults.getBoolPref("suggest.quicksuggest"),
    "suggest.quicksuggest is true after setting offline again"
  );
  Assert.ok(
    defaults.getBoolPref("suggest.quicksuggest.sponsored"),
    "suggest.quicksuggest.sponsored is true after setting offline again"
  );
  TelemetryTestUtils.assertEvents([]);
  Assert.ok(
    TelemetryEnvironment.currentEnvironment.settings.userPrefs[
      "browser.urlbar.suggest.quicksuggest"
    ],
    "suggest.quicksuggest is true in TelemetryEnvironment again"
  );
  Assert.ok(
    TelemetryEnvironment.currentEnvironment.settings.userPrefs[
      "browser.urlbar.suggest.quicksuggest.sponsored"
    ],
    "suggest.quicksuggest.sponsored is true in TelemetryEnvironment again"
  );
});

// The "firefox-suggest-update" notification should cause TelemetryEnvironment
// to re-cache the `suggest.quicksuggest` prefs.
add_task(async function telemetryEnvironmentUpdateNotification() {
  // Make sure the prefs don't have user values that would mask the default
  // values set below.
  UrlbarPrefs.clear("quicksuggest.scenario");
  UrlbarPrefs.clear("suggest.quicksuggest");
  UrlbarPrefs.clear("suggest.quicksuggest.sponsored");

  // Check the initial defaults.
  let defaults = Services.prefs.getDefaultBranch("browser.urlbar.");
  Assert.ok(
    defaults.getBoolPref("suggest.quicksuggest"),
    "suggest.quicksuggest is true initially"
  );
  Assert.ok(
    defaults.getBoolPref("suggest.quicksuggest.sponsored"),
    "suggest.quicksuggest.sponsored is true initially"
  );

  // Tell TelemetryEnvironment to clear its pref cache and stop observing prefs.
  await TelemetryEnvironment.testWatchPreferences(new Map());

  // Set the prefs to false. They should remain absent in TelemetryEnvironment.
  defaults.setBoolPref("suggest.quicksuggest", false);
  defaults.setBoolPref("suggest.quicksuggest.sponsored", false);
  Assert.ok(
    !(
      "browser.urlbar.suggest.quicksuggest" in
      TelemetryEnvironment.currentEnvironment.settings.userPrefs
    ),
    "suggest.quicksuggest not in TelemetryEnvironment"
  );
  Assert.ok(
    !(
      "browser.urlbar.suggest.quicksuggest.sponsored" in
      TelemetryEnvironment.currentEnvironment.settings.userPrefs
    ),
    "suggest.quicksuggest.sponsored not in TelemetryEnvironment"
  );

  // Send the notification. TelemetryEnvironment should record the current
  // values.
  Services.obs.notifyObservers(null, "firefox-suggest-update");
  Assert.strictEqual(
    TelemetryEnvironment.currentEnvironment.settings.userPrefs[
      "browser.urlbar.suggest.quicksuggest"
    ],
    false,
    "suggest.quicksuggest is false in TelemetryEnvironment"
  );
  Assert.strictEqual(
    TelemetryEnvironment.currentEnvironment.settings.userPrefs[
      "browser.urlbar.suggest.quicksuggest.sponsored"
    ],
    false,
    "suggest.quicksuggest.sponsored is false in TelemetryEnvironment"
  );

  // Set the prefs to true. TelemetryEnvironment should keep the old values.
  defaults.setBoolPref("suggest.quicksuggest", true);
  defaults.setBoolPref("suggest.quicksuggest.sponsored", true);
  Assert.strictEqual(
    TelemetryEnvironment.currentEnvironment.settings.userPrefs[
      "browser.urlbar.suggest.quicksuggest"
    ],
    false,
    "suggest.quicksuggest remains false in TelemetryEnvironment"
  );
  Assert.strictEqual(
    TelemetryEnvironment.currentEnvironment.settings.userPrefs[
      "browser.urlbar.suggest.quicksuggest.sponsored"
    ],
    false,
    "suggest.quicksuggest.sponsored remains false in TelemetryEnvironment"
  );

  // Send the notification again. TelemetryEnvironment should record the new
  // values.
  Services.obs.notifyObservers(null, "firefox-suggest-update");
  Assert.strictEqual(
    TelemetryEnvironment.currentEnvironment.settings.userPrefs[
      "browser.urlbar.suggest.quicksuggest"
    ],
    true,
    "suggest.quicksuggest is false in TelemetryEnvironment"
  );
  Assert.strictEqual(
    TelemetryEnvironment.currentEnvironment.settings.userPrefs[
      "browser.urlbar.suggest.quicksuggest.sponsored"
    ],
    true,
    "suggest.quicksuggest.sponsored is false in TelemetryEnvironment"
  );

  await TelemetryEnvironment.testCleanRestart().onInitialized();
});

/**
 * Checks the values of all the Quick Suggest scalars.
 *
 * @param {object} expectedIndexesByScalarName
 *   Maps scalar names to the expected 1-based indexes of results.  If you
 *   expect a scalar to be incremented, then include it in this object.  If you
 *   expect a scalar not to be incremented, don't include it.
 */
function assertScalars(expectedIndexesByScalarName) {
  let scalars = TelemetryTestUtils.getProcessScalars("parent", true, true);
  for (let scalarName of Object.values(TELEMETRY_SCALARS)) {
    if (scalarName in expectedIndexesByScalarName) {
      TelemetryTestUtils.assertKeyedScalar(
        scalars,
        scalarName,
        expectedIndexesByScalarName[scalarName],
        1
      );
    } else {
      Assert.ok(
        !(scalarName in scalars),
        "Scalar should not be present: " + scalarName
      );
    }
  }
}

/**
 * Asserts that a result is a Quick Suggest result.
 *
 * @param {number} [index]
 *   The expected index of the Quick Suggest result.  Pass -1 to use the index
 *   of the last result.
 * @returns {result}
 *   The result at the given index.
 */
async function assertIsQuickSuggest(index = -1) {
  if (index < 0) {
    index = UrlbarTestUtils.getResultCount(window) - 1;
    Assert.greater(index, -1, "Sanity check: Result count should be > 0");
  }
  let result = await UrlbarTestUtils.getDetailsOfResultAt(window, index);
  Assert.equal(result.type, UrlbarUtils.RESULT_TYPE.URL, "Result type");
  Assert.equal(result.url, TEST_URL, "Result URL");
  Assert.ok(result.isSponsored, "Result isSponsored");
  return result;
}

/**
 * Asserts that none of the results are Quick Suggest results.
 */
async function assertNoQuickSuggestResults() {
  for (let i = 0; i < UrlbarTestUtils.getResultCount(window); i++) {
    let r = await UrlbarTestUtils.getDetailsOfResultAt(window, i);
    Assert.ok(
      r.type != UrlbarUtils.RESULT_TYPE.URL ||
        !r.url.includes(TEST_URL) ||
        !r.isSponsored,
      `Result at index ${i} should not be a QuickSuggest result`
    );
  }
}

/**
 * Asserts that a custom impression ping is sent with the expected payload.
 *
 * @param {number} [index]
 *   The expected index of the Quick Suggest result.
 * @param {string} [scenario]
 *   The scenario of the Quick Suggest, should be one of "offline", "history", "online".
 */
function assertCustomImpression(index, scenario = DEFAULT_SCENARIO) {
  Assert.ok(spy.calledOnce, "Should send a custom impression ping");
  // Validate the impression ping
  let [payload, endpoint] = spy.firstCall.args;
  let expectedSearchQuery = scenario === "online" ? TEST_SEARCH_STRING : "";
  let expectedMatchedKeywords = scenario === "online" ? TEST_SEARCH_STRING : "";
  let expectedScenario = scenario;

  Assert.ok(
    endpoint.includes(CONTEXTUAL_SERVICES_PING_TYPES.QS_IMPRESSION),
    "Should set the endpoint for QuickSuggest impression"
  );
  Assert.ok(!!payload.context_id, "Should set the context_id");
  Assert.equal(
    payload.advertiser,
    "test-advertiser",
    "Should set the advertiser"
  );
  Assert.equal(
    payload.reporting_url,
    "http://impression.reporting.test.com/",
    "Should set the impression reporting URL"
  );
  Assert.equal(payload.block_id, 1, "Should set the block_id");
  Assert.equal(payload.position, index + 1, "Should set the position");
  Assert.equal(
    payload.search_query,
    expectedSearchQuery,
    "Should set the search_query"
  );
  Assert.equal(
    payload.matched_keywords,
    expectedMatchedKeywords,
    "Should set the matched_keywords"
  );
  Assert.equal(payload.scenario, expectedScenario, "Should set the scenario");
}

/**
 * Asserts no custom impression ping is sent.
 */
function assertNoCustomImpression() {
  Assert.ok(spy.notCalled, "Should not send a custom impression");
}

/**
 * Asserts that a custom click ping is sent with the expected payload.
 *
 * @param {number} [index]
 *   The expected index of the Quick Suggest result.
 */
function assertCustomClick(index) {
  // Impression is sent first, followed by the click
  Assert.ok(spy.calledTwice, "Should send a custom impression ping");
  // Validate the impression ping
  let [payload, endpoint] = spy.secondCall.args;
  Assert.ok(
    endpoint.includes(CONTEXTUAL_SERVICES_PING_TYPES.QS_SELECTION),
    "Should set the endpoint for QuickSuggest click"
  );
  Assert.ok(!!payload.context_id, "Should set the context_id");
  Assert.equal(
    payload.advertiser,
    "test-advertiser",
    "Should set the advertiser"
  );
  Assert.equal(
    payload.reporting_url,
    "http://click.reporting.test.com/",
    "Should set the click reporting URL"
  );
  Assert.equal(payload.block_id, 1, "Should set the block_id");
  Assert.equal(payload.position, index + 1, "Should set the position");
  Assert.equal(payload.scenario, DEFAULT_SCENARIO, "Should set the scenario");
}

/**
 * Asserts no custom click ping is sent.
 */
function assertNoCustomClick() {
  // Only called once for the impression
  Assert.ok(spy.calledOnce, "Should not send a custom impression");
}

/**
 * Adds a search engine that provides suggestions, calls your callback, and then
 * removes the engine.
 *
 * @param {function} callback
 *   Your callback function.
 */
async function withSuggestions(callback) {
  await SpecialPowers.pushPrefEnv({
    set: [["browser.urlbar.suggest.searches", true]],
  });
  let engine = await SearchTestUtils.promiseNewSearchEngine(
    getRootDirectory(gTestPath) + "searchSuggestionEngine.xml"
  );
  let oldDefaultEngine = await Services.search.getDefault();
  await Services.search.setDefault(engine);
  try {
    await callback(engine);
  } finally {
    await Services.search.setDefault(oldDefaultEngine);
    await Services.search.removeEngine(engine);
    await SpecialPowers.popPrefEnv();
  }
}
