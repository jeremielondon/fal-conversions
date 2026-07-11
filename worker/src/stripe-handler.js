import Stripe from "stripe";

/**
 * Signature verification only needs the webhook secret. The API key is what lets
 * us re-read a charge (see fetchEmailFromStripe) — without it the worker still
 * runs, it just can't recover the buyer's email.
 */
const API_KEY = process.env.STRIPE_SECRET_KEY || "";
const stripe = new Stripe(API_KEY || "sk_unused_for_signature_verification");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * TicketingHub finalises the order slightly AFTER Stripe fires charge.succeeded:
 * the webhook payload carries no billing_details.email / receipt_email, yet the
 * same charge (and its customer) hold one moments later. Re-read it so every sale
 * ships at least one identifier — otherwise Google can never tie a sale back to
 * an ad click and tour_purchase stays stuck at zero.
 *
 * Safe by construction: Google only credits a conversion it can match to a real
 * ad click, so uploading organic sales cannot inflate the numbers.
 *
 * Returns undefined when no key is configured or the lookup fails — the caller
 * then skips the event exactly as before.
 */
export async function fetchEmailFromStripe({ chargeId, customerId }) {
  if (!API_KEY || (!chargeId && !customerId)) return undefined;

  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt) await sleep(2000); // the order may still be settling on their side
    try {
      let custId = customerId;

      if (chargeId) {
        const charge = await stripe.charges.retrieve(chargeId, { expand: ["customer"] });
        const cust = charge?.customer;
        const email =
          charge?.billing_details?.email ||
          charge?.receipt_email ||
          (typeof cust === "object" ? cust?.email : undefined);
        if (email) return email;
        custId = custId || (typeof cust === "string" ? cust : cust?.id);
      }

      if (custId) {
        const customer = await stripe.customers.retrieve(custId);
        if (customer?.email) return customer.email;
      }
    } catch (err) {
      console.warn(`[stripe] email lookup failed: ${err.message}`);
      return undefined;
    }
  }
  return undefined;
}

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
    // email may be absent (TicketingHub charges keep it on the customer, not the
    // event) → don't skip here; the beacon supplies it, or the gclid suffices.
    const email = s.customer_details?.email || s.customer_email || undefined;
    const amount = (s.amount_total ?? 0) / 100;
    if (!amount) return { skip: "zero_amount" };
    return {
      email,
      amount,
      currency: s.currency,
      orderId: s.payment_intent || s.id,
      orderRef,
      customerId: typeof s.customer === "string" ? s.customer : s.customer?.id,
      eventTimestamp: when,
    };
  }

  if (event.type === "charge.succeeded") {
    const c = event.data.object;
    if (c.refunded) return { skip: "refunded" };
    // Almost always absent on TicketingHub charges at webhook time — the server
    // recovers it from the Stripe API via chargeId/customerId (fetchEmailFromStripe).
    const email = c.billing_details?.email || c.receipt_email || undefined;
    const amount = (c.amount ?? 0) / 100;
    if (!amount) return { skip: "zero_amount" };
    return {
      email,
      amount,
      currency: c.currency,
      orderId: c.payment_intent || c.id,
      orderRef,
      chargeId: c.id,
      customerId: typeof c.customer === "string" ? c.customer : c.customer?.id,
      eventTimestamp: when,
    };
  }

  return { skip: `ignored_event:${event.type}` };
}
