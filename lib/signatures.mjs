// Signature dataset for the privacy audit scanner.
// This is intentionally a standalone, hand-maintainable file — it is the seed of
// the "maintained dataset" that is the eventual product moat. Add/adjust freely.
//
// Each tracker entry:
//   match     : substring(s) tested against each request URL (host+path)
//   name      : human label
//   category  : 'advertising' | 'analytics' | 'session-recording' | 'cdp' | 'marketing' | 'social'
//   saleShare : true if loading this generally constitutes a "sale" or "share" of
//               personal info under CCPA/CPRA-style state laws (the legally riskiest signal)

export const TRACKERS = [
  // --- Advertising / ad-tech (almost always "sale or share") ---
  { match: ['connect.facebook.net', 'facebook.com/tr', 'fbevents'], name: 'Meta (Facebook) Pixel', category: 'advertising', saleShare: true },
  { match: ['googleadservices.com', 'googlesyndication.com', 'doubleclick.net', '/pagead/', 'google.com/ads', 'adservice.google'], name: 'Google Ads / DoubleClick', category: 'advertising', saleShare: true },
  { match: ['analytics.tiktok.com', 'tiktok.com/i18n/pixel', 'ttq'], name: 'TikTok Pixel', category: 'advertising', saleShare: true },
  { match: ['ads.linkedin.com', 'px.ads.linkedin.com', 'snap.licdn.com'], name: 'LinkedIn Insight Tag', category: 'advertising', saleShare: true },
  { match: ['sc-static.net', 'tr.snapchat.com'], name: 'Snap Pixel', category: 'advertising', saleShare: true },
  { match: ['ct.pinterest.com', 's.pinimg.com'], name: 'Pinterest Tag', category: 'advertising', saleShare: true },
  { match: ['bat.bing.com'], name: 'Microsoft Advertising (UET)', category: 'advertising', saleShare: true },
  { match: ['static.ads-twitter.com', 'analytics.twitter.com', 't.co/i/adsct'], name: 'X / Twitter Pixel', category: 'advertising', saleShare: true },
  { match: ['pixel.reddit.com', 'redditstatic.com/ads'], name: 'Reddit Pixel', category: 'advertising', saleShare: true },
  { match: ['criteo.com', 'criteo.net'], name: 'Criteo', category: 'advertising', saleShare: true },
  { match: ['taboola.com'], name: 'Taboola', category: 'advertising', saleShare: true },
  { match: ['outbrain.com'], name: 'Outbrain', category: 'advertising', saleShare: true },
  { match: ['adroll.com', 'd.adroll'], name: 'AdRoll', category: 'advertising', saleShare: true },
  { match: ['quora.com/qevents', 'q.quora.com'], name: 'Quora Pixel', category: 'advertising', saleShare: true },

  // --- Analytics (lower legal risk on its own, but discloseable; GA can be configured as ad data) ---
  { match: ['google-analytics.com', 'analytics.google.com', '/g/collect', 'gtag/js'], name: 'Google Analytics (GA4)', category: 'analytics', saleShare: false },
  { match: ['googletagmanager.com'], name: 'Google Tag Manager (loads other tags)', category: 'analytics', saleShare: false },
  { match: ['plausible.io'], name: 'Plausible', category: 'analytics', saleShare: false },
  { match: ['matomo', 'piwik'], name: 'Matomo', category: 'analytics', saleShare: false },

  // --- Session recording / heatmaps (capture keystrokes & PII — high disclosure risk) ---
  { match: ['hotjar.com', 'hotjar.io'], name: 'Hotjar', category: 'session-recording', saleShare: false },
  { match: ['fullstory.com', 'fs.js'], name: 'FullStory', category: 'session-recording', saleShare: false },
  { match: ['clarity.ms'], name: 'Microsoft Clarity', category: 'session-recording', saleShare: false },
  { match: ['mouseflow.com'], name: 'Mouseflow', category: 'session-recording', saleShare: false },
  { match: ['luckyorange.com', 'luckyorange.net'], name: 'Lucky Orange', category: 'session-recording', saleShare: false },
  { match: ['smartlook.com'], name: 'Smartlook', category: 'session-recording', saleShare: false },

  // --- Customer data platforms / tag routers (often "share") ---
  { match: ['cdn.segment.com', 'api.segment.io'], name: 'Segment (CDP)', category: 'cdp', saleShare: true },
  { match: ['rudderstack'], name: 'RudderStack (CDP)', category: 'cdp', saleShare: true },

  // --- Marketing / email (mixed) ---
  { match: ['klaviyo.com'], name: 'Klaviyo', category: 'marketing', saleShare: false },
  { match: ['js.hs-scripts.com', 'hs-analytics.net', 'hubspot.com'], name: 'HubSpot', category: 'marketing', saleShare: false },
  { match: ['list-manage.com', 'chimpstatic.com'], name: 'Mailchimp', category: 'marketing', saleShare: false },
];

