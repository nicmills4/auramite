# Inbound lead follow-up (free-scan → monitoring)

Sent (transactional, opted-in) to someone who ran the free scan and entered their
email. Plain, helpful, no fear-inflation. Links their own result; offers monitoring.

---

**Subject:** Your Auramite scan — what we found on {{host}}

Hi{{firstName ? ' ' + firstName : ''}},

Thanks for scanning **{{host}}**. Here's the short version of what we saw when we
loaded your homepage as a normal visitor (we clicked nothing):

{{#each topFindings}}
- **{{title}}** — {{oneLine}}
{{/each}}

The full plain-English report, with the actual network log as proof, is here:
**{{reportUrl}}**

You don't need us to confirm it — open your site in Chrome, press F12 → Network,
type a tracker name, and reload. Or use the journalists' free tool at
blacklight.themarkup.org.

**If you'd like it fixed and kept fixed:** we monitor your site, alert you the moment
a new tracker starts firing before consent, and walk you (or your web person) through
the exact fix — no access to your servers needed. Reply and I'll set it up.

— {{senderName}}, Auramite
{{physicalAddress}} · Unsubscribe: {{unsubscribeUrl}}

*Plain-English explanation of measurable findings — not legal advice.*

---

**Notes for sending:** include a physical address + working unsubscribe (CAN-SPAM).
Send from a domain with SPF/DKIM/DMARC. This is transactional (they asked), so
deliverability is far better than cold — but still authenticate the domain.
