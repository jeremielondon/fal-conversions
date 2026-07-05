import crypto from "node:crypto";
import { OAuth2Client } from "google-auth-library";

/**
 * Upload an offline conversion (enhanced conversions for leads — hashed email,
 * no gclid) to Google Ads via the **Data Manager API**.
 *
 *   POST https://datamanager.googleapis.com/v1/events:ingest
 *
 * The old Google Ads API ConversionUploadService is closed to new integrations
 * ("limited to existing users") — Data Manager is the supported path. Notable
 * differences vs the old API:
 *   - NO developer token required (project-based quotas)
 *   - OAuth scope is https://www.googleapis.com/auth/datamanager (not adwords)
 *   - the destination account/conversion-action live in the request body, not headers
 *   - email is SHA-256 **HEX** (request-level `encoding: HEX`), timestamps are RFC3339
 *
 * One-time prerequisites (manual, Google Ads UI): Customer Data Terms accepted +
 * "Enhanced conversions for leads" enabled. And the Data Manager API enabled in
 * the Google Cloud project. The conversion action must be type UPLOAD_CLICKS.
 */

const ENDPOINT = "https://datamanager.googleapis.com/v1/events:ingest";

const oauth = new OAuth2Client(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET
);
oauth.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN });

/** lowercase + trim; strip dots in the local part for gmail/googlemail (Google's rule). */
function normalizeEmail(email) {
  let e = String(email).trim().toLowerCase();
  const at = e.lastIndexOf("@");
  if (at > 0) {
    let local = e.slice(0, at);
    const domain = e.slice(at + 1);
    if (domain === "gmail.com" || domain === "googlemail.com") local = local.replace(/\./g, "");
    e = local + "@" + domain;
  }
  return e;
}

export function hashEmailHex(email) {
  return crypto.createHash("sha256").update(normalizeEmail(email)).digest("hex");
}

function mapConsent(value, fallback) {
  const x = String(value || fallback).toUpperCase();
  if (x === "GRANTED" || x === "CONSENT_GRANTED") return "CONSENT_GRANTED";
  if (x === "DENIED" || x === "CONSENT_DENIED") return "CONSENT_DENIED";
  return "CONSENT_STATUS_UNSPECIFIED";
}

/** Extract the trailing numeric id from a full resource name (.../conversionActions/123) or a bare id. */
function idFrom(raw) {
  const m = String(raw || "").match(/(\d+)\s*$/);
  return m ? m[1] : "";
}

/** Default conversion action id from env (used when the caller doesn't pass one explicitly). */
function conversionActionId() {
  return idFrom(process.env.GOOGLE_ADS_CONVERSION_ACTION || process.env.GOOGLE_ADS_CONVERSION_ACTION_ID || "");
}

async function getAccessToken() {
  const { token } = await oauth.getAccessToken();
  if (!token) throw new Error("Failed to obtain Google access token");
  return token;
}

/**
 * @param {{ email:string, amount?:number, value?:number, currency?:string, orderId:string,
 *           eventTimestamp:string, gclid?:string, conversionActionId?:string }} p
 *   `value` (leads, e.g. quote budget) takes precedence over `amount` (purchases); when both are
 *   absent the conversion action's default value is used. `conversionActionId` overrides the env
 *   default (lets one worker feed several conversion actions). `gclid` adds exact-match attribution.
 * @returns {Promise<{ ok:true, requestId?:string } | { ok:false, retryable:boolean, status?:number, error:string }>}
 */
export async function uploadConversionEvent(p) {
  const operatingAccountId = (process.env.GOOGLE_ADS_CUSTOMER_ID || "").replace(/-/g, "");
  const loginAccountId = (process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID || "").replace(/-/g, "");
  const destId = p.conversionActionId ? idFrom(p.conversionActionId) : conversionActionId();
  const validateOnly = String(process.env.GOOGLE_ADS_VALIDATE_ONLY || "") === "true";

  if (!operatingAccountId) return { ok: false, retryable: false, error: "GOOGLE_ADS_CUSTOMER_ID not set" };
  if (!destId) return { ok: false, retryable: false, error: "GOOGLE_ADS_CONVERSION_ACTION (id) not set" };
  // Data Manager needs ≥1 identifier (hashed email and/or ad click id). Fail fast
  // before spending an OAuth token on an unsendable event.
  if (!p.emailHash && !p.email && !p.gclid && !p.gbraid && !p.wbraid) {
    return { ok: false, retryable: false, error: "no_identifier (email + gclid both absent)" };
  }

  let accessToken;
  try {
    accessToken = await getAccessToken();
  } catch (err) {
    return { ok: false, retryable: true, error: `oauth: ${err.message}` };
  }

  const destination = {
    operatingAccount: { accountType: "GOOGLE_ADS", accountId: operatingAccountId },
    productDestinationId: destId,
  };
  // loginAccount = the account our OAuth user logs in through (the MCC). Optional but
  // recommended when managing via a manager account.
  if (loginAccountId) destination.loginAccount = { accountType: "GOOGLE_ADS", accountId: loginAccountId };

  const event = {
    eventTimestamp: p.eventTimestamp, // RFC3339, e.g. "2026-06-24T14:07:01.000Z"
    transactionId: p.orderId, // dedup key within the destination
    eventSource: "WEB",
  };
  // Hashed email → "enhanced conversions" identifier. Accept a pre-hashed HEX
  // (`emailHash`, e.g. from the attribution beacon) or a plaintext `email`.
  // Optional: a gclid alone is a valid identifier (TicketingHub charges often
  // carry no inline email — it lives on the customer object, not the charge).
  const emailHex = p.emailHash || (p.email ? hashEmailHex(p.email) : undefined);
  if (emailHex) event.userData = { userIdentifiers: [{ emailAddress: emailHex }] };
  // Conversion value: leads pass `value` (budget), purchases pass `amount`. When absent, omit it
  // so Google falls back to the conversion action's configured default value.
  const value = p.value ?? p.amount;
  if (value !== undefined && value !== null && Number(value) > 0) {
    event.conversionValue = Number(value); // plain currency units (not micros)
    event.currency = String(p.currency || "GBP").toUpperCase();
  }
  // Ad click id → exact-match attribution in addition to the hashed email.
  // gclid is the usual one; gbraid/wbraid cover iOS/privacy-restricted clicks.
  if (p.gclid || p.gbraid || p.wbraid) {
    event.adIdentifiers = {};
    if (p.gclid) event.adIdentifiers.gclid = String(p.gclid);
    if (p.gbraid) event.adIdentifiers.gbraid = String(p.gbraid);
    if (p.wbraid) event.adIdentifiers.wbraid = String(p.wbraid);
  }

  const body = {
    destinations: [destination],
    encoding: "HEX",
    consent: {
      adUserData: mapConsent(process.env.GOOGLE_ADS_CONSENT_AD_USER_DATA, "GRANTED"),
      adPersonalization: mapConsent(process.env.GOOGLE_ADS_CONSENT_AD_PERSONALIZATION, "GRANTED"),
    },
    events: [event],
    validateOnly,
  };

  let res, text;
  try {
    res = await fetch(ENDPOINT, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    text = await res.text();
  } catch (err) {
    return { ok: false, retryable: true, error: `network: ${err.message}` };
  }

  if (!res.ok) {
    const retryable = res.status >= 500 || res.status === 429;
    return { ok: false, retryable, status: res.status, error: text.slice(0, 1000) };
  }

  let data = {};
  try {
    data = JSON.parse(text);
  } catch {
    /* success body may be empty */
  }
  return { ok: true, requestId: data.requestId };
}
