import Stripe from "stripe";

/**
 * Stripe lives ONLY for signature verification here — constructEvent uses the
 * webhook signing secret, not the API key, so STRIPE_SECRET_KEY is optional
 * (only needed later if we want to enrich events via the Stripe API).
 */
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || "sk_unused_for_signature_verification");

/** Verify the Stripe signature and return the parsed event. Throws on bad signature. */
export function verifyAndParse(rawBody, signature) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) throw new Error("STRIPE_WEBHOOK_SECRET not set");
  if (!signature) throw new Error("missing stripe-signature header");
  return stripe.webhooks.constructEvent(rawBody, signature, secret);
}

/** Data Manager API wants RFC3339, e.g. "2026-06-24T14:07:01.000Z". */
function toRfc3339(unixSeconds) {
  return new Date(unixSeconds * 1000).toISOString();
}

/**
 * TicketingHub stamps its order reference ("OR-E4 …") into the charge/PI
 * description and often the Checkout session client_reference_id. We read it to
 * join the sale with the gclid the thank-you page posted to /attribution/link.
 * Returns "" when no reference is found (→ email-only upload, as before).
 */
export function extractOrderRef(event) {
  const o = event?.data?.object || {};
  const candidates = [o.description, o.client_reference_id, o.statement_descriptor, o.statement_descriptor_suffix];
  for (const c of candidates) {
    const m = String(c || "").match(/\bOR-[A-Z0-9]+\b/i);
    if (m) return m[0].toUpperCase();
  }
  return "";
}

/**
 * Map a Stripe event to a conversion payload, or a {skip} reason.
 *
 * Primary event: checkout.session.completed (TicketingHub → Stripe Checkout).
 * Fallback:      charge.succeeded (in case the account is configured that way).
 * orderId keys on payment_intent so the two event types dedup to one conversion.
 *
 * @returns {{email,amount,currency,orderId,eventTimestamp} | {skip:string}}
 */
export function extractConversion(event) {
  const when = toRfc3339(event.created);
  const orderRef = extractOrderRef(event);

  if (event.type === "checkout.session.completed") {
    const s = event.data.object;
    if (s.payment_status && s.payment_status !== "paid") return { skip: `payment_status:${s.payment_status}` };
    const email = s.customer_details?.email || s.customer_email;
    if (!email) return { skip: "no_email" };
    const amount = (s.amount_total ?? 0) / 100;
    if (!amount) return { skip: "zero_amount" };
    return {
      email,
      amount,
      currency: s.currency,
      orderId: s.payment_intent || s.id,
      orderRef,
      eventTimestamp: when,
    };
  }

  if (event.type === "charge.succeeded") {
    const c = event.data.object;
    if (c.refunded) return { skip: "refunded" };
    const email = c.billing_details?.email || c.receipt_email;
    if (!email) return { skip: "no_email" };
    const amount = (c.amount ?? 0) / 100;
    if (!amount) return { skip: "zero_amount" };
    return {
      email,
      amount,
      currency: c.currency,
      orderId: c.payment_intent || c.id,
      orderRef,
      eventTimestamp: when,
    };
  }

  return { skip: `ignored_event:${event.type}` };
}
