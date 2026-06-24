# FAL Tracking Worker

Server-side **Stripe → Google Ads Enhanced Conversions** for the guided-tours funnel.

A booking is paid via TicketingHub → Stripe Checkout (the **dedicated visites-guidées
Stripe account**). Stripe fires `checkout.session.completed` to this service, which
hashes the buyer email (SHA-256) and uploads it as an offline **enhanced conversion for
leads** (no gclid needed — works through the iframe widget) to the `tour_purchase` action
via the Google **Data Manager API**. Smart Bidding then optimises on real revenue.

```
Stripe Checkout (tours acct) ──webhook──▶ POST /webhook/stripe
   verify signature → extract email+amount+orderId → SHA-256 hex
   → POST datamanager.googleapis.com/v1/events:ingest
```

## Layout
- `src/server.js` — HTTP server: `GET /health`, `POST /webhook/stripe`
- `src/stripe-handler.js` — signature verification + event → conversion mapping
- `src/data-manager.js` — Data Manager API `events:ingest` upload (REST)
- `scripts/get-refresh-token.mjs` — mint the OAuth refresh token (scope `datamanager`)
- `.env.example` — all env vars (copy to the cx43 env file, never commit real values)

## Design notes
- **Cookieless / consent-robust**: the conversion is uploaded server-side from the real
  payment, so it does not depend on the cookie banner or the web tags.
- **Idempotent**: `orderId = payment_intent` → Google dedups; safe on Stripe retries and
  even if both `checkout.session.completed` and `charge.succeeded` are enabled.
- **Retry classification**: transient errors (5xx/429/network/oauth) → HTTP 500 so Stripe
  retries with backoff; permanent errors (bad data/config) → HTTP 200 + logged, so Stripe
  doesn't disable the endpoint.
- **No build step**: plain ESM JS, deps = `stripe` + `google-auth-library`.

## Local run
```bash
cp .env.example .env && $EDITOR .env      # fill secrets
npm install
npm start
curl -s localhost:3020/health             # {"status":"ok"}
```

## Test without a real sale (recommended first pass)
1. Set `GOOGLE_ADS_VALIDATE_ONLY=true` to validate the upload without recording it.
2. Replay an event with the Stripe CLI (against the tours account):
   ```bash
   stripe listen --forward-to localhost:3020/webhook/stripe
   stripe trigger checkout.session.completed
   ```
   Expect a log line: `[google-ads] uploaded order=... <amount> gbp (checkout.session.completed)`.
3. Flip `GOOGLE_ADS_VALIDATE_ONLY=false` once the validate-only call returns ok.

---

## Deploy on cx43 (single compose + Caddy + Bunny)

> Prereqs (from Phase 2C): **Data Manager API enabled** in the Google Cloud project +
> OAuth refresh token (scope **`datamanager`**, via `scripts/get-refresh-token.mjs`), and
> the **tours Stripe webhook secret**. No developer token needed. The `tour_purchase`
> conversion action (Phase 2B) is already created → id in `GOOGLE_ADS_CONVERSION_ACTION`.

### 1. Source on the server
This folder ships inside the existing `fal-conversions` repo. Clone it next to the compose:
```bash
# on cx43 (root@46.224.136.75)
cd /opt/abstract27
git clone <fal-conversions repo> fal-conversions   # if not already present
# build context will be /opt/abstract27/fal-conversions/worker
```
Add `fal-conversions/` to `cx43-infra/.gitignore` (app source is never committed into the infra repo).

### 2. DNS FIRST, then the Caddy label (ACME ordering!)
Create a Bunny A record **before** adding the caddy label (otherwise ACME rate-limits and
falls back to the staging CA → broken cert):
```
hook-stripe.francaisalondres.com  A  46.224.136.75      (zone 120460)
dig @1.1.1.1 hook-stripe.francaisalondres.com +short    # must return 46.224.136.75
```

### 3. Secrets
Create `/opt/abstract27/env/fal-tracking.env` (gitignored, chmod 600) from `.env.example`.

### 4. Compose service (add to /opt/abstract27/docker-compose.yml)
```yaml
  # ─── FAL Tracking — Stripe → Google Ads conversions ────────
  fal-tracking:
    build: /opt/abstract27/fal-conversions/worker
    container_name: fal-tracking
    mem_limit: 256m
    restart: unless-stopped
    env_file:
      - /opt/abstract27/env/fal-tracking.env
    healthcheck:
      test: ["CMD-SHELL", "wget -q -O /dev/null http://127.0.0.1:3020/health || exit 1"]
      interval: 30s
      timeout: 5s
      retries: 3
      start_period: 20s
    labels:
      caddy: hook-stripe.francaisalondres.com
      caddy.reverse_proxy: "{{upstreams 3020}}"
      autoheal: "true"
    networks:
      - abstract27
```
Optional — lock the endpoint to Stripe's published webhook IP ranges:
```yaml
      caddy.@external: not remote_ip <stripe-webhook-ip-ranges>
      caddy.respond: "@external 403"
```
(Signature verification already protects it; the allowlist is defense-in-depth.)

### 5. deploy.sh (add to cx43-infra/deploy.sh)
```bash
deploy_fal_tracking() {
  log "=== Deploying fal-tracking ==="
  cd "$COMPOSE_DIR/fal-conversions"
  git fetch origin && git reset --hard origin/main
  local commit=$(git rev-parse --short HEAD)
  cd "$COMPOSE_DIR"
  docker compose build fal-tracking
  docker compose up -d fal-tracking
  log "fal-tracking deployed ✓ ($commit)"
}
# add to the case dispatcher:  fal-tracking) deploy_fal_tracking ;;
```
Then: `docker compose config -q && bash /opt/abstract27/deploy.sh fal-tracking`
(a "container name already in use" line during recreate is usually harmless noise — verify
`docker ps` shows `fal-tracking` Up (healthy) and `curl https://hook-stripe.francaisalondres.com/health`).

### 6. Stripe webhook (tours account)
Developers → Webhooks → Add endpoint:
- URL: `https://hook-stripe.francaisalondres.com/webhook/stripe`
- Event: **`checkout.session.completed`** only
- Copy the signing secret into `STRIPE_WEBHOOK_SECRET`, then `deploy.sh fal-tracking` again.

### 7. Verify end-to-end
- `curl https://hook-stripe.francaisalondres.com/health` → 200
- Real test booking (URL carrying a `gclid`) → log `[google-ads] uploaded ...`
- Google Ads → Goals → Conversions → `tour_purchase` shows the upload within 24–48h
  (diagnostics show the email match rate).
