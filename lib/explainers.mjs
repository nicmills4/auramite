// Plain-English explainer library. One templated paragraph per finding type, with
// the site's real captured details + log lines + rule & precedent filled in.
// buildExplainers(scan) returns only the explainers whose condition is met.

export function fmtT(ms) { return ms == null ? '?' : (ms / 1000).toFixed(2) + 's'; }

export function friendly(name) {
  const map = {
    'LinkedIn Insight Tag': 'LinkedIn', 'Google Ads / DoubleClick': 'Google', 'Meta (Facebook) Pixel': 'Meta (Facebook)',
    'TikTok Pixel': 'TikTok', 'Microsoft Advertising (UET)': 'Microsoft', 'X / Twitter Pixel': 'X (Twitter)',
    'Snap Pixel': 'Snapchat', 'Pinterest Tag': 'Pinterest', 'Reddit Pixel': 'Reddit', 'Criteo': 'Criteo',
  };
  return map[name] || name.replace(/\s*[\/(].*$/, '').trim();
}

export function shortUrl(u) {
  try { const x = new URL(u); let s = x.hostname.replace(/^www\./, '') + x.pathname + (x.search || ''); return s.length > 70 ? s.slice(0, 70) + '…' : s; }
  catch { return (u || '').slice(0, 70); }
}

export function listAnd(arr) {
  const a = [...new Set(arr.filter(Boolean))];
  if (a.length <= 1) return a[0] || '';
  if (a.length === 2) return a[0] + ' and ' + a[1];
  return a.slice(0, -1).join(', ') + ', and ' + a.slice(-1);
}

const logFor = (tr) => ({ text: `${fmtT(tr.t)}  ${tr.method || 'GET'}  ${shortUrl(tr.sample)}` });

// One-line outreach hook for the top exposure — picks the most lawsuit-relevant finding.
export function outreachHook(scan) {
  const nets = listAnd((scan.hardSaleShare || []).map((t) => friendly(t.name)));
  if (scan.hasVideo && scan.hasMetaPixel)
    return { short: 'sends data to Facebook and runs video tracking', theory: 'VPPA (video + Meta Pixel)', line: 'your site sends visitor data to Facebook and runs video tracking before anyone consents — the exact setup behind the “VPPA” video-privacy lawsuits hitting sites this year' };
  if ((scan.sessionRecorders || []).length) {
    const n = listAnd(scan.sessionRecorders.map((t) => t.name));
    return { short: `runs session-recording (${n})`, theory: `CIPA (session replay: ${n})`, line: `your site runs session-recording (${n}) that captures what visitors do and type, firing before consent — the #1 issue in the 1,000+ California “wiretapping” suits filed in 2025` };
  }
  if (scan.hasMetaPixel)
    return { short: 'fires the Meta/Facebook Pixel', theory: 'CIPA (Meta Pixel)', line: 'your Meta (Facebook) Pixel fires before visitors consent — the basis of the California “wiretapping” class actions' };
  if ((scan.hardSaleShare || []).length)
    return { short: `shares visitor data with ${nets}`, theory: `pre-consent share (${nets})`, line: `your site shares visitor identifiers with ${nets} before anyone consents — treated as an unconsented “sale” of personal data under CCPA` };
  if (scan.hasChat)
    return { short: 'runs a live-chat widget', theory: 'CIPA (chat)', line: 'your live-chat widget routes visitor conversations through a third party, which CIPA suits increasingly treat as “wiretapping”' };
  return { short: 'has tracking firing before consent', theory: 'pre-consent tracking', line: 'some tracking fires before visitors consent' };
}

export function buildExplainers(scan) {
  const out = [];
  const hard = scan.hardSaleShare || [];
  const firstHard = hard.slice().sort((a, b) => (a.t || 0) - (b.t || 0))[0];

  if (hard.length) {
    out.push({
      key: 'preconsent-share', severity: 'HIGH',
      title: 'Visitor data shared with advertisers before consent',
      paragraph: `The moment someone opens your homepage, your site hands a unique tracking ID and their browsing details to ${listAnd(hard.map((t) => friendly(t.name)))} for advertising — before they’ve agreed to anything. Under California’s privacy law (CCPA/CPRA) and similar laws in Colorado, Connecticut, and a dozen other states, sending a visitor’s identifiers to an advertising network counts as “selling” or “sharing” their personal information, which you’re required to let people decline first. Here is the moment it happened:`,
      logLines: hard.slice(0, 3).map(logFor),
      rule: `Pre-consent “sale/share” of personal data. California regulators fined Sephora $1.2M and Tractor Supply $1.35M for this exact pattern.`,
    });
  }

  if (scan.gpcIgnoredHard && firstHard) {
    out.push({
      key: 'gpc-ignored', severity: 'HIGH',
      title: 'Your visitor’s “Do Not Track” signal was ignored',
      paragraph: `Modern browsers can send a Global Privacy Control signal — a legally recognized way for a visitor to say “do not sell or share my data.” When we visited we sent exactly that signal, and your site ignored it: the tracking fired anyway. A growing list of states — California, Colorado, Connecticut and more — require businesses to detect and honor this signal automatically. You can see us ask, and the site ignore it:`,
      logLines: [
        { text: '→ we sent   Sec-GPC: 1   (do not sell or share)', ok: true },
        { text: `${fmtT(firstHard.t)}  ${firstHard.method || 'GET'}  ${shortUrl(firstHard.sample)}   ← fired anyway`, danger: true },
      ],
      rule: `Failure to honor an opt-out preference signal — central to the Sephora case and the 2025 California–Colorado–Connecticut joint enforcement sweep.`,
    });
  }

  if ((scan.trackingCookies || []).length) {
    const names = scan.trackingCookies.map((c) => c.name);
    out.push({
      key: 'tracking-cookies', severity: 'HIGH',
      title: 'Tracking cookies planted before consent',
      paragraph: `Before anyone clicked anything, advertising companies placed tracking files (“cookies”) in your visitor’s browser. These quietly identify and follow that person around the web, and they persist long after the visit ends — all set with no consent.`,
      logLines: [
        { text: `SET-COOKIE   ${names.slice(0, 5).join('; ')}`, danger: true },
        { text: '↳ these sit in the visitor’s browser for up to ~2 years' },
      ],
      rule: `Non-essential cookies require consent first under state privacy laws — and under the consent tool’s own “block until consent” promise.`,
    });
  }

  if (scan.optOutMissingWhileSharing) {
    // Precision matters here: many sites have a cookie banner, and the banner is
    // NOT the thing this finding is about. Overclaiming ("no way to say no")
    // hands the prospect an easy rebuttal and costs credibility.
    const cmpNote = (scan.cmps || []).length
      ? [{ text: `note: ${listAnd(scan.cmps.map((c) => c.name))} consent banner present — a banner is not the required opt-out link` }]
      : [];
    out.push({
      key: 'no-optout', severity: 'HIGH',
      title: 'Missing the required “Do Not Sell or Share” link',
      paragraph: `California and a dozen other states require any business that sells or shares personal data to offer a conspicuous “Do Not Sell or Share My Personal Information” (or “Your Privacy Choices”) link. A cookie banner doesn’t satisfy that requirement — regulators drew exactly that line in the Sephora case — and on this site the sharing happens before the banner is answered, so declining it can’t undo what already left. Our scan read every link, button and consent-tool control on the page and did not find that link — worth confirming by hand, since a scan sees a single page load.`,
      logLines: [
        { text: 'scanned every link, button and consent-tool control on the page → no “Do Not Sell / Your Privacy Choices” control found', danger: true },
        { text: 'note: an automated scan reads one page load — confirm by hand before acting on this' },
        ...cmpNote,
      ],
      rule: `CCPA requires the link itself, not just a banner — Sephora was fined $1.2M with a banner present. Tractor Supply’s $1.35M added a second lesson: the opt-out must actually stop the sharing.`,
    });
  }

  // The hedged counterpart to 'no-optout'. When a consent tool is present it may
  // carry the opt-out inside a preferences dialog a single page load never
  // opens, so we report only what we can stand behind: that we could not
  // confirm it. Deliberately MEDIUM and deliberately not phrased as a failure.
  if (scan.optOutUnverified) {
    out.push({
      key: 'optout-unverified', severity: 'MEDIUM',
      title: 'We could not confirm your “Do Not Sell or Share” link',
      paragraph: `Because your site shares identifiers with advertisers, California and a dozen other states require a conspicuous “Do Not Sell or Share My Personal Information” (or “Your Privacy Choices”) link. We could not confirm one on this page — ${scan.optOutUnverifiedReason || 'it may sit somewhere our scan cannot reach'}. This is not a finding that the link is missing; it is a prompt to check, because if it genuinely isn’t there this becomes the most expensive gap on the list.`,
      logLines: [
        { text: 'scanned every link, button and consent-tool control on the page → no match' },
        { text: `not asserted as missing — ${scan.optOutUnverifiedReason || 'it may be outside what one page load can see'}` },
      ],
      rule: `CCPA requires the link itself, not just a banner — Sephora was fined $1.2M with a banner present. Worth five minutes of manual checking.`,
    });
  }

  if ((scan.sessionRecorders || []).length) {
    out.push({
      key: 'session-replay', severity: 'HIGH',
      title: 'Session-recording is capturing your visitors',
      paragraph: `Your site runs session-recording tools (${listAnd(scan.sessionRecorders.map((t) => t.name))}) that record what visitors do — mouse movements, clicks, scrolling, and often what they type into forms. Plaintiffs’ lawyers treat this as illegal “wiretapping” under California’s CIPA when visitors aren’t clearly told. It was one of the most-sued issues of 2025.`,
      logLines: scan.sessionRecorders.slice(0, 2).map(logFor),
      rule: `CIPA wiretapping — $5,000 per violation, a private right to sue, and over 1,000 suits filed in 2025.`,
    });
  }

  if (scan.hasChat) {
    out.push({
      key: 'chat-widget', severity: 'MEDIUM',
      title: 'Live-chat widget may be recording conversations',
      paragraph: `Your live-chat widget (${listAnd((scan.chats || []).map((c) => c.name))}) routes visitor conversations through a third-party company. CIPA lawsuits increasingly target chat tools as “wiretapping” when the visitor isn’t told a third party is listening in.`,
      logLines: [{ text: `found on page:  live-chat widget “${(scan.chats || []).map((c) => c.name).join(', ')}” (third-party)` }],
      rule: `CIPA wiretapping — the same statute driving the 2025 lawsuit wave.`,
    });
  }

  if (scan.hasVideo && scan.hasMetaPixel) {
    const meta = (scan.trackers || []).find((t) => /meta|facebook/i.test(t.name));
    out.push({
      key: 'video-vppa', severity: 'HIGH',
      title: 'Video + Meta Pixel = video-privacy lawsuit exposure',
      paragraph: `Your pages include video and the Meta (Facebook) Pixel. Together they can tell Facebook which videos a specific visitor watched, linked to that person’s Facebook identity. This is the basis of a fast-growing wave of class actions under the federal Video Privacy Protection Act (VPPA).`,
      logLines: meta ? [logFor(meta)] : [],
      rule: `VPPA — $2,500 per violation; a $900,000 class settlement (Springer Nature) was approved in 2025.`,
    });
  }

  return out;
}
