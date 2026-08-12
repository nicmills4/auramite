# Fix library — common causes of pre-consent data leaks + how to remediate

Internal playbook. Each issue: how the scan flags it → root cause → the fix → **what access (if any) it needs**. The access column matters: it answers "do customers have to let me into their systems?" — almost never their *servers*; at most a scoped, revocable invite to a *tool* (GTM / their CMP / CMS), and often nothing at all.

---

## 1. Hardcoded ad pixel in the page/theme (Meta, LinkedIn, Google Ads)
- **Scan flag:** sale/share tracker fires on load; pixel signature present in the served HTML.
- **Cause:** the pixel snippet was pasted directly into the site theme/header, so the consent tool never controls it.
- **Fix:** re-tag the script so it can't run until consent — `<script type="text/plain" data-cookieconsent="marketing" src="…">` (the CMP flips it live on opt-in); **or** move the tag into Google Tag Manager and govern it with Consent Mode (#2).
- **Access:** their **CMS/theme editor** (to edit the snippet) — done by their web person, or by you with a scoped CMS login. No server access.

## 2. Tags fire via Google Tag Manager with no Consent Mode
- **Scan flag:** Google/ad tags fire but the pixel isn't in the served HTML (injected at runtime).
- **Cause:** GTM fires tags on page view with no consent gating.
- **Fix:** implement **Google Consent Mode v2** — default `ad_storage`/`analytics_storage`/`ad_user_data`/`ad_personalization` = *denied*; update to granted only on consent; gate tags on the consent trigger.
- **Access:** a scoped **GTM container invite** (Publish permission) — a normal, revocable agency-style grant. Not server access.

## 3. CMP installed but not actually blocking
- **Scan flag:** a CMP (Termly/CookieYes/etc.) is detected, yet trackers still fire pre-consent.
- **Cause:** "auto-block"/prior-blocking is off or misconfigured; tags aren't categorized; the CMP script doesn't load first.
- **Fix:** enable prior-blocking/auto-block in the CMP, categorize each tag, ensure the CMP loads before everything else.
- **Access:** the customer's **CMP dashboard** (admin invite). No server access.

## 4. GPC / opt-out preference signal not honored
- **Scan flag:** scanned with `Sec-GPC: 1`, sale/share trackers fired anyway.
- **Cause:** the CMP's "treat GPC as opt-out" setting is off.
- **Fix:** enable the GPC / opt-out-signal honoring toggle in the CMP.
- **Access:** **CMP dashboard** — often a single toggle. No server access.

## 5. No "Do Not Sell/Share" / "Your Privacy Choices" link
- **Scan flag:** sharing identifiers but no opt-out link found on homepage/footer.
- **Cause:** opt-out mechanism never added.
- **Fix:** add a persistent footer **"Your Privacy Choices"** link opening the CMP preference center, plus a simple data-subject-request intake form.
- **Access:** **CMS** (add footer link) + **CMP** (preference center). No server access.

## 6. Session recording capturing PII before consent (Hotjar/FullStory/Clarity)
- **Scan flag:** session-replay tool detected firing pre-consent.
- **Cause:** replay script loads on page view; input not masked.
- **Fix:** gate the replay script behind consent (#1/#2), enable **input masking / suppress keystrokes**, and disclose it in the policy.
- **Access:** the **replay tool's dashboard** (masking settings) + CMS/GTM to gate. No server access.

## 7. Live-chat widget loads before consent
- **Scan flag:** chat widget detected (Intercom/Drift/HubSpot/etc.).
- **Cause:** widget loads on page view, routing data to a third party.
- **Fix:** load the widget **on user interaction / after consent**, and disclose the third party.
- **Access:** CMS/GTM to change how the widget loads. No server access.

## 8. Video + Meta Pixel (VPPA exposure)
- **Scan flag:** video present on a page that also runs the Meta Pixel.
- **Cause:** the pixel sends video-viewing data tied to a Facebook ID.
- **Fix:** remove the Meta Pixel from video pages or gate it behind consent; use privacy-enhanced embeds (`youtube-nocookie`); don't pass video titles/IDs to the pixel.
- **Access:** CMS/GTM. No server access.

## 9. Tracking cookies set before consent
- **Scan flag:** `_fbp`, `_ga`, `li_*`, etc. present with no consent given.
- **Cause:** downstream of #1–#3 (the tags that set them aren't gated).
- **Fix:** fixing #1–#3 resolves this; verify by re-scan showing zero pre-consent cookies.
- **Access:** as per #1–#3.

## 10. Two or more consent tools installed
- **Scan flag:** multiple CMPs detected (e.g., Termly **and** CookieYes).
- **Cause:** leftover/duplicate installs; neither configured to actually gate.
- **Fix:** pick one, configure it properly (#3/#4), remove the others.
- **Access:** CMS + CMP dashboards. No server access.

## 11. Stale or missing privacy policy
- **Scan flag:** no policy link on homepage, or policy doesn't match the trackers actually present.
- **Cause:** never written, outdated PDF, or doesn't reflect reality.
- **Fix:** publish a real web-page policy listing the trackers actually in use + the required state-law disclosures and the opt-out method.
- **Access:** CMS to publish. No server access.

---

## The access takeaway (for the pitch)
- **Monitoring (the subscription) needs ZERO access** — it just loads their public site on a schedule.
- **Remediation** needs, at most, a **scoped, revocable invite to a specific tool** (GTM container, CMP admin, or CMS editor) — the same thing any web/marketing agency gets. **Never a server login.**
- Default offer is **done-with-you**: you hand them this exact change list and verify with a re-scan. **Done-for-you** (you make the changes) is an upsell for customers who grant the scoped tool access.
