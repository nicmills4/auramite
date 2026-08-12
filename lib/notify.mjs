// Notification layer: delivery only. What the emails say and how they look
// lives in lib/email-templates.mjs — this module just gets them to an inbox,
// or to data/outbox/ on a dry run.
import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { stamp } from './scanner.mjs';
import { renderOrgReport, renderRunSummary } from './email-templates.mjs';

const FROM = process.env.REPORT_FROM_EMAIL || 'Auramite <reports@auramite.io>';
const baseUrl = () => process.env.NEXT_PUBLIC_BASE_URL || 'https://auramite.io';

// Sends via Resend when RESEND_API_KEY is present; otherwise writes the message
// to data/outbox/ so a dry run shows exactly what would have gone out.
// DRY_RUN=1 forces the outbox path even with a key set.
async function sendEmail({ to, subject, text, html, redirectTo }) {
  // A test run delivers everything to one inbox instead of to customers. The
  // intended recipient goes in the subject, or you cannot tell which customer
  // a given test email represents.
  if (redirectTo) {
    subject = `[TEST → ${to}] ${subject}`;
    to = redirectTo;
  }
  const dryRun = process.env.DRY_RUN === '1';
  if (process.env.RESEND_API_KEY && !dryRun) {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'content-type': 'application/json' },
      body: JSON.stringify({ from: FROM, to, subject, text, ...(html ? { html } : {}) }),
    });
    if (res.ok) return;
    // Fall through to the outbox so a failed send is never a silently lost report.
    console.error(`Resend send to ${to} failed: ${res.status} ${await res.text().catch(() => '')} — writing to outbox instead`);
  }
  const dir = join('data', 'outbox');
  await mkdir(dir, { recursive: true });
  const base = `${stamp()}-${(to || 'none').replace(/[^a-z0-9]/gi, '_')}`;
  await writeFile(join(dir, `${base}.txt`), `To: ${to}\nSubject: ${subject}\n\n${text}\n`);
  if (html) await writeFile(join(dir, `${base}.html`), html);
}

/**
 * One report per customer covering every page scanned this run — a subscriber
 * tracking 25 pages gets one email, not 25.
 */
/** @param {{ to?: string[]; pages?: object[]; ranAt: string; redirectTo?: string }} opts */
export async function sendOrgReport({ to, pages, ranAt, redirectTo } = /** @type {any} */ ({})) {
  if (!to?.length || !pages?.length) return;
  const { subject, html, text } = renderOrgReport({ pages, ranAt, baseUrl: baseUrl() });
  for (const addr of to) await sendEmail({ to: addr, subject, text, html, redirectTo });
}

/** The operator's run summary. `results` are raw PageResults from the run. */
/** @param {{ to?: string; results: object[]; ranAt: string; redirectTo?: string }} opts */
export async function sendSummary({ to, results, ranAt, redirectTo } = /** @type {any} */ ({})) {
  if (!to) return;
  const rows = results.map((r) => ({
    host: r.label || r.url || r.host,
    error: r.error,
    findings: r.findings,
    firstRun: r.firstRun,
    added: r.diff?.added ?? r.added,
  }));
  const { subject, html, text } = renderRunSummary({ results: rows, ranAt, baseUrl: baseUrl() });
  await sendEmail({ to, subject, text, html, redirectTo });
}
