import http from "node:http";
import { verifyAndParse, extractConversion } from "./stripe-handler.js";
import { verifyTallySignature, extractLead } from "./tally-handler.js";
import { uploadConversionEvent } from "./data-manager.js";

const PORT = Number(process.env.PORT || 3020);
const MAX_BODY = 1_000_000; // 1 MB — Stripe events are small

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

    const result = await uploadConversionEvent(conv);
    if (result.ok) {
      console.log(
        `[data-manager] uploaded order=${conv.orderId} ${conv.amount} ${conv.currency} (${event.type}) requestId=${result.requestId || "-"}`
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
  });
});
