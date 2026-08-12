// Notification layer. Currently writes each message to data/outbox/ so you can SEE
// exactly what would be sent. To go live, fill in sendEmail() with a provider
// (Resend/Postmark) — everything else stays the same.
import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { stamp } from './scanner.mjs';

const label = (s) => s
  .replace(/^finding:/, '')
  .replace(/^share:/, 'shares data with ')
  .replace(/^replay:/, 'session-replay: ')
  .replace(/^chat:/, 'chat widget: ')
  .replace(/^vppa:.*/, 'video + Meta Pixel (VPPA)');

const FROM = process.env.REPORT_FROM_EMAIL || 'Auramite <reports@auramite.io>';

// Sends via Resend when RESEND_API_KEY is present; otherwise writes the message to
// data/outbox/ so a dry run still shows exactly what would have gone out.
// DRY_RUN=1 forces the outbox path even with a key set — use it to rehearse a run
// against real customer sites without mailing anyone.
async function sendEmail({ to, subject, body }) {
  const dryRun = process.env.DRY_RUN === '1';
  if (process.env.RESEND_API_KEY && !dryRun) {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'content-type': 'application/json' },
      body: JSON.stringify({ from: FROM, to, subject, text: body }),
    });
    if (res.ok) return;
    // Fall through to the outbox so a failed send is never a silently lost report.
    console.error(`Resend send to ${to} failed: ${res.status} ${await res.text().catch(() => '')} — writing to outbox instead`);
  }
  const dir = join('data', 'outbox');
  await mkdir(dir, { recursive: true });
  const safe = `${(to || 'none').replace(/[^a-z0-9]/gi, '_')}`;
  await writeFile(join(dir, `${stamp()}-${safe}.txt`), `To: ${to}\nSubject: ${subject}\n\n${body}\n`);
}

export async function sendReport({ to, host, scan, explainers, diff, firstRun }) {
  if (!to) return; // no owner email on file → skip (opted-in customers only)
  const L = [];
  L.push(`Your Auramite scan of ${host}`, '');
  L.push(`Result: ${scan.verdict}`, '');
  if (firstRun) {
    L.push('This is your baseline scan — future scans will alert you to any change.');
  } else {
    if (diff.added?.length) L.push(`⚠️ NEW since last scan: ${diff.added.map(label).join('; ')}`);
    if (diff.resolved?.length) L.push(`✅ Resolved since last scan: ${diff.resolved.map(label).join('; ')}`);
    if (!diff.added?.length && !diff.resolved?.length) L.push('No change since your last scan.');
  }
  L.push('', 'What we found:');
  if (explainers.length) explainers.forEach((e) => L.push(`  • [${e.severity}] ${e.title}`));
  else L.push('  • No obvious pre-consent leaks this scan.');
  L.push('', `Full report: customers/${host}/proof.html`);
  L.push('', 'Verify it yourself: open your site → F12 → Network tab → type a tracker name (e.g. linkedin) → reload. Or blacklight.themarkup.org.');
  L.push('', '— Auramite · plain-English explanation of measurable findings, not legal advice · reply to unsubscribe');
  await sendEmail({ to, subject: `Auramite — ${host}${!firstRun && diff.added?.length ? ' — NEW leak detected' : ''}`, body: L.join('\n') });
}

/**
 * One email per customer covering every page scanned this run — a subscriber
 * tracking 25 pages should get one report, not 25 separate emails.
 */
export async function sendOrgReport({ to, pages, ranAt }) {
  if (!to?.length || !pages?.length) return;

  const scanned = pages.filter((p) => !p.error);
  const failed = pages.filter((p) => p.error);
  const changed = scanned.filter((p) => !p.firstRun && (p.diff?.added?.length || p.diff?.resolved?.length));
  const newLeaks = scanned.filter((p) => !p.firstRun && p.diff?.added?.length);
  const baselines = scanned.filter((p) => p.firstRun);

  const L = [];
  L.push(`Your Auramite report — ${new Date(ranAt).toUTCString()}`, '');

  if (newLeaks.length) {
    L.push(`${newLeaks.length} page(s) picked up something new since the last scan:`, '');
    for (const p of newLeaks) {
      L.push(`  ${p.label || p.url}`);
      for (const a of p.diff.added) L.push(`    NEW: ${label(a)}`);
      L.push('');
    }
  } else if (!baselines.length) {
    L.push('No new leaks since your last scan.', '');
  }

  const resolved = scanned.filter((p) => !p.firstRun && p.diff?.resolved?.length);
  if (resolved.length) {
    L.push('Resolved since last scan:', '');
    for (const p of resolved) {
      L.push(`  ${p.label || p.url}`);
      for (const r of p.diff.resolved) L.push(`    FIXED: ${label(r)}`);
      L.push('');
    }
  }

  if (baselines.length) {
    L.push(`${baselines.length} page(s) scanned for the first time — this is your baseline.`, '');
    for (const p of baselines) L.push(`  ${p.label || p.url} — ${p.verdict}`);
    L.push('');
  }

  L.push('Every page we watch:', '');
  for (const p of scanned) {
    const tail = p.firstRun ? 'baseline' : p.diff?.added?.length ? `${p.diff.added.length} new` : 'no change';
    L.push(`  ${p.label || p.url}`);
    L.push(`    ${p.verdict}  (${tail})`);
  }

  if (failed.length) {
    L.push('', "Pages we couldn't reach this run (we'll retry next time):");
    for (const p of failed) L.push(`  ${p.label || p.url} — ${p.error}`);
  }

  L.push('', 'Verify any of this yourself: open the page in Chrome, press F12, open the');
  L.push('Network tab, and search for the tracker name before accepting the banner.');
  L.push('', '— Auramite · plain-English explanation of measurable findings, not legal advice');
  L.push('Manage which pages we watch: https://auramite.io/account');

  const subject = newLeaks.length
    ? `Auramite — new tracker detected on ${newLeaks.length} page(s)`
    : changed.length
      ? `Auramite — ${changed.length} change(s) across your pages`
      : `Auramite — ${scanned.length} page(s) scanned, no change`;

  for (const addr of to) await sendEmail({ to: addr, subject, body: L.join('\n') });
}

export async function sendSummary({ to, results, ranAt }) {
  const L = [];
  L.push(`Auramite run summary — ${ranAt}`, '');
  const ok = results.filter((r) => !r.error);
  const newLeaks = ok.filter((r) => r.added?.length && !r.firstRun);
  L.push(`Scanned ${results.length} site(s). New leaks on ${newLeaks.length}. Failures: ${results.length - ok.length}.`, '');
  if (newLeaks.length) {
    L.push('🔴 New leaks:');
    newLeaks.forEach((r) => L.push(`  • ${r.host}: +${r.added.length} (${r.added.map(label).join('; ')})`));
    L.push('');
  }
  L.push('All sites:');
  results.forEach((r) => L.push(`  • ${r.host}: ${r.error ? 'FAILED — ' + r.error : `${r.band} ${r.score} — ${r.verdict}`}${r.firstRun ? ' (baseline)' : ''}`));
  await sendEmail({ to, subject: `Auramite run — ${newLeaks.length} new leak(s) across ${results.length} site(s)`, body: L.join('\n') });
}
