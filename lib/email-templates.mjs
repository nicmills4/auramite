// Customer-facing email rendering — one template for every report state.
// The reader to design for is a non-technical executive skimming on a phone:
//
//   1. The colored headline reflects STANDING (is data leaking right now),
//      never just the delta. "No change" on a leaking site is not green news —
//      that exact confusion is why this rule exists.
//   2. The +/− of what appeared and what got fixed is the second line, not the
//      verdict.
//   3. No internal vocabulary. Scanner verdict strings and raw loader errors
//      never reach a customer; failures are humanized. The operator summary
//      keeps raw detail — its reader runs the service.
//   4. Email-safe HTML only: tables, inline styles, one column, 600px, dark
//      header + light body.

const GOLD = '#e3b341';
const INK = '#1c1917';
const MUTED = '#78716c';
const FAINT = '#a8a29e';
const RED = '#b42318';
const GREEN = '#137a48';
const AMBER = '#96680d';
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
  if (findings.some((f) => f.severity === 'HIGH')) return { key: 'leak', label: 'Data leak detected', bg: '#fdecec', fg: RED };
  if (findings.length) return { key: 'gaps', label: 'Possible gaps', bg: '#fdf3e0', fg: AMBER };
  return { key: 'clear', label: 'No leaks', bg: '#e8f6ee', fg: GREEN };
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

const chip = (s) =>
  `<span style="display:inline-block;background:${s.bg};color:${s.fg};font-size:11px;font-weight:bold;letter-spacing:.4px;text-transform:uppercase;border-radius:999px;padding:3px 10px;white-space:nowrap;">${esc(s.label)}</span>`;

const dot = (color) => `<span style="color:${color};">&#9679;</span>`;

/**
 * The single customer report template. Standing decides the headline; the
 * delta rides underneath; each page gets its own card — small and green when
 * clean, detailed when leaking. Returns { subject, html, text }.
 */
