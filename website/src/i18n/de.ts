// German copy. Follows en.ts; see the notes there. Uses "du", as is usual for developer tools.
import type { Dict } from "./en";

export const de: Dict = {
  meta: {
    title: "openpurr: die selbst gehostete Open-Source-Alternative zu RevenueCat",
    description:
      "openpurr ist eine selbst gehostete Open-Source-Alternative zu RevenueCat. Behalte das Purchases SDK, das du schon nutzt, richte es auf deinen eigenen Server und zahle keine Umsatzbeteiligung.",
    ogImageAlt: "openpurr: eine selbst gehostete Open-Source-Alternative zu RevenueCat, neben dem Dashboard mit den Abo-Diagrammen",
  },
  header: {
    home: "openpurr Startseite",
    nav: { features: "Funktionen", editions: "Editionen", roadmap: "Roadmap", faq: "FAQ" },
    language: "Sprache",
  },
  footer: {
    tagline: "Open-Source-Infrastruktur für In-App-Käufe, die du selbst betreibst.",
    roadmap: "Roadmap",
    contributing: "Mitmachen",
    sponsor: "Unterstützen",
    privacy: "Datenschutz (Englisch)",
    disclaimer:
      "openpurr ist ein unabhängiges Projekt. Es ist weder mit RevenueCat, Inc. verbunden noch von RevenueCat, Inc. unterstützt. App Store ist eine Marke von Apple Inc. Google Play ist eine Marke von Google LLC.",
    copyright: "Copyright {year} openpurr-Mitwirkende.",
    cookieSettings: "Cookie-Einstellungen",
  },
  consent: {
    label: "Cookie-Einwilligung",
    text: "Wir würden gern Cookies von Google Analytics verwenden, um Besuche zu zählen und zu sehen, welche Seiten helfen. Ohne deine Zustimmung wird nichts gesetzt, und du kannst deine Entscheidung jederzeit unter Cookie-Einstellungen ändern.",
    privacy: "Datenschutz (Englisch)",
    decline: "Ablehnen",
    accept: "Akzeptieren",
  },
  snippet: {
    tabs: "SDK-Plattform",
    note: "Eine Zeile. Dasselbe SDK, derselbe Kaufcode.",
  },
  home: {
    hero: {
      title: 'Die <span class="nowrap">selbst gehostete</span> Open-Source-<span class="accent">Alternative zu RevenueCat</span>',
      lede: "Betreibe deine Kauf-Infrastruktur selbst, gib keinen Anteil deines Umsatzes ab und mach dich von keinem kommerziellen Dienst abhängig. Das Purchases SDK, das du schon nutzt, bleibt: Du änderst eine URL, nicht deinen Kaufcode.",
      star: "Auf GitHub einen Stern geben",
      how: "So funktioniert's",
      shotAlt:
        "Das Dashboard von openpurr Lite mit 12 Monaten MRR-Bewegung, aktiven Abos, Churn, Neukunden, neuen Testphasen und aktiven Testphasen",
    },
    why: {
      eyebrow: "Für wen",
      title: "Für App-Entwickler, die es lieber selbst betreiben",
      lede: "openpurr funktioniert mit den offiziellen, unveränderten SDKs. Der Umstieg beginnt mit einer geänderten URL, nicht mit neu geschriebenem Kaufcode.",
      reasons: [
        {
          title: "Deine Daten, deine Server",
          body: "Käufe, Entitlements und Store-Zugangsdaten liegen in einer Datenbank, die du betreibst, abfragst, sicherst und exportierst. Kein externer Dienst steht zwischen deiner App und deinen Kunden.",
        },
        {
          title: "Keine Umsatzbeteiligung",
          body: "Kein Prozentsatz vom Umsatz und keine Gebühren pro Transaktion. Die Lite-Edition ist für den kostenlosen Cloudflare-Tarif ausgelegt, sodass eine kleine App sie kostenlos betreiben kann.",
        },
        {
          title: "Von keinem Anbieter abhängig",
          body: "Der Code ist Open Source unter Apache 2.0. Lies ihn, ändere ihn und zieh damit zwischen Cloudflare und deiner eigenen Cloud um.",
        },
      ],
    },
    how: {
      eyebrow: "So funktioniert's",
      title: "Dein Server steht dort, wo früher der Anbieter war",
      lede: "Deine App behält das Open-Source-Purchases-SDK, mit dem sie schon ausgeliefert wird. Das SDK spricht mit openpurr. openpurr spricht mit den Stores, verwaltet den Abo-Status und teilt deinem Backend mit, was sich geändert hat.",
      flowLabel: "Ablauf einer Anfrage",
      app: "Deine App",
      sdkLicense: "Offiziell, unverändert, MIT-lizenziert",
      sdkPlatforms: "iOS, Android, Flutter oder React Native",
      coreWhere: "Auf Cloudflare Workers oder in deiner eigenen Cloud",
      appStoreApi: "Server API und Benachrichtigungen",
      playApi: "Developer API und RTDN",
      backend: "Dein Backend",
      backendHooks: "Signierte Webhooks",
      steps: [
        {
          title: "Bereitstellen",
          body: "Betreibe openpurr Lite in deinem eigenen Cloudflare-Konto. Ein geführtes Setup, <code>pnpm run setup</code>, legt die Datenbank an, stellt beide Workers bereit und erstellt dein Inhaberkonto.",
        },
        {
          title: "SDK umstellen",
          body: "Setze die Proxy-URL vor <code>configure</code>. Nutze eine eigene Domain, damit du später umziehen kannst.",
        },
        {
          title: "Stores verbinden",
          body: "Trage deine Store-Zugangsdaten und Benachrichtigungs-URLs ein. Die Setup-Prüfung <code>openpurr doctor</code> kontrolliert sie und sagt dir, wie du Fehlendes behebst.",
        },
      ],
    },
    features: {
      eyebrow: "Was es kann",
      title: "Das Abo-Backend, ohne die Extras, die du nicht nutzt",
      items: [
        {
          title: "Käufe",
          body: "Validiert StoreKit-2-Transaktionen und Google-Play-Käufe und liefert die CustomerInfo und Entitlements, die das SDK erwartet.",
        },
        {
          title: "Store-Benachrichtigungen",
          body: "Empfängt App Store Server Notifications V2 und Google Play Real-time Developer Notifications, damit Verlängerungen, Erstattungen und Kulanzzeiträume aktuell bleiben.",
        },
        {
          title: "Webhooks",
          body: "Sendet Ereignisse im Format von RevenueCat an dein Backend, signiert mit HMAC-SHA256 und etwa 72 Stunden lang erneut zugestellt.",
        },
        {
          title: "Diagramme",
          body: "16 Diagramme: Umsatz, MRR und ARR, MRR- und Abo-Bewegung, aktive und bezahlte Abos, Abo-Status, Churn, Testphasen und ihre Conversion, Neukunden, Erstattungen und Erstattungsquote sowie Einmalkäufe. Filter nach App, Store, Produkt und Umgebung, mit Umsatz in USD umgerechnet.",
        },
        {
          title: "Anmeldung und Audit",
          body: "SDK-Keys und Secret Keys, Anmeldung für Betreiber mit optionalen Authenticator-Codes, Rollen, Zugriffstokens und ein Audit-Log.",
        },
        {
          title: "MCP-Server und Claude-Skills",
          body: "Frag einen KI-Assistenten, warum ein Kunde ein Entitlement hat oder nicht, schlag Käufe nach oder lass dich durch die Einrichtung in App Store Connect und der Play Console führen.",
        },
      ],
    },
    editions: {
      eyebrow: "Zwei Editionen",
      title: "Klein anfangen, ohne App-Update aufsteigen",
      lede: "Beide Editionen bestehen dieselbe Konformitäts-Testsuite. Zeigt deine App auf eine eigene Domain, brauchst du für den Wechsel von Lite zu Standard kein neues App-Release.",
      lite: {
        badge: "Für Indie-Apps",
        price: "0 $",
        priceNote: "im kostenlosen Cloudflare-Tarif",
        items: [
          "TypeScript auf Cloudflare Workers und D1",
          "Leichtgewichtig und günstig im Betrieb",
          "Warnungen, bevor du die Limits des kostenlosen Tarifs erreichst",
        ],
      },
      standard: {
        badge: "Demnächst",
        price: "Deine Cloud-Rechnung",
        priceNote: "sonst nichts",
        items: ["Go und Postgres in Containern", "GCP oder AWS", "Für größere App-Portfolios"],
      },
    },
    fit: {
      eyebrow: "Ganz ehrlich",
      title: "Vielleicht ist es noch nichts für dich",
      lede: "Wenn du Paywall-Builder, A/B-Tests, Analytics-Integrationen von Drittanbietern oder einen Supportvertrag brauchst, bieten kommerzielle Plattformen das heute schon.",
      outTitle: "Vorerst nicht vorgesehen",
      tags: ["Paywalls", "Werbeereignisse", "Customer Center", "Virtuelle Währungen", "Web-Billing", "Amazon", "Experimente", "Analytics-Integrationen"],
    },
    roadmap: {
      eyebrow: "Roadmap",
      title: "Wohin es geht",
      lede: "Die Reihenfolge steht fest, Termine gibt es keine. Wenn dir etwas wichtig ist, sag es in einem Issue.",
      status: { done: "Fertig", wip: "In Arbeit", planned: "Geplant", later: "Du entscheidest" },
      phases: [
        {
          phase: "Lite",
          items: [
            "Aktuelles Release: {version}",
            "Für den kostenlosen Cloudflare-Tarif ausgelegt",
            "App Store und Google Play",
            "Webhooks, Dashboard und Verwaltung",
            "Mehrere Apps in einem Deployment",
            "MCP-Server, CLI und Claude-Skills",
            "Als Nächstes: Tests auf Geräten, dann 1.0",
          ],
        },
        {
          phase: "Standard",
          items: ["Go und Postgres in Containern", "Zuerst GCP, dann AWS", "Dieselbe Konformitäts-Testsuite wie Lite", "Umstieg von Lite ohne App-Update"],
        },
        {
          phase: "Von der Community gestaltet",
          items: ["Verifizierte Identität der Endnutzer", "Standard-Extras für größere Teams", "Was immer du dir in Issues wünschst"],
        },
      ],
      more: "Die ganze Roadmap lesen (Englisch) →",
    },
    cta: {
      title: "Gestalte mit",
      body: "Am meisten hilft gerade Feedback: falsche Annahmen über die SDKs oder die Stores und echte Sonderfälle bei Verlängerungen, Erstattungen und Kulanzzeiträumen.",
      star: "Auf GitHub einen Stern geben",
      issue: "Issue eröffnen",
      coffee: "Spendier uns einen Kaffee",
    },
  },
  faq: {
    eyebrow: "FAQ",
    title: "openpurr als Alternative zu RevenueCat",
    lede: "Was sich ändert, wenn du dein eigenes Abo-Backend betreibst, und was nicht.",
    items: [
      {
        q: "Was ist openpurr?",
        a: "openpurr ist eine selbst gehostete Open-Source-Alternative zu RevenueCat. Es ist ein Backend für In-App-Käufe und Abos, das mit dem offiziellen RevenueCat Purchases SDK funktioniert. Es validiert Käufe aus dem App Store und von Google Play, verwaltet Entitlements, empfängt Store-Benachrichtigungen, sendet Webhooks an dein Backend und stellt deine wichtigsten Abo-Kennzahlen in Diagrammen dar, alles auf Infrastruktur, die du kontrollierst.",
      },
      {
        q: "Worin unterscheidet sich openpurr von RevenueCat?",
        a: "RevenueCat ist ein gehosteter kommerzieller Dienst, der oberhalb eines kostenlosen Kontingents einen Anteil am Umsatz verlangt. openpurr ist Software, die du selbst betreibst: Deine Käufe, Entitlements und Store-Zugangsdaten liegen in deiner eigenen Datenbank, und es gibt weder Umsatzbeteiligung noch Gebühren pro Transaktion. RevenueCat bietet heute mehr Funktionen, etwa Paywalls, Experimente und Analytics-Integrationen. openpurr konzentriert sich auf das zentrale Abo-Backend.",
      },
      {
        q: "Muss ich meinen Kaufcode neu schreiben, um von RevenueCat umzusteigen?",
        a: "Nein. openpurr funktioniert mit dem offiziellen, unveränderten Purchases SDK. Du setzt die Proxy-URL des SDK vor dem Aufruf von configure auf deinen openpurr-Server, und der restliche Kaufcode bleibt gleich. Verwende eine eigene Domain, damit du später ohne App-Update den Server wechseln kannst.",
      },
      {
        q: "Welche Plattformen und Stores unterstützt openpurr?",
        a: "Das Purchases SDK für iOS, Android, Flutter und React Native, mit Käufen aus dem App Store und von Google Play. Amazon und Web-Billing sind vorerst nicht vorgesehen.",
      },
      {
        q: "Was kostet openpurr?",
        a: "openpurr ist kostenlos und Open Source unter der Apache-2.0-Lizenz. Du zahlst nur für die Infrastruktur, auf der es läuft. Die Lite-Edition ist für den kostenlosen Cloudflare-Tarif ausgelegt, sodass eine kleine App sie kostenlos betreiben kann. Die Standard-Edition läuft in Containern in deiner eigenen Cloud, ihre Kosten sind also deine Cloud-Rechnung.",
      },
      {
        q: "Wo werden meine Daten gespeichert?",
        a: "In deiner eigenen Datenbank. Die Lite-Edition nutzt Cloudflare D1 in deinem Cloudflare-Konto, die Standard-Edition Postgres auf GCP oder AWS. Du kannst die Daten abfragen, sichern und exportieren, und kein externer Dienst steht zwischen deiner App und deinen Kunden.",
      },
      {
        q: "Sendet openpurr Webhooks wie RevenueCat?",
        a: "Ja. openpurr sendet Ereignisse im Format von RevenueCat an dein Backend, signiert mit HMAC-SHA256 und etwa 72 Stunden lang erneut zugestellt. Bestehende Webhook-Handler brauchen also kaum oder gar keine Änderungen.",
      },
      {
        q: "Was kann RevenueCat, was openpurr nicht kann?",
        a: "Paywalls, A/B-Experimente, Analytics-Integrationen von Drittanbietern, Customer Center, virtuelle Währungen, Web-Billing, Amazon, Werbeereignisse und ein kommerzieller Supportvertrag sind vorerst nicht vorgesehen. Wenn du das heute brauchst, passt eine kommerzielle Plattform besser.",
      },
      {
        q: "Ist openpurr bereit für den Produktivbetrieb?",
        a: "Noch nicht. openpurr steht am Anfang: Die Lite-Edition ist in Arbeit, die Standard-Edition kommt später. Verfolge die Roadmap auf GitHub und eröffne ein Issue, wenn dir etwas wichtig ist.",
      },
      {
        q: "Ist openpurr mit RevenueCat verbunden?",
        a: "Nein. openpurr ist ein unabhängiges Open-Source-Projekt und weder mit RevenueCat, Inc. verbunden noch von RevenueCat, Inc. unterstützt. Es funktioniert mit dem offiziellen Purchases SDK von RevenueCat, das unter der MIT-Lizenz steht.",
      },
    ],
  },
  structured: {
    description:
      "Eine selbst gehostete Open-Source-Alternative zu RevenueCat: ein Backend für In-App-Käufe und Abos aus dem App Store und von Google Play, das mit dem offiziellen, unveränderten Purchases SDK funktioniert. Es validiert Käufe, verwaltet Entitlements, empfängt Store-Benachrichtigungen, sendet Webhooks und stellt Abo-Kennzahlen in Diagrammen dar.",
    subCategory: "Backend für In-App-Käufe und Abos",
    features: [
      "Funktioniert mit dem offiziellen RevenueCat Purchases SDK für iOS, Android, Flutter und React Native",
      "Validierung von StoreKit-2- und Google-Play-Käufen",
      "App Store Server Notifications V2 und Google Play Real-time Developer Notifications",
      "Webhooks im Format von RevenueCat, signiert mit HMAC-SHA256",
      "16 Abo-Diagramme, darunter MRR, Churn und Conversion von Testphasen",
      "MCP-Server, CLI und Claude-Skills",
    ],
  },
};
