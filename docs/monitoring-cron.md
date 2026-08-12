# Scheduled monitoring

The subscription product is delivered by `cli/run-scheduled.mts`. It reads every
enabled page belonging to an organization with a billable subscription, scans the
ones that are due, diffs each against that page's previous scan, emails each
customer one report, and emails the operator a summary.

```bash
npm run monitor              # real run — sends email
npm run monitor -- --dry-run # writes to data/outbox/ instead of sending
npm run monitor -- --force   # ignore cadence, scan everything enabled
npm run monitor -- --org <id>  # restrict to one organization
```

## Run it on a schedule (Railway)

The scanner needs Chromium and system libraries, which the app's Docker image
already has — so the cheapest correct option is a second Railway service built
from the same repo, with a different start command.

1. In the Auramite Railway project: **New → GitHub Repo →** `nicmills4/auramite`.
   Name it `monitor`.
2. **Settings → Deploy → Custom Start Command:**
   ```
   npm run monitor
   ```
3. **Settings → Cron Schedule:**
   ```
   0 8 * * *
   ```
   Daily at 08:00 UTC. Run it daily even though most pages are weekly — the
   runner decides what is actually due, so a weekly page is picked up on its own
   day and a `DAILY` page gets scanned every day. A weekly cron would leave daily
   subscribers unscanned six days out of seven.
4. **Variables** — the monitor needs its own copy:

   | Variable | Value |
   |---|---|
   | `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` (reference, not a paste) |
   | `RESEND_API_KEY` | same as the web service |
   | `REPORT_FROM_EMAIL` | `Auramite <reports@auramite.io>` |
   | `OPERATOR_EMAIL` | where the run summary goes |

   Without `OPERATOR_EMAIL` customers still get their reports, but you get no
   summary — so a run that scanned nothing looks identical to a healthy one.

## Things worth knowing

**The container must exit.** Railway treats a still-running cron container as an
in-progress run and skips the next schedule. The runner calls `process.exit(0)`
explicitly for this reason: one lingering Playwright handle would otherwise stop
all monitoring silently. A page that fails to load is a normal outcome and does
not fail the run.

**`tsx` is a runtime dependency, not a dev one.** The Prisma 7 client is
generated as TypeScript with extensionless imports that plain `node` cannot
resolve, so the runner is `.mts` and needs `tsx` present in production.

**Overlapping runs are not guarded.** There is no lock. With a daily schedule and
a scan taking ~25s per page, a run would need roughly 3,400 pages to still be
going when the next fires. Worth adding a lock before that becomes plausible.

**Rehearse before the first real send.** `--dry-run` performs real scans and
writes the exact emails to `data/outbox/` without sending them. Read one before
letting it mail customers for the first time.

## Alternatives considered

- **GitHub Actions** — free, but needs the database credentials as repository
  secrets and installs Playwright browsers on every run.
- **Local Task Scheduler** — fine while you have a handful of customers, but the
  machine has to be awake at 08:00.
