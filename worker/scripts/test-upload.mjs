#!/usr/bin/env node
/**
 * Dry-run d'un upload de conversion vers la Data Manager API (Google Ads).
 * Lit toute la config depuis l'environnement (aucun secret en dur ici).
 *
 * Usage (mettre GOOGLE_ADS_VALIDATE_ONLY=true pour ne RIEN enregistrer) :
 *   GOOGLE_ADS_VALIDATE_ONLY=true \
 *   GOOGLE_ADS_CUSTOMER_ID=... GOOGLE_ADS_LOGIN_CUSTOMER_ID=... \
 *   GOOGLE_ADS_CONVERSION_ACTION=... \
 *   GOOGLE_CLIENT_ID=... GOOGLE_CLIENT_SECRET=... GOOGLE_REFRESH_TOKEN=... \
 *   node scripts/test-upload.mjs
 */
import { uploadConversionEvent } from "../src/data-manager.js";

const res = await uploadConversionEvent({
  email: "diagnostic-test@example.com",
  amount: 25,
  currency: "GBP",
  orderId: "diagnostic-" + (process.env.TEST_ORDER || "001"),
  eventTimestamp: "2026-06-24T12:00:00.000Z",
});

console.log("\nResult:", JSON.stringify(res, null, 2));
console.log(res.ok ? "\n✅ Pipeline Data Manager OK" : "\n❌ Voir l'erreur ci-dessus");
