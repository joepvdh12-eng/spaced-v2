# Trainify v2 — AI Training Coach for Athletes

**Richting:** B2C — zelfstandig trainende atleten (Hyrox, hardlopen, functional fitness, etc.)
**Model:** €6,49 eerste maand (50% off), daarna €12,99/month of €99/year — geen gratis trial, paid entry

---

## Waarom deze richting (beslissing op basis van marktonderzoek)

- **B2B trainer tools zijn extreem verzadigd:** 300+ aanbieders, Trainerize (400K+ coaches), MyPTHub, TrueCoach — allemaal met groot budget en sterke netwerk effects
- **B2C zelfstandige atleten is een groeiende markt:** Hyrox alleen al 1.5 miljoen deelnemers in 2026, groeit naar 3M+ in 2028. Bestaande apps (TrainRox, RoxHype) zijn generiek en niet AI-adaptief
- **De gap:** Serieuze atleten willen coaching, maar een goede personal trainer kost €80–300/session. Trainify levert 80% van de coachingswaarde voor €12.99/maand
- **AI differentiatie:** Niet alleen een trainingsprogramma — het past zich aan op basis van feedback, heeft een AI coach chat en periodiseert automatisch richting je race date

---

## Structuur

```
v2/
├── index.html                    ← Landing page (marketing)
├── app/
│   ├── config.js                 ← Supabase + Stripe keys (vul in)
│   ├── auth.html                 ← Login / registratie
│   ├── onboarding.html           ← 5-stap setup: sport, doel, niveau, dagen, race date
│   ├── dashboard.html            ← Wekelijks overzicht + workout cards + stats
│   └── coach.html                ← AI coach chat (Claude Haiku)
├── netlify/
│   └── functions/
│       ├── generate-plan.js      ← AI genereert wekelijks trainingsplan (Claude Haiku)
│       ├── ai-coach.js           ← AI coach chat backend
│       └── create-checkout-session.js ← Stripe subscription checkout
├── netlify.toml
├── package.json
└── README.md
```

---

## Setup — 3 stappen

### 1. Supabase — database instellen

1. Ga naar je Supabase project: https://supabase.com/dashboard/project/fzlcrafifmlkbyclqabm
2. Open SQL Editor
3. Plak + voer uit: `trainify_v2_schema.sql` (in de outputs map)
4. Ga naar Settings → API → kopieer **anon public key**
5. Plak in `app/config.js`:
   ```js
   const SUPABASE_URL = 'https://fzlcrafifmlkbyclqabm.supabase.co';
   const SUPABASE_ANON_KEY = 'jouw-anon-key-hier';
   ```

### 2. Netlify — deploy

1. Ga naar https://app.netlify.com → "Add new site" → "Deploy manually"
2. Zip de volledige `v2/` map → drag & drop op Netlify
3. Of: verbind GitHub repo voor auto-deploy

**Environment variables instellen in Netlify:**
Ga naar Site Settings → Environment Variables en voeg toe:
```
ANTHROPIC_API_KEY=sk-ant-...              ← Van console.anthropic.com
SUPABASE_URL=https://fzlcrafifmlkbyclqabm.supabase.co
SUPABASE_SERVICE_KEY=...                  ← Supabase Settings → API → service_role key
STRIPE_SECRET_KEY=sk_live_...            ← Van Stripe dashboard
STRIPE_FIRST_MONTH_COUPON=...            ← Coupon ID uit Stripe (50% off, eenmalig)
STRIPE_WEBHOOK_SECRET=whsec_...          ← Uit Stripe Developers → Webhooks
URL=https://jouw-site.netlify.app        ← Je Netlify URL (of custom domein)
```

### 3. Stripe — betalingen

1. Ga naar https://dashboard.stripe.com
2. Maak 2 subscription producten aan:
   - **Trainify Pro Monthly** — €12.99/month → kopieer Price ID
   - **Trainify Pro Yearly** — €99/year → kopieer Price ID
3. Plak in `app/config.js`:
   ```js
   const STRIPE_MONTHLY_PRICE_ID = 'price_...';
   const STRIPE_YEARLY_PRICE_ID = 'price_...';
   ```

---

## Werkt ook zonder API keys

De app heeft fallbacks voor alles:
- **Zonder ANTHROPIC_API_KEY:** genereert een kwalitatief fallback Hyrox/running plan
- **Zonder Stripe:** checkout werkt niet, maar de rest van de app werkt volledig
- **AI Coach chat:** heeft ingebouwde antwoorden op de meest gestelde vragen als backup

→ Je kunt de app vandaag nog live zetten en testen zonder betalingen.

---

## Volgende stappen (prioriteit)

1. ✅ Database schema uitvoeren in Supabase
2. ✅ ANTHROPIC_API_KEY instellen in Netlify
3. ✅ Deploy + eigen domein koppelen
4. ✅ Progress page (`progress.html`) — grafieken en PR tracking (gebouwd)
5. ✅ Stripe webhook (`stripe-webhook.js`) — subscription status in Supabase
6. ✅ Naam: Astrelo (definitief vastgesteld)
7. 🔜 App Store / Google Play (React Native of Capacitor wrapper)
8. 🔜 Marketing: TikTok + Instagram voor Hyrox community

---

## Pricing rationale

- **€6,49 eerste maand** — 50% korting, triggert sunk-cost: wie betaalt blijft hangen
- **€12,99/month** daarna — minder dan één proteine bar per dag. 1/10e van een PT.
- **€99/year** — save 36%, beter voor cashflow
- **Geen gratis trial** — bewust: paid entry = hogere commitment = hogere retentie
- **Doelstelling:** break-even bij 6 users. 100 users = €1.299/maand. 500 users = €6.495/maand.

---

## Techstack

| Component | Technologie |
|-----------|-------------|
| Frontend | Vanilla HTML/CSS/JS (geen framework) |
| Backend | Netlify Functions (Node.js) |
| Database | Supabase (PostgreSQL + Auth + RLS) |
| AI | Anthropic Claude Haiku (snel + goedkoop) |
| Payments | Stripe Subscriptions |
| Hosting | Netlify |
| Cost/month | ~€25–50 bij <500 users |