// Cookie name patterns that indicate tracking (set BEFORE consent = the red flag).
export const TRACKING_COOKIES = [
  { match: '_fbp', name: 'Meta _fbp' },
  { match: '_fbc', name: 'Meta _fbc' },
  { match: '_ga', name: 'Google Analytics _ga' },
  { match: '_gid', name: 'Google Analytics _gid' },
  { match: '_gcl_au', name: 'Google Ads _gcl_au' },
  { match: 'IDE', name: 'DoubleClick IDE' },
  { match: '_ttp', name: 'TikTok _ttp' },
  { match: 'ttcsid', name: 'TikTok ttcsid' },
  { match: '_uetsid', name: 'Bing UET' },
  { match: '_uetvid', name: 'Bing UET' },
  { match: 'li_sugr', name: 'LinkedIn' },
  { match: 'bcookie', name: 'LinkedIn bcookie' },
  { match: '_pin_unauth', name: 'Pinterest' },
  { match: 'hjSession', name: 'Hotjar session' },
  { match: '_hjSession', name: 'Hotjar session' },
  { match: 'ajs_anonymous_id', name: 'Segment anon id' },
  { match: 'lidc', name: 'LinkedIn lidc' },
  { match: 'UserMatchHistory', name: 'LinkedIn UserMatchHistory (ad targeting)' },
  { match: 'AnalyticsSyncHistory', name: 'LinkedIn AnalyticsSyncHistory' },
];

// Consent Management Platforms (CMPs). Detected via request domains, window globals, or DOM.
// `termly` flagged specifically because the user's hypothesis is about Termly users.
export const CMPS = [
  { id: 'termly',       name: 'Termly',        domains: ['app.termly.io', 'termly.io'],            globals: ['Termly'],            selectors: ['#termly-code-snippet-support', '[class*="termly"]'] },
  { id: 'onetrust',     name: 'OneTrust',      domains: ['cdn.cookielaw.org', 'onetrust.com', 'optanon'], globals: ['OneTrust', 'Optanon'], selectors: ['#onetrust-banner-sdk', '#onetrust-consent-sdk'] },
  { id: 'cookiebot',    name: 'Cookiebot',     domains: ['consent.cookiebot.com', 'cookiebot.com'], globals: ['Cookiebot'],         selectors: ['#CybotCookiebotDialog'] },
  { id: 'cookieyes',    name: 'CookieYes',     domains: ['cdn-cookieyes.com', 'cookieyes.com'],     globals: ['cookieyes'],         selectors: ['.cky-consent-container', '[class*="cky-"]'] },
  { id: 'osano',        name: 'Osano',         domains: ['osano.com', 'cmp.osano.com'],             globals: ['Osano'],             selectors: ['.osano-cm-window'] },
  { id: 'iubenda',      name: 'iubenda',       domains: ['iubenda.com', 'cdn.iubenda.com'],         globals: ['_iub'],              selectors: ['#iubenda-cs-banner'] },
  { id: 'usercentrics', name: 'Usercentrics',  domains: ['usercentrics.eu', 'app.usercentrics'],    globals: ['UC_UI', 'usercentrics'], selectors: ['#usercentrics-root'] },
  { id: 'didomi',       name: 'Didomi',        domains: ['didomi.io', 'sdk.privacy-center.org'],    globals: ['Didomi'],            selectors: ['#didomi-host'] },
  { id: 'complianz',    name: 'Complianz',     domains: ['complianz'],                              globals: ['cmplz'],             selectors: ['#cmplz-cookiebanner-container'] },
  { id: 'termageddon',  name: 'Termageddon',   domains: ['termageddon.com', 'app.termageddon.com'], globals: [],                    selectors: ['[class*="termageddon"]'] },
  { id: 'enzuzo',       name: 'Enzuzo',        domains: ['enzuzo.com', 'app.enzuzo.com'],           globals: [],                    selectors: ['[class*="enzuzo"]'] },
];

