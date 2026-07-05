import fs from "node:fs";

/**
 * Tiny file-backed store mapping a TicketingHub order reference (e.g. "OR-E4")
 * to the ad click id (gclid/gbraid/wbraid) captured first-party on the booking
 * page.
 *
 * WHY this exists: the booking widget is a cross-origin iframe on TicketingHub's
 * domain, and TicketingHub owns the Stripe objects (it's a Connect *platform* —
 * charges carry `application: ca_…` + an application_fee). So we can neither
 * inject the gclid into the iframe form (like we do for the Tally private-tour
 * flow) nor write it into the Stripe metadata. Instead:
 *   1. the booking page stores the gclid first-party (localStorage),
 *   2. the thank-you page POSTs {orderRef, gclid} to /attribution/link,
 *   3. the Stripe webhook handler joins on the order reference it reads from the
 *      PaymentIntent/charge description ("OR-xx …") and uploads with the gclid.
 *
 * Volume is ~10 bookings/day → an in-memory Map persisted to one JSON file
 * (atomic tmp+rename) is plenty. Entries expire after TTL to bound the file.
 * Persistence is best-effort: if ATTRIBUTION_STORE_PATH is unset or unwritable
 * we degrade to pure in-memory (fine for the common seconds-long ping→webhook
 * window; only a worker restart mid-flight would lose an entry).
 */

const TTL_MS = Number(process.env.ATTRIBUTION_TTL_MS || 6 * 60 * 60 * 1000); // 6h
const STORE_PATH = process.env.ATTRIBUTION_STORE_PATH || "";

/** @type {Map<string, {gclid?:string, gbraid?:string, wbraid?:string, ts:number}>} */
const map = new Map();

const REF_RE = /^OR-[A-Z0-9]{1,24}$/;
const CLICKID_RE = /^[A-Za-z0-9._-]{6,1024}$/;

/** Normalise + validate an order reference, or return "" if it doesn't look like one. */
export function normRef(raw) {
  const s = String(raw || "").trim().toUpperCase();
  return REF_RE.test(s) ? s : "";
}

function validClickId(raw) {
  return raw && CLICKID_RE.test(String(raw)) ? String(raw) : undefined;
}

function prune() {
  const cutoff = Date.now() - TTL_MS;
  for (const [k, v] of map) if (!v || v.ts < cutoff) map.delete(k);
}

function persist() {
  if (!STORE_PATH) return;
  try {
    prune();
    const tmp = STORE_PATH + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify([...map]), "utf8");
    fs.renameSync(tmp, STORE_PATH);
  } catch (err) {
    console.warn("[attribution] persist failed:", err.message);
  }
}

/** Load persisted entries on boot (best-effort). Call once at startup. */
export function loadStore() {
  if (!STORE_PATH) {
    console.log("[attribution] in-memory only (ATTRIBUTION_STORE_PATH unset)");
    return;
  }
  try {
    if (fs.existsSync(STORE_PATH)) {
      for (const [k, v] of JSON.parse(fs.readFileSync(STORE_PATH, "utf8"))) map.set(k, v);
      prune();
    }
    console.log(`[attribution] store ${STORE_PATH} — ${map.size} live entries`);
  } catch (err) {
    console.warn("[attribution] load failed:", err.message);
  }
}

/**
 * Record click ids for an order reference. First-touch wins: once a ref has a
 * click id, a later ping can't overwrite it (guards against a duplicate/late
 * beacon clobbering the real ad click).
 * @returns {boolean} true if a valid ref + at least one click id was stored/kept.
 */
export function putClickId(orderRef, { gclid, gbraid, wbraid } = {}) {
  const ref = normRef(orderRef);
  if (!ref) return false;
  const entry = {
    gclid: validClickId(gclid),
    gbraid: validClickId(gbraid),
    wbraid: validClickId(wbraid),
    ts: Date.now(),
  };
  if (!entry.gclid && !entry.gbraid && !entry.wbraid) return false;
  if (map.has(ref)) return true; // first-touch — keep the original
  map.set(ref, entry);
  persist();
  return true;
}

/** Look up stored click ids for an order reference (undefined if none/expired). */
export function getClickId(orderRef) {
  const ref = normRef(orderRef);
  if (!ref) return undefined;
  const v = map.get(ref);
  if (!v) return undefined;
  if (v.ts < Date.now() - TTL_MS) {
    map.delete(ref);
    return undefined;
  }
  return v;
}
