#!/usr/bin/env node
/**
 * Génère un refresh token Google OAuth avec le scope `datamanager` (Data Manager API).
 *
 * Prérequis : un OAuth client de type "Desktop app" (Google Cloud Console →
 * APIs & Services → Credentials → Create credentials → OAuth client ID → Desktop).
 * Le type Desktop autorise le redirect loopback http://localhost sans l'enregistrer.
 *
 * Usage :
 *   cd worker
 *   npm install                       # (google-auth-library est déjà une dépendance)
 *   GOOGLE_CLIENT_ID=xxx.apps.googleusercontent.com \
 *   GOOGLE_CLIENT_SECRET=yyy \
 *   node scripts/get-refresh-token.mjs
 *
 * Le navigateur s'ouvre → tu te connectes avec le compte Google qui a accès au
 * compte Google Ads des visites → le refresh token s'affiche dans le terminal.
 *
 * ⚠️ Important : pour que le refresh token NE PÉRIME PAS au bout de 7 jours,
 * l'écran de consentement OAuth doit être "En production" (ou type Internal si
 * Google Workspace). En statut "Test", les refresh tokens expirent à 7 jours.
 */
import http from "node:http";
import { exec } from "node:child_process";
import { OAuth2Client } from "google-auth-library";

const PORT = 53682;
const REDIRECT_URI = `http://localhost:${PORT}/oauth2callback`;
const SCOPE = "https://www.googleapis.com/auth/datamanager";

const clientId = process.env.GOOGLE_CLIENT_ID;
const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

if (!clientId || !clientSecret) {
  console.error(
    "\n✗ Manque GOOGLE_CLIENT_ID et/ou GOOGLE_CLIENT_SECRET.\n" +
      "  Exemple :\n" +
      "    GOOGLE_CLIENT_ID=xxx.apps.googleusercontent.com \\\n" +
      "    GOOGLE_CLIENT_SECRET=yyy \\\n" +
      "    node scripts/get-refresh-token.mjs\n"
  );
  process.exit(1);
}

const oauth = new OAuth2Client(clientId, clientSecret, REDIRECT_URI);
const authUrl = oauth.generateAuthUrl({
  access_type: "offline",
  prompt: "consent", // force l'émission d'un refresh_token même si déjà autorisé
  scope: [SCOPE],
});

const server = http.createServer(async (req, res) => {
  if (!req.url || !req.url.startsWith("/oauth2callback")) {
    res.writeHead(404);
    res.end();
    return;
  }
  const params = new URL(req.url, REDIRECT_URI).searchParams;
  const error = params.get("error");
  const code = params.get("code");

  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end("<h2>C'est bon — tu peux fermer cet onglet et revenir au terminal.</h2>");

  if (error) {
    console.error(`\n✗ Autorisation refusée : ${error}\n`);
    server.close();
    process.exit(1);
  }

  try {
    const { tokens } = await oauth.getToken(code);
    if (tokens.refresh_token) {
      console.log("\n========================================");
      console.log("✓ REFRESH TOKEN (scope datamanager) :\n");
      console.log(tokens.refresh_token);
      console.log("\n→ à coller dans /opt/abstract27/env/fal-tracking.env :");
      console.log(`  GOOGLE_REFRESH_TOKEN=${tokens.refresh_token}`);
      console.log("========================================\n");
    } else {
      console.error(
        "\n✗ Pas de refresh_token retourné.\n" +
          "  Révoque l'accès existant (myaccount.google.com/permissions) puis relance,\n" +
          "  ou vérifie que prompt=consent + access_type=offline sont bien passés.\n"
      );
    }
  } catch (e) {
    console.error("\n✗ Échec de l'échange du code :", e.message, "\n");
  }
  server.close();
});

server.listen(PORT, () => {
  console.log("\nOuvre cette URL pour autoriser (elle s'ouvre normalement toute seule) :\n");
  console.log(authUrl + "\n");
  // macOS
  exec(`open "${authUrl}"`, () => {});
});
