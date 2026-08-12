# Auramite — privacy-leak scanner & compliance service

Loads a website as a real, never-consented visitor (signaling GPC), records which
trackers send personal data **before consent**, and turns it into plain-English,
evidence-backed reports. Detection → targeting → proof → outreach → remediation.

> Plain-English explanation of measurable findings — **not legal advice.**

## The engine (`lib/`)
| File | What it does |
| --- | --- |
| `scanner.mjs` | Core scan: loads a site (GPC on), records pre-consent trackers + cookies, measures tracker/banner timing, classifies **hard** (identifier shared, e.g. LinkedIn) vs **gray** (Google Consent-Mode-denied) sale/share. |
| `signatures.mjs` | The maintainable dataset: trackers, cookies, CMPs, chat widgets, video signs, required links, industry keywords. **This is the moat — keep it current.** |
| `risk.mjs` | Litigation-exposure score (0–100, band) + legal theories (CIPA/VPPA/CCPA) × scope factor (entity/geo). |
| `enrich.mjs` | Audience size: `manual-traffic.csv` (dashboard numbers) → Similarweb API (if key) → CSV rank → none. Never fabricates. |
| `loader.mjs` | Ingests Apollo/ZoomInfo/Data Axle CSV exports (auto-detects website/company/size/contact columns) or bare URL lists. |
| `explainers.mjs` | Plain-English explainer paragraph per finding type + the outreach hook. |
| `proofpage.mjs` | Renders the standalone HTML proof page. |
| `diff.mjs` | Compares two scans → new / resolved findings (monitoring core). |

## CLI tools
| Command | Purpose |
| --- | --- |
| `node scan.mjs <url> [--no-gpc]` | Scan one/few URLs, print findings. |
| `node batch.mjs <list.csv> [--limit N]` | Scan + **score + rank** a list (Apollo CSV or URLs) → `reports/_exposure-*/`. |
| `node diagnose.mjs <url>` | Deep single-site diagnostic → `customers/<host>/`. |
| `node evidence.mjs <url>` | Adversarial raw network/cookie capture (verify findings by hand). |
| `node report.mjs <url>` | Generate the standalone proof page → `customers/<host>/proof.html`. |
| `node outreach.mjs <contacts.csv>` | Full LinkedIn kit: proof PNGs + `outreach-sheet.md` with filled messages. |
| `node monitor.mjs <url>` | Re-scan, diff vs last snapshot, flag **new** leaks (the subscription engine). |
| `node check-similarweb.mjs <domain>` | Test Similarweb API access (needs key). |
| `node qualify.mjs <list.csv>` | Pre-filter a list by US + size via Similarweb (needs key). |

## The web app (`src/app/`)
- `page.tsx` — marketing landing + **free inbound scanner** (live scan tool).
- `api/scan/route.ts` — runs the engine server-side, returns findings JSON.
- `api/lead/route.ts` — captures email → `data/leads.jsonl` (swap for DB in prod).
- `privacy/`, `terms/` — legal pages (this site uses no third-party trackers — we practice what we preach).

Run locally: `npm run dev`. (The Claude preview tool is rooted at the parent dir, so during agent sessions run via `npx next dev -p 3100`.)

## Docs
- `docs/fix-library.md` — 11 common leak causes → fix + access needed (answers "do they let me into their systems?": almost never servers).
- `docs/lead-followup-email.md` — what an inbound free-scan lead receives.
- `customers/<host>/remediation.md` — per-customer remediation playbook (worked example: vermontsystems).
- `demo/` — reference implementation proving the fix works (before/after).

## Workflow (current go-to-market)
1. **Inbound:** free scanner (this site) + SEO → leads in `data/leads.jsonl`.
2. **Outbound:** Apollo export → `outreach.mjs` → work `outreach-sheet.md` on LinkedIn → send proof PNG on interest.
3. **Convert:** monthly monitoring subscription + one-time / done-with-you remediation.
4. **Deliver:** `docs/fix-library.md` + re-scan to prove the fix; `monitor.mjs` for ongoing.

## Deploy (Railway)
`Dockerfile` uses the Playwright base image (Chromium + system deps preinstalled — a bare Node buildpack will NOT work). Copy `.env.example` → set keys. Railway auto-builds from the Dockerfile.
