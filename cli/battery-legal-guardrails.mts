#!/usr/bin/env -S npx tsx
// Battery for the litigation-risk guardrails: robots.txt handling, the scan
// authorization attestation, and the rule that absence of an opt-out control is
// only ASSERTED when nothing could be concealing it.
// Run: npx tsx cli/battery-legal-guardrails.mts   (dev server must be on :3100)

import "dotenv/config";
import { createServer } from "node:http";
import { robotsAllows } from "../lib/scanner.mjs";
import { buildExplainers } from "../lib/explainers.mjs";

const BASE = "http://localhost:3100";
let passed = 0, failed = 0;
const check = (name: string, cond: boolean, detail = "") => {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`); }
};

// ---------- robots.txt parsing, against a real local server ----------
console.log("robots.txt:");
let robotsBody = "";
let status = 200;
const srv = createServer((req, res) => {
  if (req.url === "/robots.txt") { res.writeHead(status, { "content-type": "text/plain" }); res.end(robotsBody); return; }
  res.writeHead(200); res.end("ok");
});
await new Promise<void>((r) => srv.listen(0, "127.0.0.1", r));
const addr = srv.address();
if (!addr || typeof addr === "string") throw new Error("no port");
const ORIGIN = `http://127.0.0.1:${addr.port}`;

robotsBody = "User-agent: *\nDisallow: /\n";
check("blanket Disallow: / blocks", !(await robotsAllows(`${ORIGIN}/`)).allowed);

robotsBody = "User-agent: *\nDisallow: /private\n";
check("unrelated path still allowed", (await robotsAllows(`${ORIGIN}/`)).allowed);
check("disallowed prefix blocked", !(await robotsAllows(`${ORIGIN}/private/x`)).allowed);

robotsBody = "User-agent: googlebot\nDisallow: /\n";
check("rules for a named bot do not apply to us", (await robotsAllows(`${ORIGIN}/`)).allowed);

robotsBody = "User-agent: *\nDisallow: /\nAllow: /public\n";
check("longer Allow beats shorter Disallow", (await robotsAllows(`${ORIGIN}/public/page`)).allowed);

robotsBody = "User-agent: *\nDisallow:\n";
check("empty Disallow means allow all", (await robotsAllows(`${ORIGIN}/anything`)).allowed);

status = 404; robotsBody = "";
check("missing robots.txt allows (crawler convention)", (await robotsAllows(`${ORIGIN}/`)).allowed);
status = 200;

check("unreachable host allows rather than blocking", (await robotsAllows("http://127.0.0.1:1/x", 1500)).allowed);
srv.close();

// ---------- opt-out assertion rules ----------
console.log("\nopt-out claim discipline:");
const base = { hardSaleShare: [{ name: "LinkedIn Insight Tag", t: 800, sample: "https://px.ads.linkedin.com/collect" }] };

// Confident absence → the HIGH accusation is allowed.
const confident = buildExplainers({ ...base, optOutMissingWhileSharing: true, cmps: [] }) as { key: string; severity: string }[];
check("confident absence yields the HIGH finding", confident.some((e) => e.key === "no-optout" && e.severity === "HIGH"));
check("...and not the hedged one", !confident.some((e) => e.key === "optout-unverified"));

// A consent tool could be concealing the control → must NOT assert absence.
const hedged = buildExplainers({
  ...base,
  optOutMissingWhileSharing: false,
  optOutUnverified: true,
  optOutUnverifiedReason: "Termly may carry it inside a preferences dialog we do not open",
  cmps: [{ name: "Termly" }],
}) as { key: string; severity: string; paragraph: string }[];
check("uncertain case does NOT emit the HIGH accusation", !hedged.some((e) => e.key === "no-optout"));
check("uncertain case emits a MEDIUM hedged finding", hedged.some((e) => e.key === "optout-unverified" && e.severity === "MEDIUM"));
const h = hedged.find((e) => e.key === "optout-unverified");
check("hedged copy says it is not a finding of absence", /not a finding that the link is missing/i.test(h?.paragraph ?? ""));

// Language check on the confident version: still qualified, not absolute.
const c = confident.find((e) => e.key === "no-optout") as { paragraph: string } | undefined;
check("confident copy still invites verification", /confirming by hand|single page load/i.test(c?.paragraph ?? ""));

// ---------- authorization attestation ----------
console.log("\nscan authorization attestation:");
async function post(path: string, body: unknown) {
  const r = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": `10.0.0.${Math.floor(passed + failed) % 250 + 1}` },
    body: JSON.stringify(body),
  });
  return { status: r.status, json: await r.json().catch(() => ({})) };
}
{
  const a = await post("/api/scan", { url: "example.com" });
  check("/api/scan refuses without attestation", a.status === 400 && /authorized/i.test(a.json?.error ?? ""), `status ${a.status}`);
  const b = await post("/api/scan", { url: "example.com", authorized: false });
  check("explicit false is refused too", b.status === 400, `status ${b.status}`);
  const c2 = await post("/api/scan-email", { url: "example.com", email: "x@example.com" });
  check("/api/scan-email refuses without attestation", c2.status === 400 && /authorized/i.test(c2.json?.error ?? ""), `status ${c2.status}`);
  // Attested requests get past the gate — a bad URL then fails later, not here.
  const d = await post("/api/scan", { url: "", authorized: true });
  check("attested request passes the gate (fails on empty url instead)", d.status === 400 && /website URL/i.test(d.json?.error ?? ""), JSON.stringify(d.json));
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
