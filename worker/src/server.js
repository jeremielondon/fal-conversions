import http from "node:http";
import { verifyAndParse, extractConversion, fetchEmailFromStripe } from "./stripe-handler.js";
import { verifyTallySignature, extractLead } from "./tally-handler.js";
import { uploadConversionEvent, hashEmailHex } from "./data-manager.js";
import { loadStore, putClickId, getClickId } from "./attribution-store.js";

const PORT = Number(process.env.PORT || 3020);
const MAX_BODY = 1_000_000; // 1 MB — Stripe events are small

// Where the thank-you page beacons are allowed to come from (comma-separated).
const ALLOWED_ORIGINS = (process.env.ATTRIBUTION_ALLOWED_ORIGIN || "https://francaisalondres.com")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
// How long the Stripe webhook waits for the matching gclid beacon before falling
// back to an email-only upload (kept well under Stripe's webhook timeout).
const MATCH_WAIT_MS = Number(process.env.ATTRIBUTION_MATCH_WAIT_MS || 5000);

loadStore();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * The gclid beacon (thank-you page) and the Stripe webhook race by a second or
 * two. Poll the store briefly so the webhook can attach the gclid instead of
 * uploading email-only. Returns the click-id entry, or undefined on timeout.
 */
async function waitForClickId(orderRef, budgetMs) {
  const deadline = Date.now() + Math.max(0, budgetMs);
  for (;;) {
    const hit = getClickId(orderRef);
    if (hit) return hit;
    if (Date.now() >= deadline) return undefined;
    await sleep(400);
  }
}

/** CORS headers for the /attribution/link endpoint (echo allowed origin only). */
function corsHeaders(req) {
  const h = { "Content-Type": "application/json" };
  const origin = req.headers.origin || "";
  if (ALLOWED_ORIGINS.includes(origin)) {
    h["Access-Control-Allow-Origin"] = origin;
    h["Access-Control-Allow-Methods"] = "POST, OPTIONS";
    h["Access-Control-Allow-Headers"] = "Content-Type";
    h["Access-Control-Max-Age"] = "86400";
  }
  return h;
}

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new Error("payload too large"));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function send(res, status, obj) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(obj));
}

