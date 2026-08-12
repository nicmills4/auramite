# Privacy audit scanner (hand-audit instrument)

A standalone CLI that loads a website as a **fresh, never-consented visitor** while
signaling **GPC + DNT**, then records what actually happens *before any consent is
given*. Built to test one hypothesis cheaply:

> Do real SMBs — including those already paying for Termly/OneTrust/etc. — still
> fire **sale/share trackers before consent** and **ignore GPC**? If yes, there's a
> product. If everyone's clean, there isn't.

## Run it

```bash
npm run scan -- example.com
npm run scan -- shop-a.com shop-b.com shop-c.com      # batch
node scan.mjs --no-gpc shop-a.com                     # compare run with no GPC signal
```

Each target produces `reports/<domain>-<timestamp>/` containing:
- `screenshot.png` — full-page evidence (does the banner even show? what fires behind it?)
- `report.json` — raw machine-readable result
- `report.md` — readable findings + tracker table

## What it checks

| Check | Why it matters for US state law |
| --- | --- |
| **Sale/share trackers firing pre-consent** | Meta Pixel, Google Ads, TikTok, etc. loading before opt-out = a "sale/share" with no gate. The headline finding. |
| **GPC honored?** | We send `Sec-GPC: 1` + `navigator.globalPrivacyControl`. CA/CO/CT/etc. treat GPC as a valid opt-out. Trackers firing anyway = ignored. |
| **CMP present but cosmetic** | Detects Termly/OneTrust/CookieYes/etc. A banner that doesn't actually block trackers is the exact gap we're hunting. |
| **"Do Not Sell/Share" / "Your Privacy Choices" link** | Required for businesses that sell/share. |
| **Privacy Policy link** | Baseline under every state law. |
| **Tracking cookies set pre-consent** | `_fbp`, `_ga`, `_gcl_au`, `_ttp`, etc. set before any click. |
| **Session recording** | Hotjar/FullStory/Clarity capture keystrokes incl. PII. |

## How to read the verdict

The verdict is intentionally **gap-surfacing, not legal advice** — a `HIGH` finding
means "worth a human look," not "guaranteed violation." For the demand test, the
signal you care about is: **a site with a paid consent tool that still shows red
sale/share findings.** That's the screenshot you put in front of a prospect.

## Tuning

All detection lives in [`lib/signatures.mjs`](lib/signatures.mjs) — the tracker list,
cookie patterns, CMP fingerprints, and required-link regexes. This file is the seed
of the eventual maintained per-state dataset. Add entries as you encounter new tags.
