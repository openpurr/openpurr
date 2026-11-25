// The "Add in-app purchases" page in this language (see en.ts for the notes).
import type { StartDict } from "./en";

export const startNl: StartDict = {
  meta: {
    title: "Gratis in-app-aankopen en abonnementen in je app - openpurr",
    description:
      "Nieuwe app? Voeg in-app-aankopen en abonnementen toe met de officiële Purchases SDK en een open-source backend die je zelf draait. Nooit een omzetaandeel.",
    ogImageAlt: "Begin je aan een nieuwe app? Begin zonder omzetaandeel. Houd je 1% en investeer het in je bedrijf.",
  },
  hero: {
    crumb: "In-app-aankopen toevoegen",
    eyebrow: "Voor nieuwe apps",
    headline: "Begin je aan een nieuwe app?",
    headlineAccent: "Begin zonder omzetaandeel.",
    /** {threshold} is "$2,500". */
    lede: "De meeste aankoopbackends nemen 1% van je omzet zodra je boven {threshold} per maand komt, en de rekening groeit met elke stap die je zet. Dat vermijd je het makkelijkst vóór je eerste verkoop. openpurr is een gratis, open-source backend voor in-app-aankopen en abonnementen die je zelf draait, met dezelfde officiële SDK die de grote platforms gebruiken.",
    ctaStart: "Aan de slag op GitHub",
    ctaAi: "Kopieer een prompt voor je AI-assistent",
  },
  growth: {
    title: "Je 1%, vanaf dag één",
    text: "Kies waar je je app over drie jaar verwacht. Zo loopt een omzetaandeel van 1% onderweg op, uitgaande van gestage groei vanaf nul.",
    target: "Maandelijkse omzet over drie jaar",
    /** Labels for the totals. */
    fee: "1% omzetaandeel, over 3 jaar",
    servers: "Zelf draaien, over 3 jaar",
    after: "En daarna, elk jaar",
    /** The chart's accessible description. */
    chartLabel: "Het omzetaandeel dat maand na maand oploopt over drie jaar",
    /** HTML. {fee} and {servers} are amounts that move with the slider. */
    summary: "Dat is <b>{fee}</b> die je vóór jaar vier zou afstaan, tegenover <b>{servers}</b> voor je eigen servers. Houd het zelf en steek het in je bedrijf.",
  },
  invest: {
    title: "Investeer het in je bedrijf, en in jezelf",
    text: "Wat een jaar van je 1% oplevert als je het zelf houdt:",
  },
  how: {
    title: "Zo werkt het",
    lede: "Vier stappen, en de code die je schrijft is dezelfde als in elke RevenueCat-tutorial.",
    steps: [
      {
        title: "Deploy openpurr",
        /** HTML. */
        text: "Draai de setup op je Cloudflare-account. Voor kleine apps past Lite in het <b>gratis abonnement</b>, en je kunt de setup gerust opnieuw draaien als die halverwege stopt.",
      },
      {
        title: "Voeg je app en producten toe",
        text: "Het dashboard begint met het toevoegen van je eerste app: de bundle-ID en pakketnaam, daarna producten, entitlements en offerings.",
      },
      {
        title: "Voeg de Purchases SDK toe",
        /** HTML. */
        text: "Installeer de officiële RevenueCat Purchases SDK, open source onder de MIT-licentie, en stel <b>één proxy-URL</b> in voordat je hem configureert.",
      },
      {
        title: "Uitbrengen",
        text: "Aankopen worden bij Apple en Google gevalideerd, verlengingen en terugbetalingen komen binnen via store-meldingen, en je backend krijgt webhooks. Gebruik je Claude Code? De openpurr-plug-in loodst je door de setup van App Store Connect en Play Console.",
      },
    ],
    /** Above the setup commands. */
    setupLabel: "Setup, op je eigen computer",
  },
  ai: {
    title: "Zet het op met je AI-codeerassistent",
    text: "Open het project van je app in Claude Code, Codex, Cursor, Grok of een andere coding-agent en plak deze prompt. Hij deployt openpurr, koppelt de stores en voegt de SDK toe, en vraagt het je eerst bij alles waarvoor je moet inloggen.",
    copy: "Prompt kopiëren",
    copied: "Gekopieerd",
    claudeTip: "Gebruik je Claude Code? Voeg eerst de openpurr-plugin toe, die je stap voor stap helpt:",
  },
  includes: {
    title: "Wat je krijgt",
    yes: [
      "Aankopen en abonnementen in de App Store en Google Play",
      "Entitlements en offerings",
      "Webhooks naar je backend, ondertekend en opnieuw verstuurd bij fouten",
      "16 grafieken: omzet, MRR, churn, proefperiodes en meer",
      "Prijsexperimenten",
      "Je gegevens in je eigen database",
    ],
    notYetTitle: "Nog niet",
    notYet: "Paywallbuilders, integraties met externe analytics, advertentie-events, webbetalingen en Amazon. Heb je die vanaf dag één nodig, dan bieden commerciële platforms ze vandaag.",
  },
  lockin: {
    title: "Hoe dan ook geen lock-in",
    text: "Omdat openpurr de standaard Purchases SDK gebruikt, werkt je aankoopcode met beide backends. Groei je uit openpurr, of wil je wat de commerciële platforms extra bieden, dan is overstappen een configuratiewijziging en een klantenimport, geen herschrijving.",
  },
  pricingLink: {
    text: "Benieuwd waar de 1% naartoe gaat als je hem wel betaalt?",
    link: "Bekijk de prijzen van RevenueCat, uitgesplitst →",
  },
  faq: {
    title: "Wat mensen vragen",
    /** Each answer is also the page's FAQ structured data. */
    items: {
      backend: {
        q: "Heb ik een backend nodig voor in-app-aankopen?",
        a: "Strikt genomen niet: StoreKit en Google Play Billing draaien op het apparaat. Maar een backend houdt abonnementen eerlijk. Hij valideert aankopen bij Apple en Google, volgt verlengingen, opzeggingen en terugbetalingen via store-meldingen, en vertelt je app en je server wie toegang heeft. openpurr is die backend, en je draait hem zelf.",
      },
      cheapest: {
        q: "Wat is de goedkoopste manier om abonnementen toe te voegen aan een iOS- of Android-app?",
        /** {servers} a yearly amount, {m25k} "$25,000". */
        a: "Draai de backend zelf. Voor kleine apps past openpurr Lite in het gratis abonnement van Cloudflare, en het werkt met de gratis, open-source Purchases SDK. Je betaalt dus alleen de servers: in ons model ongeveer {servers} per jaar voor een app die {m25k} per maand verdient, zonder omzetaandeel.",
      },
      free: {
        q: "Is openpurr echt gratis?",
        a: "Ja. Het is open source onder de Apache 2.0-licentie, zonder omzetaandeel en zonder kosten per transactie. Je betaalt je eigen servers, en kleine apps passen in het gratis abonnement van Cloudflare.",
      },
      switch: {
        q: "Kan ik later overstappen naar RevenueCat?",
        a: "Ja. openpurr gebruikt de officiële RevenueCat Purchases SDK, dus de aankoopcode van je app werkt met beide backends en je producten blijven in de stores hetzelfde. Overstappen is een configuratiewijziging plus het verhuizen van je klantgegevens.",
      },
      missing: {
        q: "Wat doet openpurr nog niet?",
        a: "Paywallbuilders, integraties met externe analytics, advertentie-events, webbetalingen en Amazon. Prijsexperimenten zijn ingebouwd. Heb je de rest vanaf dag één nodig, dan biedt een commercieel platform dat vandaag.",
      },
    },
  },
};
