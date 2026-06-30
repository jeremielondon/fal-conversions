import crypto from "node:crypto";

/**
 * Tally webhook handling — verify the HMAC signature and map a form submission
 * to a lead conversion payload for the Data Manager API.
 *
 * Tally signs each webhook with the form's signing secret:
 *   tally-signature: Base64( HMAC-SHA256(rawBody, signingSecret) )
 * (https://tally.so/help/webhooks). Verify on the RAW body, before JSON.parse.
 *
 * Form 3l8vMk ("🏛️ Tours Privés Londres") → lead. The "Budget" number field
 * (EUR) becomes the conversion value so Smart Bidding favours bigger jobs; the
 * optional hidden "gclid" field gives exact-match attribution on top of email.
 */

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/** Verify the tally-signature header against our own HMAC (constant-time). Throws on mismatch. */
export function verifyTallySignature(rawBody, signatureHeader, secret) {
  if (!secret) throw new Error("TALLY_SIGNING_SECRET not set");
  if (!signatureHeader) throw new Error("missing tally-signature header");
  const expected = crypto.createHmac("sha256", secret).update(rawBody).digest("base64");
  const a = Buffer.from(expected);
  const b = Buffer.from(String(signatureHeader));
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    throw new Error("invalid tally signature");
  }
}

/** First non-empty field value matching a type and/or a label substring (case-insensitive). */
function pickValue(fields, { type, labelIncludes } = {}) {
  for (const f of fields || []) {
    if (type && f.type !== type) continue;
    if (labelIncludes && !String(f.label || "").toLowerCase().includes(labelIncludes)) continue;
    if (f.value !== undefined && f.value !== null && f.value !== "") return f.value;
  }
  return undefined;
}

/**
 * Map a Tally FORM_RESPONSE payload → lead conversion payload, or a {skip} reason.
 * orderId = submissionId (idempotent dedup within the destination).
 *
 * @returns {{email,value,currency,orderId,gclid?,eventTimestamp} | {skip:string}}
 */
export function extractLead(payload) {
  if (!payload || payload.eventType !== "FORM_RESPONSE") {
    return { skip: `ignored_event:${payload?.eventType || "none"}` };
  }
  const d = payload.data || {};
  const fields = d.fields || [];

  // email: prefer the typed email field, else any field whose value looks like an email
  let email = pickValue(fields, { type: "INPUT_EMAIL" });
  if (!email) {
    const cand = (fields || []).find((f) => EMAIL_RE.test(String(f.value || "")));
    email = cand ? cand.value : undefined;
  }
  if (!email || !EMAIL_RE.test(String(email))) return { skip: "no_email" };

  // budget (EUR) → conversion value; left undefined falls back to the action default downstream
  const budgetRaw = pickValue(fields, { type: "INPUT_NUMBER", labelIncludes: "budget" });
  const budget = Number(budgetRaw);
  const value = Number.isFinite(budget) && budget > 0 ? budget : undefined;

  // optional hidden gclid → exact-match attribution
  const gclid = pickValue(fields, { labelIncludes: "gclid" });

  return {
    email: String(email),
    value,
    currency: "EUR",
    orderId: String(d.submissionId || d.responseId || payload.eventId),
    gclid: gclid ? String(gclid) : undefined,
    eventTimestamp: payload.createdAt || d.createdAt || new Date().toISOString(),
  };
}
