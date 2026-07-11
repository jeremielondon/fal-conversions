/**
 * FAL Conversions — Ghost code injection setup
 * Injects the tracking script into Ghost's site-wide code injection (footer).
 * Usage: npx tsx setup.ts
 */
import "dotenv/config";
import { SignJWT } from "jose";
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// --- Config ---
const GHOST_URL = "https://francaisalondres.com";
const GHOST_ADMIN_KEY = process.env.GHOST_ADMIN_KEY;
if (!GHOST_ADMIN_KEY) {
  throw new Error(
    "GHOST_ADMIN_KEY is not set. Add it to your .env file (format: id:secret)"
  );
}

// --- Ghost JWT ---
async function makeGhostToken(): Promise<string> {
  const [id, secret] = GHOST_ADMIN_KEY.split(":");
  const key = Buffer.from(secret, "hex");
  return new SignJWT({})
    .setProtectedHeader({ alg: "HS256", typ: "JWT", kid: id })
    .setIssuedAt()
    .setExpirationTime("5m")
    .setAudience("/admin/")
    .sign(key);
}

// --- Read tracking script ---
function getTrackingScript(): string {
  const scriptContent = readFileSync(
    resolve(__dirname, "ghost-tracking.js"),
    "utf-8"
  );
  return `\n<!-- FAL Conversions Tracking -->\n<script>\n${scriptContent}\n</script>\n<!-- /FAL Conversions Tracking -->`;
}

// --- Main ---
async function main() {
  const token = await makeGhostToken();
  const headers = {
    Authorization: `Ghost ${token}`,
    "Content-Type": "application/json",
  };

  // 1. Get current settings
  console.log("Fetching current Ghost settings...");
  const getRes = await fetch(`${GHOST_URL}/ghost/api/admin/settings/`, {
    headers,
  });
  if (!getRes.ok) {
    throw new Error(
      `Failed to fetch settings: ${getRes.status} ${await getRes.text()}`
    );
  }
  const data = await getRes.json();

  // 2. Find current codeinjection_foot
  const settings = data.settings || [];
  const footSetting = settings.find(
    (s: { key: string }) => s.key === "codeinjection_foot"
  );
  let currentFoot = footSetting?.value || "";

  // 3. Remove old injection if present, then append new
  const marker = "<!-- FAL Conversions Tracking -->";
  const endMarker = "<!-- /FAL Conversions Tracking -->";
  const markerIdx = currentFoot.indexOf(marker);
  if (markerIdx !== -1) {
    const endIdx = currentFoot.indexOf(endMarker);
    if (endIdx !== -1) {
      currentFoot =
        currentFoot.slice(0, markerIdx) +
        currentFoot.slice(endIdx + endMarker.length);
      console.log("Removed existing FAL tracking script.");
    }
  }

  const newFoot = currentFoot.trim() + getTrackingScript();

  // 4. Update settings
  console.log("Injecting tracking script into Ghost footer...");
  const putRes = await fetch(`${GHOST_URL}/ghost/api/admin/settings/`, {
    method: "PUT",
    headers,
    body: JSON.stringify({
      settings: [{ key: "codeinjection_foot", value: newFoot }],
    }),
  });

  if (!putRes.ok) {
    throw new Error(
      `Failed to update settings: ${putRes.status} ${await putRes.text()}`
    );
  }

  console.log("Tracking script injected successfully!");
  console.log(
    "\nNext steps:"
  );
  console.log(
    "1. Import gtm-container.json into GTM (GTM-5BZBVQWW)"
  );
  console.log(
    "2. Publish GTM container"
  );
  console.log(
    "3. Test: visit francaisalondres.com, click a Bokun link, check GA4 DebugView for click_bokun event"
  );
}

main().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});
