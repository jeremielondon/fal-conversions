# FAL Conversions — Plan Complet

## Objectif
Traquer le parcours complet : Google Ads → francaisalondres.com → vente Bokun.io
Permettre à Google Ads d'optimiser via Smart Bidding grâce aux données de conversion.

## Contexte
- francaisalondres.com utilise Bokun.io pour les réservations/paiements
- Google Ads : £250/mois, aucun tracking de conversion actuellement
- Plausible Analytics déjà en place (sera remplacé par PostHog)
- Ghost CMS sur Hetzner AX42 via Cloudron

## Problème
- Google Ads ne peut pas optimiser (Smart Bidding) sans données de conversion
- Aucune visibilité sur quels mots-clés/annonces génèrent des ventes Bokun
- Budget potentiellement gaspillé sur des mots-clés non-convertissants

---

## Architecture Prévue

### Étape 1 : Capture des paramètres (côté client)
- **Google Tag Manager** sur francaisalondres.com
- Capture UTM params + gclid à l'arrivée du visiteur
- Stockage dans cookie first-party (durée 90 jours)
- Event tracking des clics vers Bokun

### Étape 2 : Passage d'attribution à Bokun
- Quand le visiteur clique vers Bokun, ajouter les UTM/gclid en paramètres URL
- Ou via custom fields Bokun si l'API le permet
- Objectif : retrouver la source d'acquisition dans chaque vente

### Étape 3 : Récupération des ventes (Bokun API)
- API Bokun : https://docs.bokun.io/
- Polling régulier (cron) ou webhook pour récupérer les nouvelles ventes
- Extraire les métadonnées d'attribution (gclid, UTM)

### Étape 4 : Remontée des conversions (Google Ads API)
- Google Ads Conversion API (server-side, offline conversions)
- Envoyer : gclid + montant de la vente + timestamp
- Permet à Google d'optimiser les enchères automatiquement

### Étape 5 : Analytics & Optimisation (PostHog)
- Funnels : Google Ads → landing page → page Bokun → achat
- Session replay : voir où les visiteurs bloquent
- A/B testing : tester différentes versions de pages/CTAs
- Dashboard : ROI par mot-clé, coût d'acquisition, taux de conversion

---

## Stack Technique

| Composant | Outil | Hébergement |
|-----------|-------|-------------|
| Event capture (client) | Google Tag Manager | Gratuit (Google) |
| Analytics & funnels | **PostHog** | Cloud gratuit (1M events/mois) ou self-hosted sur Dokploy |
| Middleware conversion | Hono / Node.js | Dokploy (Hetzner) |
| Booking/paiements | Bokun.io API | Existant |
| Conversion upload | Google Ads Conversion API | Server-side |
| Orchestration | Cron job | Dokploy |

---

## PostHog — Choix validé

### Pourquoi PostHog plutôt que Jitsu
- Product analytics complet (funnels, retention, parcours)
- Session replay (voir le comportement visiteur)
- A/B testing intégré
- Heatmaps
- API SQL interrogeable par Claude pour analyse et recommandations
- Communauté active (20k+ GitHub stars)

### Alternatives évaluées
| Outil | Verdict |
|-------|---------|
| **Jitsu** | Bon CDP léger, mais pas d'analytics produit ni session replay |
| **RudderStack** | Trop lourd (Kubernetes), overkill |
| **Matomo** | Pas un vrai CDP, juste analytics web |
| **Umami** | Trop basique, pas de routing d'events |
| **Mixpanel** | Pas self-hosted, payant rapidement |
| **Segment** | Propriétaire, cher |

### Déploiement PostHog
- **Option 1 (recommandée pour démarrer)** : PostHog Cloud — gratuit jusqu'à 1M events/mois
- **Option 2 (plus tard)** : Self-hosted sur Dokploy (serveur upgraded : 8 vCPU / 16 GB RAM / 160 GB)

---

## APIs Clés
- **Bokun API** : https://docs.bokun.io/
- **Google Ads Conversion API** : offline conversion upload via gclid
- **PostHog API** : queries SQL, events, funnels
- **Google Tag Manager** : event capture côté client

---

## Phases de mise en œuvre

### Phase 1 — Tracking de base
- [ ] Installer GTM sur francaisalondres.com (Ghost)
- [ ] Configurer capture gclid + UTM → cookie
- [ ] Installer PostHog (Cloud) sur le site
- [ ] Configurer les events de base (page view, clic Bokun)

### Phase 2 — Pipeline de conversion
- [ ] Créer middleware Hono sur Dokploy
- [ ] Intégrer Bokun API (récupération des ventes)
- [ ] Mapper ventes → gclid via les paramètres passés
- [ ] Configurer Google Ads Conversion API (upload offline)
- [ ] Tester le pipeline complet

### Phase 3 — Optimisation
- [ ] Configurer funnels PostHog (Ads → landing → Bokun → achat)
- [ ] Activer session replay
- [ ] Premiers A/B tests sur les pages de conversion
- [ ] Dashboard ROI par mot-clé / annonce
- [ ] Analyse Claude des données PostHog pour recommandations

---

## Status
**PLANNING** — En attente de lancement