const server = http.createServer(async (req, res) => {
  // Health (cx43 healthcheck hits http://127.0.0.1:PORT/health)
  if (req.method === "GET" && (req.url === "/health" || req.url === "/healthz")) {
    return send(res, 200, { status: "ok" });
  }

  if (req.method === "POST" && req.url === "/webhook/stripe") {
    let event;
    try {
      const raw = await readRawBody(req);
      event = verifyAndParse(raw, req.headers["stripe-signature"]);
    } catch (err) {
      console.warn("[webhook] rejected:", err.message);
      return send(res, 400, { error: "invalid signature" });
    }

    const conv = extractConversion(event);
    if (conv.skip) {
      console.log(`[webhook] skip ${event.id} (${event.type}): ${conv.skip}`);
      return send(res, 200, { received: true, skipped: conv.skip });
    }

    // Enrich with the gclid + hashed email the booking page beaconed for this
    // order reference (joins on the "OR-xx" TicketingHub ref read from the
    // PI/charge description; TicketingHub charges carry no inline email).
    if (conv.orderRef) {
      const hit = await waitForClickId(conv.orderRef, MATCH_WAIT_MS);
      if (hit) {
        conv.gclid = hit.gclid;
        conv.gbraid = hit.gbraid;
        conv.wbraid = hit.wbraid;
        conv.emailHash = hit.emailHash;
      }
    }

    // Last resort: TicketingHub attaches the buyer's email to the charge only
    // *after* the webhook fires, so the payload looks identifier-less even for
    // ad-driven sales (beacon misses cross-device, private windows, cleared
    // storage). Re-read the charge so the sale still ships an enhanced-conversion
    // email. Google credits it only if it can match a real ad click, so organic
    // sales cannot inflate the count.
    if (!conv.email && !conv.emailHash && !conv.gclid && !conv.gbraid && !conv.wbraid) {
      conv.email = await fetchEmailFromStripe({ chargeId: conv.chargeId, customerId: conv.customerId });
    }

    // Need ≥1 identifier: email from the charge, hashed email from the beacon, or
    // an ad click id. Organic sales with none (no inline email, no beacon) → skip.
    if (!conv.email && !conv.emailHash && !conv.gclid && !conv.gbraid && !conv.wbraid) {
      console.log(`[webhook] skip ${event.id} (${event.type}): no_identifier ref=${conv.orderRef || "-"}`);
      return send(res, 200, { received: true, skipped: "no_identifier" });
    }

    const result = await uploadConversionEvent(conv);
    if (result.ok) {
      console.log(
        `[data-manager] uploaded order=${conv.orderId} ref=${conv.orderRef || "-"} gclid=${conv.gclid ? "y" : "n"} email=${(conv.email || conv.emailHash) ? "y" : "n"} ${conv.amount} ${conv.currency} (${event.type}) requestId=${result.requestId || "-"}`
      );
      return send(res, 200, { received: true, uploaded: true });
    }

    console.error(
      `[data-manager] upload FAILED order=${conv.orderId} status=${result.status || "-"} retryable=${result.retryable}: ${result.error}`
    );
    if (result.retryable) {
      // 500 → Stripe retries with backoff; transactionId keeps it idempotent.
      return send(res, 500, { error: "upstream error, will retry" });
    }
    // Permanent failure (bad config/data): ack so Stripe doesn't hammer the endpoint.
    return send(res, 200, { received: true, uploaded: false, error: result.error });
  }

  // Thank-you page beacon: {orderRef, gclid, gbraid?, wbraid?} captured
  // first-party on the booking flow. Stored so the Stripe webhook can join it.
  if (req.url === "/attribution/link") {
    if (req.method === "OPTIONS") {
      res.writeHead(204, corsHeaders(req));
      return res.end();
    }
    if (req.method === "POST") {
      const origin = req.headers.origin || "";
      // sendBeacon includes Origin on cross-origin POSTs; reject anything not
      // from the site. (Low-stakes data, but this blocks casual spoofing.)
      if (origin && !ALLOWED_ORIGINS.includes(origin)) {
        console.warn(`[attribution] rejected origin: ${origin}`);
        return send(res, 403, { error: "forbidden origin" });
      }
      let data;
      try {
        const raw = await readRawBody(req); // text/plain blob from sendBeacon
        data = JSON.parse(raw.toString("utf8"));
      } catch {
        return send(res, 400, { error: "bad body" });
      }
      // hash the email immediately (never store/log the plaintext) — it's the
      // second identifier since TicketingHub charges carry no inline email.
      const emailHash = data?.email ? hashEmailHex(String(data.email)) : undefined;
      const stored = putClickId(data?.orderRef, {
        gclid: data?.gclid,
        gbraid: data?.gbraid,
        wbraid: data?.wbraid,
        emailHash,
      });
      console.log(`[attribution] link ref=${data?.orderRef || "-"} gclid=${data?.gclid ? "y" : "n"} email=${emailHash ? "y" : "n"} stored=${stored}`);
      res.writeHead(stored ? 204 : 202, corsHeaders(req));
      return res.end();
    }
  }

  // Tally lead form (Tours Privés) → private_tour_lead conversion.
  if (req.method === "POST" && req.url === "/webhook/tally") {
    let payload;
    try {
      const raw = await readRawBody(req);
      verifyTallySignature(raw, req.headers["tally-signature"], process.env.TALLY_SIGNING_SECRET);
      payload = JSON.parse(raw.toString("utf8"));
    } catch (err) {
      console.warn("[tally] rejected:", err.message);
      return send(res, 400, { error: "invalid signature or body" });
    }

    const lead = extractLead(payload);
    if (lead.skip) {
      console.log(`[tally] skip ${payload?.eventId || "-"}: ${lead.skip}`);
      return send(res, 200, { received: true, skipped: lead.skip });
    }

    const result = await uploadConversionEvent({
      ...lead,
      conversionActionId: process.env.GOOGLE_ADS_LEAD_CONVERSION_ACTION,
    });
    if (result.ok) {
      console.log(
        `[data-manager] uploaded lead=${lead.orderId} ${lead.value ?? "-"} ${lead.currency} gclid=${lead.gclid ? "y" : "n"} requestId=${result.requestId || "-"}`
      );
      return send(res, 200, { received: true, uploaded: true });
    }

    console.error(
      `[data-manager] lead upload FAILED lead=${lead.orderId} status=${result.status || "-"} retryable=${result.retryable}: ${result.error}`
    );
    if (result.retryable) return send(res, 500, { error: "upstream error, will retry" });
    return send(res, 200, { received: true, uploaded: false, error: result.error });
  }

  return send(res, 404, { error: "not found" });
});

server.listen(PORT, "0.0.0.0", () => {
  const present = (k) => (process.env[k] ? "✓" : "✗ MISSING");
  console.log(`[fal-tracking] listening on :${PORT} — Data Manager API v1` +
    (String(process.env.GOOGLE_ADS_VALIDATE_ONLY) === "true" ? " (VALIDATE_ONLY)" : ""));
  console.log("[fal-tracking] env:", {
    STRIPE_WEBHOOK_SECRET: present("STRIPE_WEBHOOK_SECRET"),
    TALLY_SIGNING_SECRET: present("TALLY_SIGNING_SECRET"),
    GOOGLE_ADS_CONVERSION_ACTION: present("GOOGLE_ADS_CONVERSION_ACTION"),
    GOOGLE_ADS_LEAD_CONVERSION_ACTION: present("GOOGLE_ADS_LEAD_CONVERSION_ACTION"),
    GOOGLE_ADS_CUSTOMER_ID: present("GOOGLE_ADS_CUSTOMER_ID"),
    GOOGLE_CLIENT_ID: present("GOOGLE_CLIENT_ID"),
    GOOGLE_REFRESH_TOKEN: present("GOOGLE_REFRESH_TOKEN"),
    ATTRIBUTION_ALLOWED_ORIGIN: ALLOWED_ORIGINS.join(","),
    ATTRIBUTION_STORE_PATH: process.env.ATTRIBUTION_STORE_PATH || "(memory)",
  });
});
