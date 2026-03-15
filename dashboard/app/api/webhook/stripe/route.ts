import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { uploadEnhancedConversion } from "@/lib/google-ads-conversions";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || "", {
  apiVersion: "2025-02-24.acacia",
});

/**
 * Stripe webhook endpoint.
 * On successful charge → send Enhanced Conversion to Google Ads (hashed email + amount).
 */
export async function POST(req: NextRequest) {
  const body = await req.text();
  const sig = req.headers.get("stripe-signature");

  if (!sig || !process.env.STRIPE_WEBHOOK_SECRET) {
    return NextResponse.json({ error: "Missing signature or webhook secret" }, { status: 400 });
  }

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(
      body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error("[Webhook] Signature verification failed:", err);
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  if (event.type === "charge.succeeded") {
    const charge = event.data.object as Stripe.Charge;

    // Skip refunded charges
    if (charge.refunded) {
      return NextResponse.json({ received: true });
    }

    // Get customer email from charge
    const email = charge.billing_details?.email || charge.receipt_email;
    if (!email) {
      console.warn("[Webhook] No email on charge", charge.id);
      return NextResponse.json({ received: true });
    }

    const amount = charge.amount / 100;
    const currency = charge.currency;
    const conversionAction = process.env.GOOGLE_ADS_CONVERSION_ACTION || "";

    if (!conversionAction) {
      console.warn("[Webhook] GOOGLE_ADS_CONVERSION_ACTION not set, skipping");
      return NextResponse.json({ received: true });
    }

    // Format datetime for Google Ads: "YYYY-MM-DD HH:MM:SS+00:00"
    const dt = new Date(charge.created * 1000);
    const conversionDateTime = dt
      .toISOString()
      .replace("T", " ")
      .replace(/\.\d{3}Z$/, "+00:00");

    const result = await uploadEnhancedConversion({
      email,
      amount,
      currency,
      conversionAction,
      orderId: charge.id,
      conversionDateTime,
    });

    if (!result.success) {
      console.error("[Webhook] Google Ads upload failed:", result.error);
    }
  }

  return NextResponse.json({ received: true });
}
