#!/usr/bin/env -S npx tsx
// Proves the broadened link detection actually finds the controls that the old
// anchor-only collection missed — and, just as importantly, that it still
// reports absence when a control genuinely is not there.
// Run: npx tsx cli/battery-link-detection.mts

import "dotenv/config";
import { createServer } from "node:http";
import { chromium } from "playwright";
import { scanOne } from "../lib/scanner.mjs";

let passed = 0, failed = 0;
const check = (name: string, cond: boolean, detail = "") => {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`); }
};

const page = (body: string) =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>fixture</title></head><body>${body}</body></html>`;

const FIXTURES: Record<string, string> = {
  // The old collector found this: a plain anchor.
  "/anchor": page(`<footer><a href="/privacy-policy">Privacy Policy</a><a href="/do-not-sell">Do Not Sell My Personal Information</a></footer>`),
  // Missed before: a button whose only label is an aria-label.
  "/aria-button": page(`<footer><a href="/privacy">Privacy</a><button aria-label="Your Privacy Choices"><svg width="20" height="12"></svg></button></footer>`),
  // Missed before: an icon link labelled only by its image alt text.
  "/img-alt": page(`<footer><a href="/privacy">Privacy</a><a href="/prefs"><img src="data:," alt="Your Privacy Choices"></a></footer>`),
  // Missed before: the control lives inside a consent tool's shadow root.
  "/shadow": page(
    `<footer><a href="/privacy">Privacy</a></footer><div id="cmp"></div>
     <script>
       const host = document.getElementById('cmp');
       const root = host.attachShadow({ mode: 'open' });
       root.innerHTML = '<button aria-label="Do Not Sell or Share My Personal Information"></button>';
     </script>`,
  ),
  // Genuinely absent — the detector must still say so, or it is useless.
  "/none": page(`<footer><a href="/about">About us</a><a href="/contact">Contact</a></footer>`),
};

const srv = createServer((req, res) => {
  const body = FIXTURES[(req.url || "").split("?")[0]];
  if (!body) { res.writeHead(404); res.end("nope"); return; }
  res.writeHead(200, { "content-type": "text/html" });
  res.end(body);
});
await new Promise<void>((r) => srv.listen(0, "127.0.0.1", r));
const a = srv.address();
if (!a || typeof a === "string") throw new Error("no port");
const ORIGIN = `http://127.0.0.1:${a.port}`;

const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
type Scan = { foundLinks?: Record<string, { found?: boolean; text?: string; via?: string }> };
const scan = async (path: string) =>
  (await scanOne(browser, `${ORIGIN}${path}`, { sendGPC: true, writeReports: false })) as Scan;

console.log("link detection:");
{
  const r = await scan("/anchor");
  check("plain anchors still found (no regression)", r.foundLinks?.optOut?.found !== false && r.foundLinks?.privacyPolicy?.found !== false,
    JSON.stringify(r.foundLinks));
}
{
  const r = await scan("/aria-button");
  check("button labelled only by aria-label is found", r.foundLinks?.optOut?.found !== false, JSON.stringify(r.foundLinks?.optOut));
  check("...and recorded as a button", r.foundLinks?.optOut?.via === "button", `via=${r.foundLinks?.optOut?.via}`);
}
{
  const r = await scan("/img-alt");
  check("icon link labelled by img alt is found", r.foundLinks?.optOut?.found !== false, JSON.stringify(r.foundLinks?.optOut));
}
{
  const r = await scan("/shadow");
  check("control inside a shadow root is found", r.foundLinks?.optOut?.found !== false, JSON.stringify(r.foundLinks?.optOut));
}
{
  const r = await scan("/none");
  check("genuine absence is still reported as absent", r.foundLinks?.optOut?.found === false && r.foundLinks?.privacyPolicy?.found === false,
    JSON.stringify(r.foundLinks));
}

await browser.close();
srv.close();
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
