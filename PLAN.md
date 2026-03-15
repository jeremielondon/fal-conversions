# FAL Conversions — Plan

## Objectif
Remonter les **ventes réelles** (Stripe) comme conversions dans Google Ads pour optimiser le Smart Bidding.

## Approche : Enhanced Conversions via email

Le widget Bokun est un iframe → impossible de passer le gclid dans la réservation.
Plausible supprime le gclid → incompatible avec Google Ads.

**Solution :** Google Ads Enhanced Conversions matche les conversions par **email hashé** (SHA-256).
Quand un client paye via Bokun/Stripe, son email est envoyé (hashé) à Google Ads qui le corrèle avec le compte Google qui a cliqué l'annonce.

```
Google Ads (clic) → francaisalondres.com → page visite → widget Bokun → paiement Stripe
                                                                              ↓
                                                                    Webhook charge.succeeded
                                                                              ↓
                                                                    Email + montant extraits
                                                                              ↓
                                                                    SHA-256(email) → Google Ads API
                                                                              ↓
                                                                    Enhanced Conversion uploadée
                                                                              ↓
                                                                    Google Ads Smart Bidding optimise
```

## Prérequis
- Le client doit utiliser le **même email** sur Bokun/Stripe et sur son compte Google (ou un email connu de Google)
- Google Ads matche en moyenne ~70% des conversions via email hashé
- Suffisant pour que Smart Bidding optimise

## Ce qui est fait (code)

### Webhook + Google Ads API
- `dashboard/app/api/webhook/stripe/route.ts` — Endpoint webhook Stripe
  - Reçoit `charge.succeeded`
  - Extrait email + montant de la charge
  - Envoie l'Enhanced Conversion à Google Ads (email hashé SHA-256 + montant + devise + order ID)
- `dashboard/lib/google-ads-conversions.ts` — Client Google Ads REST API
  - Upload Enhanced Conversions via `uploadClickConversions`
  - Utilise OAuth2 (refresh token) + developer token
  - Hash l'email en SHA-256 (normalisé lowercase + trimmed)

### Tracking site (optionnel, pour analytics)
- `ghost-tracking.js` — Capture gclid/UTM en cookie, push `view_tour` si page avec widget Bokun
- `gtm-container.json` — GA4 event `view_tour` + Google Ads Conversion tag
- `setup.ts` — Injection script dans Ghost footer

### Dashboard
- `dashboard/` — Next.js avec GA4 + Google Ads + Stripe
- Vue Overview, Campagne Ads, Ventes

## Étapes restantes (manuelles)

### Étape 1 — Google Ads : créer la conversion Enhanced
1. Google Ads → Outils → Conversions → Nouvelle action de conversion
2. Type : **Import** → **Manual import using API or uploads**
3. Nom : `bokun_sale`
4. Catégorie : **Purchase**
5. Valeur : **Utiliser la valeur de chaque conversion** (montant Stripe)
6. Comptage : **Toutes les conversions**
7. Activer **Enhanced Conversions** dans les paramètres
8. Noter le **Conversion Action ID** (visible dans l'URL : `conversionActions/XXXXXX`)

### Étape 2 — Google Ads : developer token
1. Aller sur Google Ads API Center (Tools → API Center)
2. Demander un **developer token** (si pas encore fait)
3. En attendant l'approbation, le token test fonctionne sur le compte propre

### Étape 3 — Stripe : créer le webhook
1. Stripe Dashboard → Developers → Webhooks → Add endpoint
2. URL : `https://<dashboard-url>/api/webhook/stripe`
3. Events : sélectionner **`charge.succeeded`** uniquement
4. Noter le **Webhook Secret** (`whsec_...`)

### Étape 4 — Configurer les env vars
Dans `dashboard/.env` :
```
STRIPE_WEBHOOK_SECRET=whsec_...
GOOGLE_ADS_DEVELOPER_TOKEN=...
GOOGLE_ADS_CONVERSION_ACTION=customers/8016699315/conversionActions/XXXXXX
```

### Étape 5 — Déployer et tester
1. Déployer le dashboard sur Dokploy
2. Faire un paiement test (Stripe test mode)
3. Vérifier les logs : `[Google Ads] Conversion uploaded: ch_xxx 29 gbp`
4. Vérifier dans Google Ads → Conversions → `bokun_sale` que la conversion apparaît (24-48h)

### Étape 6 — Activer Smart Bidding
Après ~2 semaines / 30+ conversions :
1. Google Ads → Campagne → Stratégie d'enchères → **Maximiser les conversions** ou **ROAS cible**

## Env vars complètes (`dashboard/.env`)
```
DASHBOARD_PASSWORD=             # Mot de passe dashboard
STRIPE_SECRET_KEY=              # Stripe API key (live)
STRIPE_WEBHOOK_SECRET=          # Stripe webhook secret (whsec_...)
GOOGLE_CLIENT_ID=               # Google OAuth
GOOGLE_CLIENT_SECRET=           # Google OAuth
GOOGLE_REFRESH_TOKEN=           # Google OAuth
GA4_PROPERTY_ID=519319453       # GA4 property
GOOGLE_ADS_CUSTOMER_ID=801-669-9315
GOOGLE_ADS_DEVELOPER_TOKEN=     # Google Ads API (à obtenir)
GOOGLE_ADS_CONVERSION_ACTION=   # customers/8016699315/conversionActions/XXXXXX
```
