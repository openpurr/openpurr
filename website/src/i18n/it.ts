// Italian copy. Follows en.ts; see the notes there. Uses "tu", as is usual for developer tools; keeps "self-hosted", "store" and "backend" as Italian developers say them.
import type { Dict } from "./en";

export const it: Dict = {
  meta: {
    title: "openpurr: l'alternativa a RevenueCat open source e self-hosted",
    description:
      "openpurr è un'alternativa a RevenueCat open source e self-hosted. Tieni il Purchases SDK che usi già, puntalo al tuo server e non cedere quote dei tuoi ricavi.",
    ogImageAlt: "openpurr: un'alternativa a RevenueCat open source e self-hosted, accanto alla sua dashboard con i grafici degli abbonamenti",
  },
  header: {
    home: "Home di openpurr",
    nav: { features: "Funzionalità", editions: "Edizioni", roadmap: "Roadmap", faq: "FAQ", migrate: "Migrare" },
    language: "Lingua",
  },
  footer: {
    tagline: "Infrastruttura per gli acquisti open source, gestita da te.",
    roadmap: "Roadmap",
    contributing: "Contribuire",
    sponsor: "Sostienici",
    contact: "Contatti",
    privacy: "Privacy (in inglese)",
    disclaimer:
      "openpurr è un progetto indipendente, non affiliato né approvato da RevenueCat, Inc. App Store è un marchio di Apple Inc. Google Play è un marchio di Google LLC.",
    copyright: "Copyright {year} i contributori di openpurr.",
    cookieSettings: "Impostazioni dei cookie",
  },
  consent: {
    label: "Consenso ai cookie",
    text: "Vorremmo usare i cookie di Google Analytics per contare le visite e capire quali pagine sono utili. Non viene impostato nulla senza il tuo consenso, e puoi cambiare idea in qualsiasi momento da Impostazioni dei cookie.",
    privacy: "Privacy (in inglese)",
    decline: "Rifiuta",
    accept: "Accetta",
  },
  snippet: {
    tabs: "Piattaforma dell'SDK",
    note: "Una riga. Stesso SDK, stesso codice di acquisto.",
  },
  home: {
    hero: {
      /** HTML */
      title: 'L\'<span class="accent">alternativa a RevenueCat</span> open source e <span class="nowrap">self-hosted</span>',
      lede: "Controlla la tua infrastruttura per gli acquisti, non cedere nessuna quota dei ricavi e non dipendere da alcun servizio commerciale. Tieni il Purchases SDK che usi già: cambi un URL, non il tuo codice di acquisto.",
      star: "Metti una stella su GitHub",
      how: "Come funziona",
      shotAlt:
        "La dashboard di openpurr Lite, con 12 mesi di andamento dell'MRR, abbonamenti attivi, churn, nuovi clienti, nuove prove e prove attive",
    },
    why: {
      eyebrow: "Per chi è",
      title: "Per chi sviluppa app e preferisce gestire tutto da sé",
      lede: "openpurr funziona con gli SDK ufficiali, senza modifiche. Per passare a openpurr si comincia cambiando un URL, non riscrivendo il codice di acquisto.",
      reasons: [
        {
          title: "I tuoi dati, i tuoi server",
          body: "Acquisti, entitlement e credenziali degli store stanno in un database che gestisci, interroghi, salvi ed esporti tu. Nessun servizio esterno si mette tra la tua app e i tuoi clienti.",
        },
        {
          title: "Nessuna quota dei ricavi",
          body: "Nessuna percentuale sui ricavi e nessuna commissione per transazione. L'edizione Lite è pensata per stare nel piano gratuito di Cloudflare, quindi una piccola app può usarla senza spendere nulla.",
        },
        {
          title: "Nessun fornitore da cui dipendere",
          body: "È open source con licenza Apache 2.0. Leggi il codice, modificalo e spostalo tra Cloudflare e il tuo cloud.",
        },
      ],
    },
    how: {
      eyebrow: "Come funziona",
      title: "Il tuo server prende il posto del fornitore",
      lede: "La tua app continua a usare il Purchases SDK open source con cui viene già distribuita. L'SDK parla con openpurr. openpurr parla con gli store, tiene lo stato degli abbonamenti e comunica al tuo backend cosa è cambiato.",
      flowLabel: "Flusso delle richieste",
      app: "La tua app",
      sdkLicense: "Ufficiale, non modificato, con licenza MIT",
      sdkPlatforms: "iOS, Android, Flutter o React Native",
      coreWhere: "Su Cloudflare Workers o sul tuo cloud",
      appStoreApi: "Server API e notifiche",
      playApi: "Developer API e RTDN",
      backend: "Il tuo backend",
      backendHooks: "Webhook firmati",
      steps: [
        {
          title: "Distribuisci",
          /** HTML */
          body: "Esegui openpurr Lite sul tuo account Cloudflare. Una configurazione guidata, <code>pnpm run setup</code>, crea il database, distribuisce entrambi i Workers e crea il tuo account proprietario.",
        },
        {
          title: "Configura l'SDK",
          /** HTML */
          body: "Imposta l'URL del proxy prima di <code>configure</code>. Usa un dominio personalizzato di tua proprietà, così potrai spostarti in seguito.",
        },
        {
          title: "Collega gli store",
          /** HTML */
          body: "Aggiungi le credenziali degli store e gli URL per le notifiche. Il controllo della configurazione, <code>openpurr doctor</code>, le verifica e ti dice come sistemare ciò che manca.",
        },
      ],
    },
    features: {
      eyebrow: "Cosa fa",
      title: "Il backend per gli abbonamenti, senza gli extra che non usi",
      items: [
        {
          title: "Acquisti e notifiche degli store",
          body: "Convalida le transazioni StoreKit 2 e gli acquisti Google Play, restituisce il CustomerInfo e gli entitlement che l'SDK si aspetta, e mantiene aggiornati rinnovi, rimborsi e periodi di tolleranza grazie alle notifiche di App Store e Google Play.",
        },
        {
          title: "Webhook",
          body: "Invia al tuo backend eventi nel formato di RevenueCat, firmati con HMAC-SHA256 e ritentati per circa 72 ore.",
        },
        {
          title: "Grafici",
          body: "16 grafici: ricavi, MRR e ARR, andamento dell'MRR e degli abbonamenti, abbonamenti attivi e a pagamento, stato degli abbonamenti, churn, prove e conversione delle prove, nuovi clienti, rimborsi e tasso di rimborso, acquisti singoli. Filtra per app, store, prodotto e ambiente, con i ricavi convertiti in USD.",
        },
        {
          title: "Esperimenti sui prezzi",
          body: "Mostra offering diversi ai clienti nuovi della tua app, poi confronta conversione e ricavi per cliente, con la probabilità che ogni variante batta il controllo. Senza aggiornare l'app.",
        },
        {
          title: "Autenticazione e audit",
          body: "Chiavi SDK e chiavi segrete, accesso degli operatori con codici di autenticazione facoltativi, ruoli, token di accesso e un registro di audit.",
        },
        {
          title: "Server MCP e skill per Claude",
          body: "Chiedi a un assistente AI perché un cliente ha o non ha un entitlement, cerca acquisti o fatti guidare nella configurazione di App Store Connect e della Play Console.",
        },
      ],
    },
    editions: {
      eyebrow: "Due edizioni",
      title: "Parti in piccolo e cresci senza aggiornare l'app",
      lede: "Entrambe le edizioni superano la stessa suite di test di conformità. Se la tua app punta a un dominio personalizzato di tua proprietà, passare da Lite a Standard non richiede una nuova release dell'app.",
      lite: {
        badge: "Per app indipendenti",
        price: "0 $",
        priceNote: "con il piano gratuito di Cloudflare",
        items: [
          "TypeScript su Cloudflare Workers e D1",
          "Leggero ed economico da gestire",
          "Avvisi prima di raggiungere i limiti del piano gratuito",
        ],
      },
      standard: {
        badge: "In arrivo",
        price: "La tua bolletta cloud",
        priceNote: "niente di più",
        items: ["Go e Postgres in container", "GCP o AWS", "Per portafogli di app più grandi"],
      },
    },
    savings: {
      eyebrow: "Costi",
      title: "Quanto tieni rispetto a RevenueCat",
      lede: "Il piano Pro di RevenueCat è gratuito sotto i 2.500 $ al mese di ricavi tracciati, poi costa l'1% di tutti i ricavi. Lite funziona sul piano gratuito di Cloudflare e, quando la tua app lo supera, su Workers Paid da 5 $ al mese.",
      revenue: "Ricavi mensili",
      rc: "RevenueCat",
      op: "openpurr Lite",
      saved: "Risparmio all'anno",
      perMonth: "{amount} al mese",
      free: "Piano gratuito di Cloudflare",
      paid: "Cloudflare Workers Paid",
      chartLabel: "Costo mensile in base ai ricavi mensili: quello di RevenueCat cresce con i ricavi, quello di openpurr Lite resta vicino a zero",
      gapLegend: "Quanto tieni",
      tableSummary: "Confronta con altri livelli di ricavi",
      colRevenue: "Ricavi mensili",
      colRc: "RevenueCat, al mese",
      colOp: "openpurr Lite, al mese",
      colSaved: "Risparmio all'anno",
      methodSummary: "Come lo stimiamo",
      pricingLink: "Dove va a finire l'1% di RevenueCat? →",
      method: [
        "RevenueCat: il prezzo di listino del piano Pro, l'1% dei ricavi mensili tracciati a partire da 2.500 $. I ricavi tracciati contano i piani annuali e gli acquisti singoli nel mese in cui vengono pagati, quindi possono superare l'MRR. Gli account grandi possono negoziare prezzi Enterprise.",
        "openpurr Lite: i prezzi di Cloudflare per Workers e D1. Ipotizziamo circa 1,50 $ di ricavi mensili e circa 10 richieste SDK al giorno per utente attivo giornaliero. Su questa base le 100.000 richieste al giorno del piano gratuito coprono fino a circa {paidFrom} di ricavi mensili, con margine. Oltre, contiamo Workers Paid: 5 $ al mese, più 0,30 $ per milione di richieste oltre i 10 milioni.",
        "Non incluso: il tuo tempo per gestirlo. Le commissioni degli store sono le stesse in entrambi i casi.",
        "Prezzi verificati il {date}. openpurr non è affiliato a RevenueCat.",
      ],
    },
    fit: {
      eyebrow: "In tutta onestà",
      title: "Potrebbe non fare ancora per te",
      lede: "Se ti servono editor di paywall, integrazioni con strumenti di analytics di terze parti o un contratto di assistenza, le piattaforme commerciali li offrono già oggi.",
      outTitle: "Per ora fuori ambito",
      tags: [
        "Paywall",
        "Eventi pubblicitari",
        "Customer Center",
        "Valute virtuali",
        "Pagamenti web",
        "Amazon",
        "Integrazioni di analytics",
      ],
    },
    roadmap: {
      eyebrow: "Roadmap",
      title: "Dove sta andando",
      lede: "L'ordine è definito, ma non ci sono date. Se qualcosa ti sta a cuore, dillo in una issue.",
      status: { done: "Fatto", wip: "In corso", planned: "Pianificato", later: "Decidi tu" },
      /** In order: Lite, Standard, then the community phase. "{version}" is the latest release. */
      phases: [
        {
          phase: "Lite",
          items: [
            "Ultima release: {version}",
            "Pensato per il piano gratuito di Cloudflare",
            "App Store e Google Play",
            "Webhook, dashboard e amministrazione",
            "Più app in un solo deployment",
            "Esperimenti sui prezzi",
            "Server MCP, CLI e skill per Claude",
            "Prossimo passo: test sui dispositivi, poi la 1.0",
          ],
        },
        {
          phase: "Standard",
          items: [
            "Go e Postgres in container",
            "Prima GCP, poi AWS",
            "Stessa suite di conformità di Lite",
            "Passaggio da Lite senza aggiornare l'app",
          ],
        },
        {
          phase: "Guidata dalla community",
          items: ["Identità verificata degli utenti finali", "Extra di Standard per team più grandi", "Tutto ciò che chiedi nelle issue"],
        },
      ],
      more: "Leggi la roadmap completa (in inglese) →",
    },
    cta: {
      title: "Aiutaci a dargli forma",
      body: "L'aiuto più utile adesso è il feedback: ipotesi sbagliate sugli SDK o sugli store, e casi limite reali di rinnovi, rimborsi e periodi di tolleranza.",
      star: "Metti una stella su GitHub",
      issue: "Apri una issue",
      coffee: "Offrici un caffè",
    },
  },
  faq: {
    eyebrow: "FAQ",
    title: "openpurr come alternativa a RevenueCat",
    lede: "Cosa cambia quando gestisci da te il backend per gli abbonamenti, e cosa no.",
    items: [
      {
        q: "Che cos'è openpurr?",
        a: "openpurr è un'alternativa a RevenueCat open source e self-hosted. È un backend per acquisti in-app e abbonamenti che funziona con il Purchases SDK ufficiale di RevenueCat. Convalida gli acquisti dell'App Store e di Google Play, tiene traccia degli entitlement, riceve le notifiche degli store, invia webhook al tuo backend e mostra in grafici le principali metriche degli abbonamenti, il tutto su un'infrastruttura che controlli tu.",
      },
      {
        q: "In cosa openpurr è diverso da RevenueCat?",
        a: "RevenueCat è un servizio commerciale in hosting che trattiene una quota dei ricavi oltre una soglia gratuita. openpurr è un software che esegui tu: acquisti, entitlement e credenziali degli store stanno nel tuo database, e non ci sono quote dei ricavi né commissioni per transazione. Oggi RevenueCat offre più funzionalità, come paywall e integrazioni di analytics. openpurr si concentra sul backend essenziale per gli abbonamenti.",
      },
      {
        q: "Devo riscrivere il mio codice di acquisto per passare da RevenueCat a openpurr?",
        a: "No. openpurr funziona con il Purchases SDK ufficiale, senza modifiche. Imposti l'URL del proxy dell'SDK sul tuo server openpurr prima di chiamare configure, e il resto del codice di acquisto resta uguale. Usa un dominio personalizzato di tua proprietà, così in seguito potrai cambiare server senza aggiornare l'app.",
      },
      {
        q: "Come sposto i miei clienti esistenti da RevenueCat?",
        a: "Li importi. Chiedi a RevenueCat un export per la migrazione: openpurr import recupera gli acquisti di ogni cliente da Apple e Google e li assegna agli stessi ID utente dell'app. Anche la nuova versione della tua app invia una volta gli acquisti di ogni cliente, ed entrambi i backend restano aggiornati mentre gli utenti aggiornano l'app, così nessuno perde l'accesso.",
        link: "Come migrare",
      },
      {
        q: "Posso passare da Adapty?",
        a: "Sì, con un aggiornamento dell'app. L'SDK di Adapty non può essere puntato verso un altro server, quindi l'aggiornamento lo sostituisce con il Purchases SDK, con cui funziona openpurr. I tuoi prodotti negli store restano gli stessi. openpurr importa i tuoi clienti dell'App Store dall'export degli eventi di Adapty, la nuova versione della tua app porta con sé tutti gli altri al primo avvio, ed entrambi i backend restano aggiornati mentre gli utenti aggiornano l'app.",
        link: "Leggi la guida Adapty",
        linkTo: "adapty",
      },
      {
        q: "Quali piattaforme e store supporta openpurr?",
        a: "openpurr supporta il Purchases SDK per iOS, Android, Flutter e React Native, con acquisti dall'App Store e da Google Play. Amazon e i pagamenti web per ora sono fuori ambito.",
      },
      {
        q: "Quanto costa openpurr?",
        a: "openpurr è gratuito e open source con licenza Apache 2.0. Paghi solo l'infrastruttura su cui gira. L'edizione Lite è pensata per il piano gratuito di Cloudflare, quindi una piccola app può usarla senza spendere nulla. L'edizione Standard gira in container sul tuo cloud, quindi il suo costo è la tua bolletta cloud.",
      },
      {
        q: "Dove sono archiviati i miei dati?",
        a: "Nel tuo database. L'edizione Lite usa Cloudflare D1 nel tuo account Cloudflare. L'edizione Standard usa Postgres su GCP o AWS. Puoi interrogarli, farne il backup ed esportarli, e nessun servizio esterno si mette tra la tua app e i tuoi clienti.",
      },
      {
        q: "openpurr invia webhook come RevenueCat?",
        a: "Sì. openpurr invia al tuo backend eventi nel formato di RevenueCat, firmati con HMAC-SHA256 e ritentati per circa 72 ore, quindi i gestori di webhook esistenti richiedono poche modifiche o nessuna.",
      },
      {
        q: "Cosa fa RevenueCat che openpurr non fa?",
        a: "Paywall, integrazioni di analytics di terze parti, Customer Center, valute virtuali, pagamenti web, Amazon, eventi pubblicitari e un contratto di assistenza commerciale sono per ora fuori ambito. Gli esperimenti sui prezzi sono già inclusi. Se ti serve il resto già oggi, una piattaforma commerciale fa più al caso tuo.",
      },
      {
        q: "openpurr è pronto per la produzione?",
        a: "Non ancora. openpurr è agli inizi: l'edizione Lite è in sviluppo e l'edizione Standard arriverà più avanti. Segui la roadmap su GitHub e apri una issue se qualcosa ti sta a cuore.",
      },
      {
        q: "openpurr è affiliato a RevenueCat?",
        a: "No. openpurr è un progetto open source indipendente, non affiliato né approvato da RevenueCat, Inc. Funziona con il Purchases SDK ufficiale di RevenueCat, distribuito con licenza MIT.",
      },
    ],
  },
  /** The SoftwareApplication structured data. */
  structured: {
    description:
      "Un'alternativa a RevenueCat open source e self-hosted: un backend per acquisti in-app e abbonamenti dell'App Store e di Google Play che funziona con il Purchases SDK ufficiale, senza modifiche. Convalida gli acquisti, tiene traccia degli entitlement, riceve le notifiche degli store, invia webhook e mostra in grafici le metriche degli abbonamenti.",
    subCategory: "Backend per acquisti in-app e abbonamenti",
    features: [
      "Funziona con il Purchases SDK ufficiale di RevenueCat per iOS, Android, Flutter e React Native",
      "Convalida degli acquisti StoreKit 2 e Google Play",
      "App Store Server Notifications V2 e Real-time Developer Notifications di Google Play",
      "Webhook nel formato di RevenueCat, firmati con HMAC-SHA256",
      "16 grafici sugli abbonamenti, tra cui MRR, churn e conversione delle prove",
      "Esperimenti sui prezzi sugli offering, con risultati per variante",
      "Server MCP, CLI e skill per Claude",
    ],
  },
};
