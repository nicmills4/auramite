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

async function sendEmail({ to, subject, body }) {
  // === TO GO LIVE, uncomment and set RESEND_API_KEY ===
  // if (process.env.RESEND_API_KEY) {
  //   await fetch('https://api.resend.com/emails', {
  //     method: 'POST',
  //     headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'content-type': 'application/json' },
  //     body: JSON.stringify({ from: 'Auramite <reports@auramite.io>', to, subject, text: body }),
  //   });
  //   return;
  // }
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
