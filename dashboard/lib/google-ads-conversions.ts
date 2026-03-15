import crypto from "crypto";
import { OAuth2Client } from "google-auth-library";

/**
 * Send an Enhanced Conversion to Google Ads using a hashed email.
 * Uses the Google Ads REST API (no gclid needed).
 */

const API_VERSION = "v18";

interface ConversionParams {
  email: string;
  amount: number;
  currency: string;
  conversionAction: string; // e.g. "customers/8016699315/conversionActions/123456"
  orderId: string;
  conversionDateTime: string; // e.g. "2026-03-15 12:00:00+00:00"
}

function hashEmail(email: string): string {
  const normalized = email.trim().toLowerCase();
  return crypto.createHash("sha256").update(normalized).digest("hex");
}

async function getAccessToken(): Promise<string> {
  const oauth = new OAuth2Client(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET
  );
  oauth.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN });
  const { token } = await oauth.getAccessToken();
  if (!token) throw new Error("Failed to get Google access token");
  return token;
}

export async function uploadEnhancedConversion(
  params: ConversionParams
): Promise<{ success: boolean; error?: string }> {
  const customerId = (process.env.GOOGLE_ADS_CUSTOMER_ID || "").replace(
    /-/g,
    ""
  );
  const developerToken = process.env.GOOGLE_ADS_DEVELOPER_TOKEN;

  if (!developerToken) {
    return { success: false, error: "GOOGLE_ADS_DEVELOPER_TOKEN not set" };
  }

  const accessToken = await getAccessToken();

  const body = {
    conversions: [
      {
        conversion_action: params.conversionAction,
        conversion_date_time: params.conversionDateTime,
        conversion_value: params.amount,
        currency_code: params.currency.toUpperCase(),
        order_id: params.orderId,
        user_identifiers: [
          {
            hashed_email: hashEmail(params.email),
          },
        ],
      },
    ],
    partial_failure: true,
  };

  const url = `https://googleads.googleapis.com/${API_VERSION}/customers/${customerId}:uploadClickConversions`;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "developer-token": developerToken,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    console.error("[Google Ads] Upload failed:", res.status, text);
    return { success: false, error: `${res.status}: ${text}` };
  }

  const data = await res.json();

  if (data.partial_failure_error) {
    console.error(
      "[Google Ads] Partial failure:",
      JSON.stringify(data.partial_failure_error)
    );
    return {
      success: false,
      error: data.partial_failure_error.message || "Partial failure",
    };
  }

  console.log(
    "[Google Ads] Conversion uploaded:",
    params.orderId,
    params.amount,
    params.currency
  );
  return { success: true };
}
