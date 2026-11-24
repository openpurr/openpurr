// Dutch copy. Follows en.ts; see the notes there. Uses "je/jij", as is usual for developer tools; keeps "self-hosted", webhooks, entitlements, backend, dashboard and churn in English.
import type { Dict } from "./en";

export const nl: Dict = {
  meta: {
    title: "openpurr: self-hosted open-source alternatief voor RevenueCat",
    description:
      "openpurr is een self-hosted, open-source alternatief voor RevenueCat. Behoud je Purchases SDK, richt hem op je eigen server en betaal geen omzetaandeel.",
    ogImageAlt: "openpurr: een self-hosted, open-source alternatief voor RevenueCat, naast het dashboard met abonnementsgrafieken",
  },
  header: {
    home: "openpurr startpagina",
    nav: { features: "Functies", editions: "Edities", roadmap: "Roadmap", faq: "FAQ", migrate: "Overstappen" },
    language: "Taal",
  },
  footer: {
    tagline: "Open-source infrastructuur voor in-app-aankopen die je zelf draait.",
    roadmap: "Roadmap",
    contributing: "Bijdragen",
    sponsor: "Sponsoren",
    contact: "Contact",
    privacy: "Privacy (Engels)",
    disclaimer:
      "openpurr is een onafhankelijk project. Het is niet verbonden aan en wordt niet onderschreven door RevenueCat, Inc. App Store is een handelsmerk van Apple Inc. Google Play is een handelsmerk van Google LLC.",
    copyright: "Copyright {year} openpurr-bijdragers.",
    cookieSettings: "Cookie-instellingen",
  },
  consent: {
    label: "Cookietoestemming",
    text: "We willen graag cookies van Google Analytics gebruiken om bezoeken te tellen en te zien welke pagina's helpen. Er wordt niets geplaatst tenzij je akkoord gaat, en je kunt je keuze altijd wijzigen onder Cookie-instellingen.",
    privacy: "Privacy (Engels)",
    decline: "Weigeren",
    accept: "Accepteren",
  },
  snippet: {
    tabs: "SDK-platform",
    note: "Eén regel. Dezelfde SDK, dezelfde aankoopcode.",
  },
  home: {
    hero: {
      title: 'Een <span class="nowrap">self-hosted,</span> open-source <span class="accent">alternatief voor RevenueCat</span>',
      lede: "Beheer je eigen aankoopinfrastructuur, sta geen deel van je omzet af en wees van geen enkele commerciële dienst afhankelijk. De Purchases SDK die je al gebruikt, blijft: je wijzigt één URL, niet je aankoopcode.",
      star: "Geef een ster op GitHub",
      how: "Zo werkt het",
      runsOn: "Draait op",
      shotAlt:
        "Het dashboard van openpurr Lite, met 12 maanden MRR-verloop, actieve abonnementen, churn, nieuwe klanten, nieuwe proefperiodes en actieve proefperiodes",
    },
    why: {
      eyebrow: "Voor wie",
      title: "Voor app-ontwikkelaars die het liever zelf draaien",
      lede: "openpurr werkt met de officiële, ongewijzigde SDK's. Overstappen begint met het wijzigen van één URL, niet met het herschrijven van je aankoopcode.",
      reasons: [
        {
          title: "Jouw data, jouw servers",
          body: "Aankoopgegevens, entitlements en store-inloggegevens staan in een database die je zelf draait, bevraagt, back-upt en exporteert. Er zit geen externe dienst tussen je app en je klanten.",
        },
        {
          title: "Geen omzetaandeel",
          body: "Geen percentage van je omzet en geen kosten per transactie. De Lite-editie is ontworpen voor het gratis abonnement van Cloudflare, zodat een kleine app hem kosteloos kan draaien.",
        },
        {
          title: "Van geen leverancier afhankelijk",
          body: "Het is open source onder Apache 2.0. Lees de code, pas hem aan en verhuis hem tussen Cloudflare en je eigen cloud.",
        },
      ],
    },
    how: {
      eyebrow: "Zo werkt het",
      title: "Jouw server staat waar vroeger de leverancier stond",
      lede: "Je app houdt de open-source Purchases SDK waarmee hij al wordt uitgeleverd. De SDK praat met openpurr. openpurr praat met de stores, houdt de abonnementsstatus bij en laat je backend weten wat er is veranderd.",
      flowLabel: "Verloop van een verzoek",
      app: "Je app",
      sdkLicense: "Officieel, ongewijzigd, MIT-licentie",
      sdkPlatforms: "iOS, Android, Flutter of React Native",
      coreWhere: "Op Cloudflare Workers of in je eigen cloud",
      appStoreApi: "Server API en meldingen",
      playApi: "Developer API en RTDN",
      backend: "Je backend",
      backendHooks: "Ondertekende webhooks",
      steps: [
        {
          title: "Uitrollen",
          body: "Draai openpurr Lite in je eigen Cloudflare-account. Een begeleide setup, <code>pnpm run setup</code>, maakt de database aan, rolt beide Workers uit en maakt je eigenaarsaccount aan.",
        },
        {
          title: "De SDK omzetten",
          body: "Stel de proxy-URL in vóór <code>configure</code>. Gebruik een eigen domein, zodat je later kunt verhuizen.",
        },
        {
          title: "De stores koppelen",
          body: "Voeg je store-inloggegevens en meldings-URL's toe. De setupcontrole, <code>openpurr doctor</code>, controleert ze en vertelt je hoe je oplost wat ontbreekt.",
        },
      ],
    },
    features: {
      eyebrow: "Wat het doet",
      title: "De abonnementsbackend, zonder de extra's die je niet gebruikt",
      items: [
        {
          title: "Aankopen en store-meldingen",
          body: "Valideert StoreKit 2-transacties en Google Play-aankopen, geeft de CustomerInfo en entitlements terug die de SDK verwacht, en houdt verlengingen, terugbetalingen en respijtperiodes actueel via meldingen van de App Store en Google Play.",
        },
        {
          title: "Webhooks",
          body: "Stuurt events in het formaat van RevenueCat naar je backend, ondertekend met HMAC-SHA256 en ongeveer 72 uur lang opnieuw verstuurd.",
        },
        {
          title: "Grafieken",
          body: "16 grafieken: omzet, MRR en ARR, MRR- en abonnementsverloop, actieve en betaalde abonnementen, abonnementsstatus, churn, proefperiodes en hun conversie, nieuwe klanten, terugbetalingen en terugbetalingspercentage, en eenmalige aankopen. Filter op app, store, product en omgeving, met omzet omgerekend naar USD.",
        },
        {
          title: "Prijsexperimenten",
          body: "Toon klanten die nieuw zijn in je app verschillende offerings en vergelijk daarna conversie en omzet per klant, met de kans dat elke variant beter scoort dan de controlegroep. Zonder app-update.",
        },
        {
          title: "Toegang en audit",
          body: "SDK-sleutels en geheime sleutels, aanmelden voor beheerders met optionele authenticatorcodes, rollen, toegangstokens en een auditlog.",
        },
        {
          title: "MCP-server en Claude-skills",
          body: "Vraag een AI-assistent waarom een klant wel of geen entitlement heeft, zoek aankopen op of laat je door de inrichting van App Store Connect en de Play Console leiden.",
        },
      ],
    },
    editions: {
      eyebrow: "Twee edities",
      title: "Begin klein en stap over zonder app-update",
      lede: "Beide edities doorstaan dezelfde conformiteitstests. Als je app naar een eigen domein wijst, heb je voor de overstap van Lite naar Standard geen nieuwe app-release nodig.",
      lite: {
        badge: "Voor indie-apps",
        price: "$ 0",
        priceNote: "op het gratis abonnement van Cloudflare",
        items: [
          "TypeScript op Cloudflare Workers en D1",
          "Lichtgewicht en goedkoop in gebruik",
          "Waarschuwingen voordat je de limieten van het gratis abonnement bereikt",
        ],
      },
      standard: {
        badge: "Voor grotere portfolio's",
        price: "Je cloudrekening",
        priceNote: "verder niets",
        items: ["Go en Postgres in containers", "GCP, AWS of DigitalOcean", "Voor elk een deploymenttemplate"],
      },
    },
    savings: {
      eyebrow: "Kosten",
      title: "Wat je overhoudt ten opzichte van RevenueCat",
      lede: "Het Pro-abonnement van RevenueCat is gratis onder $ 2.500 bijgehouden omzet per maand en rekent daarna 1% van alles. Lite draait op het gratis abonnement van Cloudflare, en op Workers Paid, vanaf $ 5 per maand, zodra je app daar overheen groeit.",
      revenue: "Maandelijkse omzet",
      rc: "RevenueCat",
      op: "openpurr Lite",
      saved: "Bespaard per jaar",
      perMonth: "{amount} per maand",
      free: "Gratis Cloudflare-abonnement",
      paid: "Cloudflare Workers Paid",
      chartLabel: "Maandelijkse kosten per maandelijkse omzet: die van RevenueCat stijgen met de omzet, die van openpurr Lite blijven bijna nul",
      gapLegend: "Wat je overhoudt",
      tableSummary: "Vergelijk bij andere omzetniveaus",
      colRevenue: "Maandelijkse omzet",
      colRc: "RevenueCat, per maand",
      colOp: "openpurr Lite, per maand",
      colSaved: "Bespaard per jaar",
      methodSummary: "Hoe we dit schatten",
      pricingLink: "Waar gaat de 1% van RevenueCat naartoe? →",
      method: [
        "RevenueCat: de lijstprijs van het Pro-abonnement, 1% van de maandelijks bijgehouden omzet vanaf $ 2.500. Bijgehouden omzet telt jaarabonnementen en eenmalige aankopen in de maand waarin ze betaald worden, dus die kan hoger zijn dan de MRR. Grote klanten kunnen over Enterprise-prijzen onderhandelen.",
        "openpurr Lite: de prijzen van Cloudflare voor Workers en D1. We gaan uit van ongeveer $ 1,50 maandomzet en ongeveer 10 SDK-verzoeken per dag per dagelijks actieve gebruiker. Daarmee dekken de 100.000 verzoeken per dag van het gratis abonnement tot ongeveer {paidFrom} maandomzet, met ruimte over. Daarboven rekenen we met Workers Paid: $ 5 per maand, plus $ 0,30 per miljoen verzoeken boven de 10 miljoen.",
        "Niet meegerekend: je eigen tijd om het te draaien. De kosten van de stores zijn in beide gevallen gelijk.",
        "Prijzen gecontroleerd op {date}. openpurr is niet verbonden aan RevenueCat.",
      ],
    },
    fit: {
      eyebrow: "Eerlijk gezegd",
      title: "Misschien is het nog niets voor jou",
      lede: "Heb je paywall-builders, analytics-integraties van derden of een supportcontract nodig, dan bieden commerciële platforms dat vandaag al.",
      outTitle: "Voorlopig buiten scope",
      tags: ["Paywalls", "Advertentie-events", "Customer Center", "Virtuele valuta", "Webbetalingen", "Amazon", "Analytics-integraties"],
    },
    roadmap: {
      eyebrow: "Roadmap",
      title: "Waar het naartoe gaat",
      lede: "De volgorde ligt vast, maar er zijn geen datums. Als iets belangrijk voor je is, zeg het dan in een issue.",
      status: { done: "Klaar", wip: "Mee bezig", planned: "Gepland", later: "Jij beslist" },
      phases: [
        {
          phase: "Lite",
          items: [
            "Nieuwste release: {version}",
            "Ontworpen voor het gratis abonnement van Cloudflare",
            "App Store en Google Play",
            "Webhooks, dashboard en beheer",
            "Meerdere apps in één deployment",
            "Prijsexperimenten",
            "MCP-server, CLI en Claude-skills",
            "Hierna: testen op apparaten, dan 1.0",
          ],
        },
        {
          phase: "Standard",
          items: ["Go en Postgres in containers", "GCP, AWS en DigitalOcean", "Dezelfde conformiteitstests als Lite", "Overstap vanaf Lite zonder app-update"],
        },
        {
          phase: "Gevormd door de community",
          items: ["Geverifieerde identiteit van eindgebruikers", "Standard-extra's voor grotere teams", "Mobiele app voor grafieken, met een melding als aankopen uitblijven", "Dezelfde meldingen in Slack, Discord en Telegram", "Alles waar je in issues om vraagt"],
        },
      ],
      more: "Lees de volledige roadmap (Engels) →",
    },
    cta: {
      title: "Denk mee",
      body: "Waar we nu het meest aan hebben is feedback: verkeerde aannames over de SDK's of de stores, en randgevallen uit de praktijk bij verlengingen, terugbetalingen en respijtperiodes.",
      star: "Geef een ster op GitHub",
      issue: "Open een issue",
      coffee: "Trakteer ons op koffie",
    },
  },
  faq: {
    eyebrow: "FAQ",
    title: "openpurr als alternatief voor RevenueCat",
    lede: "Wat er verandert als je je eigen abonnementsbackend draait, en wat niet.",
    items: [
      {
        q: "Wat is openpurr?",
        a: "openpurr is een open-source, self-hosted alternatief voor RevenueCat. Het is een backend voor in-app-aankopen en abonnementen die werkt met de officiële RevenueCat Purchases SDK. Het valideert aankopen uit de App Store en Google Play, houdt entitlements bij, ontvangt store-meldingen, stuurt webhooks naar je backend en toont je belangrijkste abonnementscijfers in grafieken, allemaal op infrastructuur die je zelf beheert.",
      },
      {
        q: "Wat is het verschil tussen openpurr en RevenueCat?",
        a: "RevenueCat is een gehoste commerciële dienst die boven een gratis niveau een deel van je omzet rekent. openpurr is software die je zelf draait: je aankoopgegevens, entitlements en store-inloggegevens staan in je eigen database, en er is geen omzetaandeel en er zijn geen kosten per transactie. RevenueCat biedt vandaag meer functies, zoals paywalls en analytics-integraties. openpurr richt zich op de kern van de abonnementsbackend.",
      },
      {
        q: "Moet ik mijn aankoopcode herschrijven om over te stappen van RevenueCat?",
        a: "Nee. openpurr werkt met de officiële, ongewijzigde Purchases SDK. Je stelt de proxy-URL van de SDK in op je openpurr-server voordat je configure aanroept, en de rest van je aankoopcode blijft hetzelfde. Gebruik een eigen domein, zodat je later zonder app-update van server kunt wisselen.",
      },
      {
        q: "Hoe verhuis ik mijn bestaande klanten van RevenueCat?",
        a: "Door ze te importeren. Vraag RevenueCat om een migratie-export, waarna openpurr import de aankopen van elke klant bij Apple en Google ophaalt en ze aan dezelfde app-user-ID's koppelt. De nieuwe versie van je app stuurt de aankopen van elke klant ook één keer door, en beide backends blijven bijgewerkt terwijl mensen updaten. Zo verliest niemand zijn toegang.",
        link: "Zo stap je over",
      },
      {
        q: "Kan ik overstappen van Adapty?",
        a: "Ja, met een app-update. De SDK van Adapty kan niet naar een andere server wijzen, dus de update vervangt hem door de Purchases SDK, waarmee openpurr werkt. Je producten blijven in de stores hetzelfde. openpurr importeert je App Store-klanten uit de event-export van Adapty, de nieuwe versie van je app haalt alle anderen over zodra die voor het eerst draait, en beide backends blijven bijgewerkt terwijl mensen updaten.",
        link: "Lees de Adapty-gids",
        linkTo: "adapty",
      },
      {
        q: "Welke platforms en stores ondersteunt openpurr?",
        a: "openpurr ondersteunt de Purchases SDK voor iOS, Android, Flutter en React Native, met aankopen uit de App Store en Google Play. Amazon en webbetalingen vallen voorlopig buiten scope.",
      },
      {
        q: "Wat kost openpurr?",
        a: "openpurr is gratis en open source onder de Apache 2.0-licentie. Je betaalt alleen voor de infrastructuur waarop het draait. De Lite-editie is ontworpen voor het gratis abonnement van Cloudflare, zodat een kleine app hem kosteloos kan draaien. De Standard-editie draait in containers in je eigen cloud, dus de kosten zijn je cloudrekening.",
      },
      {
        q: "Waar worden mijn gegevens opgeslagen?",
        a: "In je eigen database. De Lite-editie gebruikt Cloudflare D1 in je Cloudflare-account. De Standard-editie gebruikt Postgres op GCP, AWS of DigitalOcean. Je kunt de gegevens bevragen, back-uppen en exporteren, en er zit geen externe dienst tussen je app en je klanten.",
      },
      {
        q: "Stuurt openpurr webhooks zoals RevenueCat?",
        a: "Ja. openpurr stuurt events in het formaat van RevenueCat naar je backend, ondertekend met HMAC-SHA256 en ongeveer 72 uur lang opnieuw verstuurd. Bestaande webhook-handlers hebben dus weinig of geen aanpassingen nodig.",
      },
      {
        q: "Wat doet RevenueCat dat openpurr niet doet?",
        a: "Paywalls, analytics-integraties van derden, Customer Center, virtuele valuta, webbetalingen, Amazon, advertentie-events en een commercieel supportcontract vallen voorlopig buiten scope. Prijsexperimenten zijn ingebouwd. Heb je de andere functies vandaag nodig, dan past een commercieel platform beter.",
      },
      {
        q: "Is openpurr klaar voor productie?",
        a: "Nog niet. openpurr staat nog aan het begin: beide edities werken en doorstaan dezelfde conformiteitstests, maar ze zijn nog niet end-to-end getest met aankopen op echte apparaten. Volg de roadmap op GitHub en open een issue als iets belangrijk voor je is.",
      },
      {
        q: "Is openpurr verbonden aan RevenueCat?",
        a: "Nee. openpurr is een onafhankelijk open-sourceproject, niet verbonden aan en niet onderschreven door RevenueCat, Inc. Het werkt met de officiële Purchases SDK van RevenueCat, die onder de MIT-licentie valt.",
      },
    ],
  },
  structured: {
    description:
      "Een self-hosted, open-source alternatief voor RevenueCat: een backend voor in-app-aankopen en abonnementen in de App Store en Google Play die werkt met de officiële, ongewijzigde Purchases SDK. Het valideert aankopen, houdt entitlements bij, ontvangt store-meldingen, stuurt webhooks en toont abonnementscijfers in grafieken.",
    subCategory: "Backend voor in-app-aankopen en abonnementen",
    features: [
      "Werkt met de officiële RevenueCat Purchases SDK voor iOS, Android, Flutter en React Native",
      "Validatie van StoreKit 2- en Google Play-aankopen",
      "App Store Server Notifications V2 en Google Play Real-time Developer Notifications",
      "Webhooks in het formaat van RevenueCat, ondertekend met HMAC-SHA256",
      "16 abonnementsgrafieken, waaronder MRR, churn en conversie van proefperiodes",
      "Prijsexperimenten op offerings, met resultaten per variant",
      "MCP-server, CLI en Claude-skills",
    ],
  },
};
