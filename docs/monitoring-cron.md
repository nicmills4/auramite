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
2. **Settings → Config-as-code →** set the config file path to:
   ```
   railway.monitor.json
   ```
   That file sets the start command, the schedule, and `restartPolicyType: NEVER`.
   It lives in its own file rather than `railway.json` on purpose: a root
   `railway.json` applies to *every* service built from this repo, which would
   turn the web app into a cron job and take the site down.
3. **Deploy it once.** A service that has never deployed has nothing to schedule,
   and the Cron Schedule field has no effect until a deployment exists. If
   connecting the repo did not trigger a build, push a commit or use
   **Deploy → Redeploy**.
4. **Variables** — the monitor needs its own copy:

   | Variable | Value |
   |---|---|
   | `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` (reference, not a paste) |
   | `RESEND_API_KEY` | same as the web service |
   | `REPORT_FROM_EMAIL` | `Auramite <reports@auramite.io>` |
   | `OPERATOR_EMAIL` | where the run summary goes |
   | `NEXT_PUBLIC_BASE_URL` | `https://auramite.io` — the "manage your monitoring" link in customer reports. Unset, it falls back to the production URL, which is silently wrong on staging. |
   | `HEALTHCHECK_URL` | optional — a [healthchecks.io](https://healthchecks.io) (or similar) ping URL. The runner POSTs it when a run completes and POSTs `<url>/fail` when a run crashes. |
   | `SCAN_RETENTION_DAYS` | optional — prune scan rows older than this after each run (default 365). Each page's newest scan always survives, so a paused page never loses its baseline. |

   Without `OPERATOR_EMAIL` customers still get their reports, but you get no
   summary — so a run that scanned nothing looks identical to a healthy one.

## Knowing when the cron stops running

A cron that silently stops is worse than one that crashes loudly — Railway skips
overlapping runs, so one wedged container ends all monitoring with no error
anywhere. `HEALTHCHECK_URL` closes that hole with a dead-man switch:

1. Create a check at healthchecks.io with a period of 1 day and a grace window
   of a few hours.
2. Put its ping URL in the monitor service's `HEALTHCHECK_URL`.
3. The service alerts you when a day passes without a ping — covering crashes,
   wedged containers, a disabled schedule, and the repo quietly failing to build.

The runner also distinguishes crash from silence: an unhandled error POSTs
`<url>/fail` (an immediate alert) and exits 1.

## Things worth knowing

**The container must exit.** Railway treats a still-running cron container as an
in-progress run and skips the next schedule. The runner calls `process.exit(0)`
explicitly for this reason: one lingering Playwright handle would otherwise stop
all monitoring silently. A page that fails to load is a normal outcome and does
not fail the run.

**`tsx` is a runtime dependency, not a dev one.** The Prisma 7 client is
generated as TypeScript with extensionless imports that plain `node` cannot
resolve, so the runner is `.mts` and needs `tsx` present in production.

**Railway skips an overlapping run rather than starting a second one.** If the
previous run is still going when the next fires, that firing is dropped — so
there is no double-scanning, but a run that hangs stops all monitoring until it
is killed. Combined with the explicit `process.exit(0)`, that is the whole
protection; there is no application-level lock, which is fine while a run takes
seconds per page.

**The schedule is UTC**, and the minimum interval Railway allows is 5 minutes.

**Both services rebuild on every push**, since they share a repo. Harmless, just
noisy — the monitor image is the same one the web app uses, which is why it
already has Chromium.

**Weekly digests never delay bad news.** Each report recipient has a digest
setting (Settings → Report recipients). `WEEKLY` recipients skip no-change
reports until ~6.5 days have passed since their last one — but any run that
finds something NEW emails everyone immediately, whatever their setting. The
window is stamped only on real deliveries: dry runs and admin test sends do not
consume it.

**Rehearse before the first real send.** `--dry-run` performs real scans and
writes the exact emails to `data/outbox/` without sending them. Read one before
letting it mail customers for the first time.

## Alternatives considered

- **GitHub Actions** — free, but needs the database credentials as repository
  secrets and installs Playwright browsers on every run.
- **Local Task Scheduler** — fine while you have a handful of customers, but the
  machine has to be awake at 08:00.