export function renderOrgReport({ pages, ranAt, baseUrl = 'https://auramite.io' }) {
  const settingsUrl = `${baseUrl}/settings`;
  const dashboardUrl = `${baseUrl}/dashboard`;

  const scanned = pages.filter((p) => !p.error);
  const failed = pages.filter((p) => p.error);
  const diffed = scanned.filter((p) => !p.firstRun);
  const baselineOnly = scanned.length > 0 && diffed.length === 0;

  const newCount = diffed.reduce((n, p) => n + (p.diff?.added?.length ?? 0), 0);
  const fixedCount = diffed.reduce((n, p) => n + (p.diff?.resolved?.length ?? 0), 0);
  const highOf = (p) => (p.findings ?? []).filter((f) => f.severity === 'HIGH').length;
  const totalHigh = scanned.reduce((n, p) => n + highOf(p), 0);
  const pagesWithHigh = scanned.filter((p) => highOf(p) > 0).length;
  const anyGaps = scanned.some((p) => highOf(p) === 0 && (p.findings ?? []).length > 0);

  // ---- delta sentence -----------------------------------------------------
  const delta = baselineOnly
    ? 'First scan — this is your baseline. From now on we flag anything that changes.'
    : newCount && fixedCount
      ? `${plural(newCount, 'new leak')} appeared and ${fixedCount} got fixed since your last scan.`
      : newCount
        ? `${plural(newCount, 'new leak')} appeared since your last scan.`
        : fixedCount
          ? `${plural(fixedCount, 'leak')} fixed since your last scan — nothing new appeared.`
          : 'No change since your last scan.';

  // ---- standing decides the headline color --------------------------------
  let head;
  if (scanned.length === 0 && failed.length > 0) {
    head = { bg: '#f5f5f4', fg: '#57534e', title: `We couldn't check ${plural(failed.length, 'page')}`,
      body: 'No scan happened this run. Check the addresses below — we retry automatically next time.' };
  } else if (totalHigh > 0) {
    head = { bg: '#fdecec', fg: RED, title: 'Data leak detected',
      body: `${plural(totalHigh, 'high-severity finding')} across ${plural(pagesWithHigh, 'page')}. ${delta}` };
  } else if (anyGaps) {
    head = { bg: '#fdf3e0', fg: AMBER, title: 'Possible gaps',
      body: `Nothing severe, but worth a look. ${delta}` };
  } else {
    head = { bg: '#e8f6ee', fg: GREEN, title: 'All clear',
      body: `No trackers fired before consent on ${plural(scanned.length, 'page')}. ${delta}` };
  }

  // ---- subject: the change is the event; standing is the context ----------
  const subject =
    scanned.length === 0 && failed.length > 0 ? `Auramite — we couldn't check ${plural(failed.length, 'page')}`
    : newCount > 0 ? `Auramite — ${plural(newCount, 'new leak')} detected`
    : baselineOnly ? `Auramite — baseline set: ${totalHigh > 0 ? plural(totalHigh, 'high-severity finding') + ' found' : anyGaps ? 'possible gaps found' : 'all clear'}`
    : fixedCount > 0 ? (totalHigh > 0 ? `Auramite — ${plural(fixedCount, 'leak')} fixed, ${plural(totalHigh, 'finding')} still open` : `Auramite — ${plural(fixedCount, 'leak')} fixed, all clear`)
    : totalHigh > 0 ? `Auramite — no change, ${plural(totalHigh, 'high-severity finding')} still open`
    : anyGaps ? 'Auramite — no change, possible gaps remain'
    : `Auramite — all clear, ${plural(scanned.length, 'page')} scanned`;

  // ---- the numbers: standing, plus, minus ---------------------------------
  const stat = (value, label, color = INK) => `<td align="center" style="padding:14px 6px;">
    <div style="${FONT}font-size:26px;font-weight:bold;color:${color};line-height:1;">${esc(String(value))}</div>
    <div style="${FONT}font-size:11px;letter-spacing:.4px;text-transform:uppercase;color:${FAINT};margin-top:5px;">${esc(label)}</div>
  </td>`;
  const stats = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #eee7d9;border-radius:10px;"><tr>
    ${stat(totalHigh, 'High-severity findings', totalHigh > 0 ? RED : GREEN)}
    ${stat(baselineOnly ? '—' : newCount > 0 ? `+${newCount}` : '0', 'New this scan', newCount > 0 ? RED : INK)}
    ${stat(baselineOnly ? '—' : fixedCount > 0 ? `−${fixedCount}` : '0', 'Fixed this scan', fixedCount > 0 ? GREEN : INK)}
  </tr></table>`;

  // ---- per-page cards: small when clean, detailed when not ----------------
  const cardShell = (inner, pad) =>
    `<div style="border:1px solid #eee7d9;border-radius:10px;padding:${pad};margin-top:10px;">${inner}</div>`;

  const nameRow = (p, s) => `<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
    <td style="${FONT}font-size:14px;font-weight:bold;color:${INK};padding-right:12px;">${esc(p.label || p.url)}</td>
    <td align="right">${chip(s)}</td></tr></table>`;

  const urlLine = (p) => (p.label ? `<div style="${FONT}font-size:12px;color:${FAINT};margin-top:2px;">${esc(p.url)}</div>` : '');

  const pageCard = (p) => {
    const s = statusOf(p);

    // Clean page: one quiet green line — presence, not noise.
    if (s.key === 'clear') return cardShell(nameRow(p, s), '12px 16px');

    // Unreachable: short, humanized, no raw errors.
    if (s.key === 'error') {
      return cardShell(
        nameRow(p, s) + urlLine(p) +
        `<div style="${FONT}font-size:13px;line-height:1.6;color:${MUTED};margin-top:8px;">${esc(humanizeLoadError(p.error))} We'll retry automatically on the next run.</div>`,
        '12px 16px',
      );
    }

    // Leaking or gaps: the full picture for this page.
    const parts = [nameRow(p, s), urlLine(p)];
    if (!p.firstRun && p.diff?.added?.length) {
      parts.push(`<div style="margin-top:10px;padding:10px 14px;background:#fdecec;border-radius:8px;">
        <div style="${FONT}font-size:11px;font-weight:bold;letter-spacing:.4px;text-transform:uppercase;color:${RED};">New since your last scan</div>
        ${p.diff.added.map((a) => `<div style="${FONT}font-size:13px;color:#7f1d1d;margin-top:4px;">${dot(RED)} ${esc(signalLabel(a))}</div>`).join('')}
      </div>`);
    }
    if (!p.firstRun && p.diff?.resolved?.length) {
      parts.push(`<div style="margin-top:8px;padding:10px 14px;background:#e8f6ee;border-radius:8px;">
        <div style="${FONT}font-size:11px;font-weight:bold;letter-spacing:.4px;text-transform:uppercase;color:${GREEN};">Fixed since your last scan</div>
        ${p.diff.resolved.map((a) => `<div style="${FONT}font-size:13px;color:#14532d;margin-top:4px;">${dot(GREEN)} ${esc(signalLabel(a))}</div>`).join('')}
      </div>`);
    }
    const findings = p.findings ?? [];
    parts.push(`<div style="${FONT}font-size:11px;font-weight:bold;letter-spacing:.4px;text-transform:uppercase;color:${FAINT};margin-top:10px;">Leaks on this page</div>`);
    parts.push(findings.map((f) => `<div style="${FONT}font-size:13px;line-height:1.6;color:${INK};margin-top:4px;">
      ${dot(f.severity === 'HIGH' ? RED : '#d97706')} ${esc(f.title)}</div>`).join(''));
    return cardShell(parts.join(''), '16px');
  };

  // Worst first: leaking pages are why the email exists; clean cards close it out.
  const rank = { leak: 0, gaps: 1, error: 2, clear: 3 };
  const ordered = [...pages].sort((a, b) => rank[statusOf(a).key] - rank[statusOf(b).key]);

  const button = `<table role="presentation" cellpadding="0" cellspacing="0" align="center" style="margin:18px auto 4px;"><tr>
    <td style="background:${GOLD};border-radius:8px;">
      <a href="${esc(dashboardUrl)}" style="display:inline-block;${FONT}font-size:14px;font-weight:bold;color:#0b0a08;text-decoration:none;padding:12px 26px;">View your dashboard</a>
    </td></tr></table>`;

  const bodyRows = [
    `<tr><td style="background:${head.bg};padding:18px 28px;${FONT}">
      <div style="font-size:17px;font-weight:bold;color:${head.fg};">${esc(head.title)}</div>
      <div style="font-size:13px;line-height:1.6;color:${head.fg};margin-top:4px;">${esc(head.body)}</div>
    </td></tr>`,
    `<tr><td style="background:#ffffff;border-radius:0 0 12px 12px;padding:20px 28px;${FONT}">
      ${stats}
      <div style="${FONT}font-size:12px;color:${FAINT};margin-top:16px;">Your Auramite report &mdash; ${esc(fmtWhen(ranAt))}</div>
      ${ordered.map(pageCard).join('')}
      ${button}
    </td></tr>`,
  ].join('');

  const html = shell(bodyRows, head.title, settingsUrl);

  // ---- plain-text alternative --------------------------------------------
  const sev = (f) => (f.severity === 'HIGH' ? 'High' : 'Medium');
  const L = [];
  L.push(`Your Auramite report — ${fmtWhen(ranAt)}`, '', head.title.toUpperCase(), head.body, '');
  L.push(`High-severity findings: ${totalHigh} · New this scan: ${baselineOnly ? '—' : `+${newCount}`} · Fixed this scan: ${baselineOnly ? '—' : `-${fixedCount}`}`, '');
  for (const p of ordered) {
    const s = statusOf(p);
    L.push(`${p.label || p.url} — ${s.label}`);
    if (p.label) L.push(`  ${p.url}`);
    if (p.error) L.push(`  ${humanizeLoadError(p.error)} We'll retry automatically on the next run.`);
    else if (s.key !== 'clear') {
      if (!p.firstRun && p.diff?.added?.length) for (const a of p.diff.added) L.push(`  NEW: ${signalLabel(a)}`);
      if (!p.firstRun && p.diff?.resolved?.length) for (const a of p.diff.resolved) L.push(`  FIXED: ${signalLabel(a)}`);
      for (const f of p.findings ?? []) L.push(`  ${sev(f)}: ${f.title}`);
    }
    L.push('');
  }
  L.push(`View your dashboard: ${dashboardUrl}`);
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
      <div style="font-size:16px;font-weight:bold;color:${newCount ? RED : GREEN};">${newCount ? esc(plural(newCount, 'new leak') + ' found') : 'All quiet'}</div>
      <div style="font-size:13px;color:${newCount ? RED : GREEN};margin-top:4px;">${esc(`${plural(results.length, 'page')} scanned · ${plural(failed.length, 'failure')} · ${fmtWhen(ranAt)}`)}</div>
    </td></tr>`,
    `<tr><td style="background:#ffffff;border-radius:0 0 12px 12px;padding:20px 28px;${FONT}">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${results.map(row).join('')}</table>
    </td></tr>`,
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
