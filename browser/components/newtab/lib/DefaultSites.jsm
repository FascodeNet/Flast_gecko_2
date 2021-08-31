/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

const DEFAULT_SITES_MAP = new Map([
  // This first item is the global list fallback for any unexpected geos
  [
    "",
    "https://www.youtube.com/,https://www.facebook.com/,https://www.wikipedia.org/,http://typingx0.net/sushida/,https://www.amazon.com/,https://twitter.com/,https://typingx0.net/sushida/",
  ],
  [
    "US",
    "https://www.youtube.com/,https://www.facebook.com/,https://www.amazon.com/,http://typingx0.net/sushida/,https://www.wikipedia.org/,https://twitter.com/,https://typingx0.net/sushida/",
  ],
  [
    "CA",
    "https://www.youtube.com/,https://www.facebook.com/,http://typingx0.net/sushida/,https://www.wikipedia.org/,https://www.amazon.ca/,https://twitter.com/,https://typingx0.net/sushida/",
  ],
  [
    "DE",
    "https://www.youtube.com/,https://www.facebook.com/,https://www.amazon.de/,https://www.ebay.de/,https://www.wikipedia.org/,http://typingx0.net/sushida/,https://typingx0.net/sushida/",
  ],
  [
    "PL",
    "https://www.youtube.com/,https://www.facebook.com/,https://allegro.pl/,https://www.wikipedia.org/,https://www.olx.pl/,https://www.wykop.pl/,https://typingx0.net/sushida/",
  ],
  [
    "RU",
    "https://vk.com/,https://www.youtube.com/,https://ok.ru/,https://www.avito.ru/,https://www.aliexpress.com/,https://www.wikipedia.org/,https://typingx0.net/sushida/",
  ],
  [
    "GB",
    "https://www.youtube.com/,https://www.facebook.com/,http://typingx0.net/sushida/,https://www.amazon.co.uk/,https://www.bbc.co.uk/,https://www.ebay.co.uk/,https://typingx0.net/sushida/",
  ],
  [
    "FR",
    "https://www.youtube.com/,https://www.facebook.com/,https://www.wikipedia.org/,https://www.amazon.fr/,https://www.leboncoin.fr/,https://twitter.com/,https://typingx0.net/sushida/",
  ],
  [
    "CN",
    "https://www.baidu.com/,https://www.zhihu.com/,https://www.ifeng.com/,https://weibo.com/,https://www.ctrip.com/,https://www.iqiyi.com/,https://typingx0.net/sushida/",
  ],
]);

this.EXPORTED_SYMBOLS = ["DEFAULT_SITES"];

// Immutable for export.
this.DEFAULT_SITES = Object.freeze(DEFAULT_SITES_MAP);