// IAB / industry consent-signal APIs (presence = some consent framework is installed).
export const CONSENT_APIS = ['__tcfapi', '__uspapi', '__gpp'];

// Chat / live-agent widgets — a primary CIPA "wiretapping" target (the widget vendor
// receives the conversation). Detected via request domains, globals, or DOM.
export const CHAT_WIDGETS = [
  { name: 'Intercom', domains: ['intercom.io', 'intercomcdn.com'], globals: ['Intercom'], selectors: ['.intercom-lightweight-app', '#intercom-container'] },
  { name: 'Drift', domains: ['drift.com', 'driftt.com'], globals: ['drift'], selectors: ['#drift-widget'] },
  { name: 'Zendesk / Zopim', domains: ['zopim.com', 'zdassets.com', 'zendesk.com'], globals: ['zE', '$zopim'], selectors: ['#launcher'] },
  { name: 'LiveChat', domains: ['livechatinc.com', 'livechat.com'], globals: ['LiveChatWidget', 'LC_API'], selectors: ['#chat-widget-container'] },
  { name: 'tawk.to', domains: ['tawk.to'], globals: ['Tawk_API'], selectors: ['#tawkchat-container'] },
  { name: 'Tidio', domains: ['tidio.co', 'tidiochat.com'], globals: ['tidioChatApi'], selectors: ['#tidio-chat'] },
  { name: 'HubSpot Chat', domains: ['js.usemessages.com', 'hs-banner.com'], globals: ['HubSpotConversations'], selectors: ['#hubspot-messages-iframe-container'] },
  { name: 'Olark', domains: ['olark.com'], globals: ['olark'], selectors: ['#olark-wrapper'] },
  { name: 'Crisp', domains: ['crisp.chat'], globals: ['$crisp'], selectors: ['.crisp-client'] },
  { name: 'Gorgias', domains: ['gorgias.chat'], globals: [], selectors: ['#gorgias-chat-container'] },
  { name: 'Facebook Messenger / Customer Chat', domains: ['facebook.com/v', 'connect.facebook.net/en_US/sdk/xfbml.customerchat'], globals: [], selectors: ['.fb-customerchat'] },
];

// Video presence (for VPPA exposure when combined with the Meta Pixel). Detected in-DOM.
export const VIDEO_SIGNS = {
  selectors: ['video', 'iframe[src*="youtube.com/embed"]', 'iframe[src*="youtube-nocookie"]', 'iframe[src*="player.vimeo"]', 'iframe[src*="wistia"]', 'iframe[src*="brightcove"]', 'iframe[src*="jwplayer"]', '.jwplayer', '.video-js', '[class*="wistia_embed"]'],
};

// Light industry heuristic — high-litigation-risk verticals (health, finance, media).
export const INDUSTRY_KEYWORDS = {
  health: /\b(health|medical|clinic|patient|doctor|dental|therapy|pharmacy|wellness|hospital|telehealth|medicare)\b/i,
  finance: /\b(bank|loan|mortgage|insurance|credit|invest|finance|financial|lending|annuity)\b/i,
  media: /\b(news|magazine|watch|episode|stream|video|podcast|article|subscribe|editor)\b/i,
};

// Link text/href patterns required or expected under US state laws.
export const REQUIRED_LINKS = {
  privacyPolicy: {
    label: 'Privacy Policy',
    text: [/privacy policy/i, /privacy notice/i, /privacy statement/i],
    href: [/privacy/i],
  },
  // CCPA/CPRA opt-out of sale/share. "Your Privacy Choices" is the standardized CA link.
  optOut: {
    label: 'Do Not Sell/Share / Your Privacy Choices',
    text: [/do not sell/i, /do not share/i, /your privacy choices/i, /opt[- ]?out/i, /limit the use of my/i],
    href: [/do-?not-?sell/i, /privacy-choices/i, /opt-?out/i, /ccpa/i],
  },
};
