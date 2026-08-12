// Customer-facing email rendering. Everything the monitor sends goes through
// here, as multipart text+HTML. The reader to design for is a non-technical
// executive skimming on a phone, so three rules:
//
//   1. No internal vocabulary. Scanner verdict strings ("LIKELY NON-COMPLIANT")
//      and raw loader errors ("page.goto: net::ERR_...") never reach a
//      customer. Statuses use the site's plain-English language; load failures
//      are humanized. The operator summary may keep raw detail — its reader
//      runs the service.
//   2. The verdict must survive a glance: colored headline, three numbers,
//      then detail for whoever scrolls.
//   3. Email-safe HTML only: tables, inline styles, one column, 600px, dark
//      header + light body. Client dark-mode handling of dark body backgrounds
//      is too unreliable to ship to strangers' inboxes.

const GOLD = '#e3b341';
const INK = '#1c1917';
const MUTED = '#78716c';
const FAINT = '#a8a29e';
const FONT = 'font-family:Arial,Helvetica,sans-serif;';

export const plural = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`;

export const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** "share:LinkedIn Insight Tag" → "shares data with LinkedIn Insight Tag" */
export const signalLabel = (s) => s
  .replace(/^finding:/, '')
  .replace(/^share:/, 'shares data with ')
  .replace(/^replay:/, 'session-replay: ')
  .replace(/^chat:/, 'chat widget: ')
  .replace(/^vppa:.*/, 'video + Meta Pixel (VPPA)');

/**
 * Load failures in customer emails, in words. The raw loader error stays in
 * the operator summary, where its reader can act on it.
 */
export function humanizeLoadError(err) {
  const e = String(err ?? '');
  if (/NAME_NOT_RESOLVED/i.test(e)) return "We couldn't find this address — it may have a typo, or the domain may be offline.";
  if (/CERT|SSL/i.test(e)) return "The page's security certificate has a problem, so we couldn't load it safely.";
  if (/TIMED?_?OUT|Timeout/i.test(e)) return 'The page took too long to respond.';
  if (/CONNECTION_REFUSED|CONNECTION_RESET|CONNECTION_CLOSED/i.test(e)) return "The site didn't accept our connection.";
  if (/ABORTED|BLOCKED_BY/i.test(e)) return 'Something on the site blocked the page from loading.';
  return "We couldn't load this page.";
}

const fmtWhen = (iso) =>
  new Intl.DateTimeFormat('en-US', {
    month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'UTC',
  }).format(new Date(iso)) + ' UTC';

/**
 * One customer-facing status per page — same language as the site, never the
 * scanner's internal verdict string.
 */
export function statusOf(page) {
  if (page.error) return { key: 'error', label: "Couldn't check", bg: '#f5f5f4', fg: '#57534e' };
  const findings = page.findings ?? [];
  if (findings.some((f) => f.severity === 'HIGH')) return { key: 'leak', label: 'Data leak detected', bg: '#fdecec', fg: '#b42318' };
  if (findings.length) return { key: 'gaps', label: 'Possible gaps', bg: '#fdf3e0', fg: '#96680d' };
  return { key: 'clear', label: 'No obvious leaks', bg: '#e8f6ee', fg: '#137a48' };
}

const shell = (bodyRows, preheader, settingsUrl) => `<!doctype html>
<html><body style="margin:0;padding:0;background:#f4f3ef;">
<div style="display:none;max-height:0;overflow:hidden;">${esc(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f3ef;">
<tr><td align="center" style="padding:28px 12px;">
<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;">
<tr><td style="background:#0b0a08;border-radius:12px 12px 0 0;padding:18px 28px;${FONT}">
  <span style="font-size:18px;font-weight:bold;color:#ffffff;">Auramite</span>
  <span style="font-size:18px;color:${GOLD};">&#9679;</span>
</td></tr>
${bodyRows}
<tr><td style="padding:20px 28px 0;${FONT}font-size:12px;line-height:1.7;color:${FAINT};">
  Plain-English explanation of measurable findings &mdash; not legal advice.<br>
  Manage your monitoring: <a href="${esc(settingsUrl)}" style="color:#8a6d1f;">${esc(settingsUrl.replace(/^https?:\/\//, ''))}</a>
</td></tr>
</table>
</td></tr></table>
</body></html>`;

const section = (inner, opts = {}) =>
  `<tr><td style="background:#ffffff;${opts.last ? 'border-radius:0 0 12px 12px;' : ''}padding:${opts.pad ?? '20px 28px'};${FONT}">${inner}</td></tr>`;

const chip = (s) =>
  `<span style="display:inline-block;background:${s.bg};color:${s.fg};font-size:11px;font-weight:bold;letter-spacing:.4px;text-transform:uppercase;border-radius:999px;padding:3px 10px;white-space:nowrap;">${esc(s.label)}</span>`;

const dot = (color) => `<span style="color:${color};">&#9679;</span>`;

/**
 * The per-organization report: one email covering every page scanned this run.
 * Returns { subject, html, text }.
 */
export function renderOrgReport({ pages, ranAt, baseUrl = 'https://auramite.io' }) {
  const settingsUrl = `${baseUrl}/settings`;
  const dashboardUrl = `${baseUrl}/dashboard`;

  const scanned = pages.filter((p) => !p.error);
  const failed = pages.filter((p) => p.error);
  const baselines = scanned.filter((p) => p.firstRun);
  const diffed = scanned.filter((p) => !p.firstRun);
  const withNew = diffed.filter((p) => p.diff?.added?.length);
  const withResolved = diffed.filter((p) => p.diff?.resolved?.length);
  const newCount = withNew.reduce((n, p) => n + p.diff.added.length, 0);
  const highCount = scanned.reduce((n, p) => n + (p.findings ?? []).filter((f) => f.severity === 'HIGH').length, 0);
  const baselineOnly = baselines.length > 0 && diffed.length === 0;

  // ---- headline -----------------------------------------------------------
  let head;
  if (newCount > 0) {
    head = {
      bg: '#fdecec', fg: '#b42318',
      title: `${plural(newCount, 'new tracker')} detected`,
      body: `Something changed on ${plural(withNew.length, 'page')} since your last scan. Details below.`,
    };
  } else if (baselineOnly) {
    head = {
      bg: '#faf3df', fg: '#7a5a12',
      title: 'Your baseline is set',
      body: `First scan of ${plural(scanned.length, 'page')} — this records where things stand today. From now on, we alert you only when something changes.`,
    };
  } else if (scanned.length === 0 && failed.length > 0) {
    head = {
      bg: '#f5f5f4', fg: '#57534e',
      title: `We couldn't check ${plural(failed.length, 'page')}`,
      body: 'No scan happened this run. Check the addresses below — we retry automatically next time.',
    };
  } else {
    head = {
      bg: '#e8f6ee', fg: '#137a48',
      title: 'All quiet — no changes',
      body: `${plural(scanned.length, 'page')} scanned. Nothing new appeared. Nothing to do.`,
    };
  }

  const subject =
    newCount > 0 ? `Auramite — ${plural(newCount, 'new tracker')} detected`
    : baselineOnly ? `Auramite — baseline set for ${plural(scanned.length, 'page')}`
    : scanned.length === 0 && failed.length > 0 ? `Auramite — we couldn't check ${plural(failed.length, 'page')}`
    : withResolved.length > 0 ? `Auramite — ${plural(withResolved.length, 'page')} improved, no new leaks`
    : `Auramite — all quiet, ${plural(scanned.length, 'page')} scanned`;

  // ---- the three numbers an exec actually wants ---------------------------
  const stat = (value, label, color = INK) => `<td align="center" style="padding:14px 6px;">
    <div style="${FONT}font-size:26px;font-weight:bold;color:${color};line-height:1;">${esc(String(value))}</div>
    <div style="${FONT}font-size:11px;letter-spacing:.4px;text-transform:uppercase;color:${FAINT};margin-top:5px;">${esc(label)}</div>
  </td>`;
  const stats = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #eee7d9;border-radius:10px;"><tr>
    ${stat(pages.length, 'Pages watched')}
    ${stat(baselineOnly ? '—' : newCount, 'New this scan', newCount > 0 ? '#b42318' : INK)}
    ${stat(highCount, 'High-severity findings', highCount > 0 ? '#b42318' : '#137a48')}
  </tr></table>`;

  // ---- per-page blocks ----------------------------------------------------
  const pageBlock = (p, isLast) => {
    const s = statusOf(p);
    const name = p.label || p.url;
    const parts = [];
    parts.push(`<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
      <td style="${FONT}font-size:14px;font-weight:bold;color:${INK};padding-right:12px;">${esc(name)}</td>
      <td align="right">${chip(s)}</td></tr></table>`);
    if (p.label) parts.push(`<div style="${FONT}font-size:12px;color:${FAINT};margin-top:2px;">${esc(p.url)}</div>`);

    if (p.error) {
      parts.push(`<div style="${FONT}font-size:13px;line-height:1.6;color:${MUTED};margin-top:8px;">${esc(humanizeLoadError(p.error))} We'll retry automatically on the next run.</div>`);
    } else {
      if (!p.firstRun && p.diff?.added?.length) {
        parts.push(`<div style="margin-top:10px;padding:10px 14px;background:#fdecec;border-radius:8px;">
          <div style="${FONT}font-size:11px;font-weight:bold;letter-spacing:.4px;text-transform:uppercase;color:#b42318;">New since your last scan</div>
          ${p.diff.added.map((a) => `<div style="${FONT}font-size:13px;color:#7f1d1d;margin-top:4px;">${dot('#b42318')} ${esc(signalLabel(a))}</div>`).join('')}
        </div>`);
      }
      if (!p.firstRun && p.diff?.resolved?.length) {
        parts.push(`<div style="margin-top:8px;padding:10px 14px;background:#e8f6ee;border-radius:8px;">
          <div style="${FONT}font-size:11px;font-weight:bold;letter-spacing:.4px;text-transform:uppercase;color:#137a48;">Fixed since your last scan</div>
          ${p.diff.resolved.map((a) => `<div style="${FONT}font-size:13px;color:#14532d;margin-top:4px;">${dot('#137a48')} ${esc(signalLabel(a))}</div>`).join('')}
        </div>`);
      }
      const findings = p.findings ?? [];
      if (findings.length) {
        parts.push(`<div style="${FONT}font-size:11px;font-weight:bold;letter-spacing:.4px;text-transform:uppercase;color:${FAINT};margin-top:10px;">What we found</div>`);
        parts.push(findings.map((f) => `<div style="${FONT}font-size:13px;line-height:1.6;color:${INK};margin-top:4px;">
          ${dot(f.severity === 'HIGH' ? '#b42318' : '#d97706')} ${esc(f.title)}</div>`).join(''));
      } else {
        parts.push(`<div style="${FONT}font-size:13px;color:${MUTED};margin-top:8px;">No trackers fired before consent on this scan.</div>`);
      }
    }
    return `<div style="${isLast ? '' : 'border-bottom:1px solid #eee7d9;'}padding:${isLast ? '16px 0 4px' : '16px 0'};">${parts.join('')}</div>`;
  };

  const ordered = [...pages].sort((a, b) => (a.error ? 1 : 0) - (b.error ? 1 : 0));
  const button = `<table role="presentation" cellpadding="0" cellspacing="0" align="center" style="margin:4px auto 0;"><tr>
    <td style="background:${GOLD};border-radius:8px;">
      <a href="${esc(dashboardUrl)}" style="display:inline-block;${FONT}font-size:14px;font-weight:bold;color:#0b0a08;text-decoration:none;padding:12px 26px;">View your dashboard</a>
    </td></tr></table>`;

  const bodyRows = [
    `<tr><td style="background:${head.bg};padding:18px 28px;${FONT}">
      <div style="font-size:17px;font-weight:bold;color:${head.fg};">${esc(head.title)}</div>
      <div style="font-size:13px;line-height:1.6;color:${head.fg};margin-top:4px;">${esc(head.body)}</div>
    </td></tr>`,
    section(`${stats}
      <div style="${FONT}font-size:12px;color:${FAINT};margin-top:16px;">Your Auramite report &mdash; ${esc(fmtWhen(ranAt))}</div>
      ${ordered.map((p, i) => pageBlock(p, i === ordered.length - 1)).join('')}
      ${button}`),
    section(`<div style="background:#faf7ee;border:1px solid #eadfc0;border-radius:8px;padding:14px 16px;">
      <div style="${FONT}font-size:13px;font-weight:bold;color:${INK};">Don't take our word for it</div>
      <div style="${FONT}font-size:13px;line-height:1.7;color:${MUTED};margin-top:4px;">
        Anyone can verify a finding: open the page in Chrome, press F12, choose the Network tab, and search for the
        tracker's name before touching the cookie banner. Or forward this email to whoever runs your website.
      </div></div>`, { last: true }),
  ].join('');

  const html = shell(bodyRows, head.title, settingsUrl);

  // ---- plain-text alternative --------------------------------------------
  const sev = (f) => (f.severity === 'HIGH' ? 'High' : 'Medium');
  const L = [];
  L.push(`Your Auramite report — ${fmtWhen(ranAt)}`, '', head.title.toUpperCase(), head.body, '');
  L.push(`Pages watched: ${pages.length} · New this scan: ${baselineOnly ? '—' : newCount} · High-severity findings: ${highCount}`, '');
  for (const p of ordered) {
    const s = statusOf(p);
    L.push(`${p.label || p.url} — ${s.label}`);
    if (p.label) L.push(`  ${p.url}`);
    if (p.error) L.push(`  ${humanizeLoadError(p.error)} We'll retry automatically on the next run.`);
    else {
      if (!p.firstRun && p.diff?.added?.length) for (const a of p.diff.added) L.push(`  NEW: ${signalLabel(a)}`);
      if (!p.firstRun && p.diff?.resolved?.length) for (const a of p.diff.resolved) L.push(`  FIXED: ${signalLabel(a)}`);
      const findings = p.findings ?? [];
      if (findings.length) for (const f of findings) L.push(`  ${sev(f)}: ${f.title}`);
      else L.push('  No trackers fired before consent on this scan.');
    }
    L.push('');
  }
  L.push(`View your dashboard: ${dashboardUrl}`, '');
  L.push("Don't take our word for it: open the page in Chrome, press F12, choose the");
  L.push("Network tab, and search for the tracker's name before touching the banner.");
  L.push('', '— Auramite · plain-English explanation of measurable findings, not legal advice');
  L.push(`Manage your monitoring: ${settingsUrl}`);

  return { subject, html, text: L.join('\n') };
}

/**
 * The operator's run summary. Its reader runs the service, so raw error detail
 * is appropriate here. Returns { subject, html, text }.
 */
export function renderRunSummary({ results, ranAt, baseUrl = 'https://auramite.io' }) {
  const settingsUrl = `${baseUrl}/settings`;
  const ok = results.filter((r) => !r.error);
  const failed = results.filter((r) => r.error);
  const withNew = ok.filter((r) => !r.firstRun && r.added?.length);
  const newCount = withNew.reduce((n, r) => n + r.added.length, 0);

  const subject = `Auramite run — ${newCount ? plural(newCount, 'new leak') + ' found' : 'no new leaks'} · ${plural(results.length, 'page')}${failed.length ? ` · ${plural(failed.length, 'failure')}` : ''}`;

  const row = (r) => {
    const s = statusOf({ error: r.error, findings: r.findings, firstRun: r.firstRun });
    const tail = r.error ? esc(r.error) : r.firstRun ? 'baseline' : r.added?.length ? `${plural(r.added.length, 'new leak')}: ${r.added.map(signalLabel).map(esc).join('; ')}` : 'no change';
    return `<tr>
      <td style="${FONT}font-size:13px;color:${INK};padding:8px 12px 8px 0;border-bottom:1px solid #eee7d9;white-space:nowrap;">${esc(r.host)}</td>
      <td style="padding:8px 12px 8px 0;border-bottom:1px solid #eee7d9;">${chip(s)}</td>
      <td style="${FONT}font-size:12px;color:${MUTED};padding:8px 0;border-bottom:1px solid #eee7d9;">${tail}</td>
    </tr>`;
  };

  const bodyRows = [
    `<tr><td style="background:${newCount ? '#fdecec' : '#e8f6ee'};padding:18px 28px;${FONT}">
      <div style="font-size:16px;font-weight:bold;color:${newCount ? '#b42318' : '#137a48'};">${newCount ? esc(plural(newCount, 'new leak') + ' found') : 'All quiet'}</div>
      <div style="font-size:13px;color:${newCount ? '#b42318' : '#137a48'};margin-top:4px;">${esc(`${plural(results.length, 'page')} scanned · ${plural(failed.length, 'failure')} · ${fmtWhen(ranAt)}`)}</div>
    </td></tr>`,
    section(`<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${results.map(row).join('')}</table>`, { last: true }),
  ].join('');

  const L = [];
  L.push(`Auramite run summary — ${fmtWhen(ranAt)}`, '');
  L.push(`${plural(results.length, 'page')} scanned. ${plural(newCount, 'new leak')}. ${plural(failed.length, 'failure')}.`, '');
  for (const r of results) {
    const s = statusOf({ error: r.error, findings: r.findings, firstRun: r.firstRun });
    const tail = r.error ? r.error : r.firstRun ? 'baseline' : r.added?.length ? `+${r.added.length} (${r.added.map(signalLabel).join('; ')})` : 'no change';
    L.push(`  • ${r.host}: ${s.label} — ${tail}`);
  }

  return { subject, html: shell(bodyRows, subject, settingsUrl), text: L.join('\n') };
}
