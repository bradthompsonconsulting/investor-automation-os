/**
 * Mailers — Friday email digest. Scheduled via netlify.toml (Fridays ~8am CT).
 * Read-only: builds the same shared digest the /mailers page shows, reads the
 * per-account recipient from the mailer_digest_recipient custom value at send
 * time (not hardcoded), and sends via Resend (shared account, single API key).
 *
 * Netlify hits this on a schedule with no query params; it can also be hit
 * directly by URL for manual testing (returns a JSON summary either way).
 */

import { buildMailerDigest, type MailerDigest, type MailerGroup } from "./lib/mailer-shared";

const LOCATION_ID = "jmHG4B8RdzwpfqruNf68";

// mailer_digest_recipient custom value, created once via the GHL API.
// The VALUE is read fresh every send — only this pointer ID is fixed, same as
// every other custom-value ID already hardcoded in this codebase.
const MAILER_DIGEST_RECIPIENT_ID = "IjDam7C5cUR4l7uENWQT";

const RESEND_FROM = "IAOS Mailers <digest@mailers.investorautomationos.com>";

async function getDigestRecipient(token: string): Promise<string> {
  const res = await fetch(
    `https://services.leadconnectorhq.com/locations/${LOCATION_ID}/customValues/${MAILER_DIGEST_RECIPIENT_ID}`,
    { headers: { Authorization: `Bearer ${token}`, Version: "2021-07-28" } },
  );
  const body = await res.json();
  if (!res.ok) throw new Error(`GET customValues/${MAILER_DIGEST_RECIPIENT_ID} → ${res.status}: ${JSON.stringify(body)}`);
  const value = body.customValue?.value?.trim();
  if (!value) throw new Error("mailer_digest_recipient custom value is empty");
  return value;
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}

function renderGroups(groups: MailerGroup[], emptyLabel: string): string {
  if (groups.length === 0) {
    return `<p style="color:#64748B;font-size:13px;margin:4px 0 16px;">${emptyLabel}</p>`;
  }
  return groups.map((g) => `
    <table cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;margin:0 0 14px;border:1px solid #1B2433;border-radius:6px;overflow:hidden;">
      <tr>
        <td colspan="4" style="background:#07142E;padding:8px 12px;font-size:13px;font-weight:600;color:#F1F5F9;">
          ${esc(g.label)} <span style="color:#64748B;font-weight:500;">(${g.rows.length})</span>
        </td>
      </tr>
      ${g.rows.map((r) => `
        <tr style="border-top:1px solid #1B2433;">
          <td style="padding:7px 12px;font-size:13px;color:#F1F5F9;">${esc(r.contactName || "Unknown")}</td>
          <td style="padding:7px 12px;font-size:12px;color:#94A3B8;">${esc(r.address)}</td>
          <td style="padding:7px 12px;font-size:12px;color:#64748B;white-space:nowrap;">Touch ${r.touchNumber}</td>
          <td style="padding:7px 12px;font-size:12px;color:#64748B;white-space:nowrap;">${esc(r.dueDateCT)}</td>
        </tr>
      `).join("")}
    </table>
  `).join("");
}

function renderEmailHtml(digest: MailerDigest): string {
  const typeCounts = Object.entries(digest.totals.byMailerType)
    .map(([label, n]) => `${esc(label)}: <strong>${n}</strong>`)
    .join(" &nbsp;·&nbsp; ") || "None due";

  return `
  <div style="font-family:Inter,system-ui,sans-serif;background:#0A0E1A;padding:24px;color:#F5F7FA;">
    <div style="max-width:640px;margin:0 auto;">
      <h1 style="font-size:20px;margin:0 0 4px;color:#F1F5F9;">IAOS Mailers — Week of ${esc(digest.weekStartCT)} to ${esc(digest.weekEndCT)}</h1>
      <p style="font-size:13px;color:#94A3B8;margin:0 0 4px;">
        Ready: <strong>${digest.totals.ready}</strong> &nbsp;·&nbsp;
        Business-flagged: <strong>${digest.totals.business}</strong> &nbsp;·&nbsp;
        Overdue: <strong>${digest.totals.overdue}</strong>
      </p>
      <p style="font-size:12px;color:#64748B;margin:0 0 20px;">${typeCounts}</p>

      <h2 style="font-size:15px;color:#F1F5F9;margin:0 0 8px;">This Week — Ready to Mail</h2>
      ${renderGroups(digest.thisWeekReady, "Nothing due this week.")}

      <h2 style="font-size:15px;color:#F1F5F9;margin:20px 0 8px;">This Week — Business-Flagged</h2>
      ${renderGroups(digest.thisWeekBusiness, "No business-flagged contacts due this week.")}

      <h2 style="font-size:15px;color:#F87171;margin:20px 0 8px;">Overdue</h2>
      ${renderGroups(digest.overdue, "Nothing overdue.")}

      <p style="font-size:12px;color:#334155;margin:24px 0 0;">
        This is a heads-up only — check items off in the app.
        <a href="https://app.investorautomationos.com/mailers" style="color:#1EC8FF;">Open Mailers in IAOS →</a>
      </p>
    </div>
  </div>`;
}

export const handler = async () => {
  const token = process.env.GHL_PRIVATE_API_KEY ?? process.env.GHL_API_TOKEN;
  const resendKey = process.env.RESEND_API_KEY;

  if (!token) return { statusCode: 500, body: JSON.stringify({ error: "GHL_PRIVATE_API_KEY not configured" }) };
  if (!resendKey) return { statusCode: 500, body: JSON.stringify({ error: "RESEND_API_KEY not configured" }) };

  try {
    const [digest, recipient] = await Promise.all([
      buildMailerDigest(token),
      getDigestRecipient(token),
    ]);

    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: RESEND_FROM,
        to: [recipient],
        subject: `IAOS Mailers — ${digest.totals.ready + digest.totals.business} ready, ${digest.totals.overdue} overdue (wk of ${digest.weekEndCT})`,
        html: renderEmailHtml(digest),
      }),
    });

    const resendBody = await res.json();
    if (!res.ok) throw new Error(`Resend send failed → ${res.status}: ${JSON.stringify(resendBody)}`);

    return {
      statusCode: 200,
      body: JSON.stringify({ sentTo: recipient, totals: digest.totals, resendId: resendBody.id ?? null }),
    };
  } catch (err: any) {
    console.error("[mailer-digest]", err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message ?? "Internal error" }) };
  }
};
