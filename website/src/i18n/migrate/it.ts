// Italian copy of the migration page. Follows en.ts; see the notes there.
import type { MigrateDict } from "./en";

export const migrateIt: MigrateDict = {
  meta: {
    title: "Come migrare da RevenueCat a openpurr, passo per passo",
    description:
      "Sposta la tua app da RevenueCat a openpurr, l'alternativa a RevenueCat open source: tieni il Purchases SDK, importa ogni abbonato e mantieni il suo accesso.",
    ogImageAlt:
      "Passa da RevenueCat a openpurr senza perdere nessun abbonato: tieni il Purchases SDK, importa tutti i clienti e le vecchie versioni dell'app continuano a funzionare.",
  },
  hero: {
    crumb: "Migrare da RevenueCat",
    eyebrow: "Guida alla migrazione",
    headline: "Passa da RevenueCat a openpurr senza perdere nessun abbonato",
    lede: "Tieni il Purchases SDK che la tua app usa già. Importa i clienti esistenti dall'export di RevenueCat: openpurr recupera da sé ogni acquisto da Apple e Google. Le vecchie versioni dell'app continuano a funzionare mentre gli utenti aggiornano.",
    guide: "Leggi la guida passo per passo (in inglese)",
    steps: "Vedi i passaggi",
    updated: "Aggiornato il {date}",
  },
  summary: {
    title: "In breve",
    items: [
      "openpurr è un'alternativa a RevenueCat open source e self-hosted. Funziona con il Purchases SDK ufficiale di RevenueCat, senza modifiche.",
      "La tua app aggiunge una riga (l'URL del proxy dell'SDK) e una chiamata a <code>syncPurchases</code> da fare una sola volta. Il resto del codice di acquisto resta uguale.",
      "<code>openpurr import</code> porta i clienti esistenti dall'export di RevenueCat. Gli acquisti veri e propri vengono recuperati da Apple e Google, non copiati.",
      "Le app dell'App Store possono usare lo Scheduled Data Export di RevenueCat. Per Google Play serve un export per la migrazione dal supporto di RevenueCat, l'unico che contiene i token di acquisto.",
      "Entrambi i backend restano aggiornati finché la maggior parte degli utenti non ha aggiornato l'app, così nessuno perde l'accesso.",
      "Con il piano gratuito di Cloudflare, l'import gestisce circa 2.500 clienti al giorno. Con Workers Paid, un import grande richiede qualche ora.",
    ],
  },
  how: {
    eyebrow: "Come funziona",
    title: "Come funziona una migrazione da RevenueCat",
    lede: "openpurr non copia i record degli acquisti da RevenueCat. Gli basta sapere chi possiede quale acquisto, poi interroga gli store, esattamente come quando la tua app invia un acquisto.",
    ways: [
      {
        title: "L'import",
        body: "L'export di RevenueCat dice quale utente dell'app possiede quale acquisto sugli store. <code>openpurr import</code> chiede ad Apple e Google ogni acquisto e registra la risposta dello store per quell'utente. Porta tutti in una volta, comprese le persone che non apriranno mai più l'app.",
      },
      {
        title: "L'aggiornamento dell'app",
        body: "La nuova versione punta il Purchases SDK a openpurr e invia una volta gli acquisti di ogni cliente con <code>syncPurchases</code>. Così recupera chi mancava nell'export e chi ha acquistato dopo la sua creazione.",
      },
      {
        title: "Entrambi i backend, per un po'",
        body: "Le vecchie versioni dell'app continuano a parlare con RevenueCat finché gli utenti non aggiornano. RevenueCat inoltra a openpurr le notifiche di Apple, e una seconda sottoscrizione Pub/Sub fa lo stesso per Google, così entrambi restano aggiornati.",
      },
    ],
  },
  app: {
    eyebrow: "Nella tua app",
    title: "Cosa cambia nella tua app",
    lede: "Imposta l'URL del proxy prima di configure e invia una volta gli acquisti di ogni cliente. Le stesse due modifiche valgono per Android, Flutter e React Native; la guida ha il codice per ciascuno.",
    codeLabel: "Esempio in Swift: l'URL del proxy e una sincronizzazione una tantum",
    proxyComment: "Prima di configure(): l'unica riga che quasi tutte le app aggiungono",
    syncComment: "Una volta per installazione: invia a openpurr gli acquisti del cliente",
  },
  import: {
    eyebrow: "L'import",
    title: "Importare i clienti da RevenueCat",
    lede: "La CLI di openpurr legge le colonne di RevenueCat così come sono: ID utente dell'app, ID transazione dell'App Store, token di acquisto di Google Play e attributi come <code>$email</code>.",
    codeLabel: "Terminale: importare l'export di RevenueCat",
    dryRunComment: "Controlla le prime righe: interroga Apple e Google, non scrive nulla",
    importComment: "Importa tutti. Fermati quando vuoi; rilancialo per riprendere.",
    safeguards: [
      ["Nessuno perde l'accesso", "Un acquisto che l'app ha già inviato per un cliente resta suo; l'import non lo sposta mai."],
      ["Nessun webhook doppio", "Gli acquisti importati non sono nuovi, quindi openpurr non invia eventi per loro."],
      ["Grafici fedeli", "I clienti importati sono datati dal loro primo acquisto, non contati come nuovi il giorno dell'import."],
      ["La tua app continua a funzionare", "Con il piano gratuito di Cloudflare, l'import si ferma al 90% di un limite giornaliero e riprende il giorno dopo."],
      ["Fermati e riprendi", "L'avanzamento viene salvato. Importare due volte una riga non cambia nulla, quindi puoi rilanciare l'import con un export più recente."],
      ["Provalo prima", "Una prova a vuoto (dry run) interroga gli store e riporta cosa succederebbe, senza scrivere nulla."],
    ] as [string, string][],
  },
  steps: {
    eyebrow: "Passo per passo",
    title: "Come migrare da RevenueCat in sette passaggi",
    lede: "Entrambi i backend restano attivi finché non sei pronto a passare, così i clienti con versioni vecchie dell'app mantengono l'accesso.",
    items: [
      {
        title: "Configura openpurr",
        body: "Distribuisci openpurr Lite sul tuo account Cloudflare, dagli accesso alle API dell'App Store e di Google Play, e ricrea prodotti, entitlement e offering con gli stessi identificatori. Puoi anche tenere le chiavi SDK pubbliche di RevenueCat.",
      },
      {
        title: "Tieni informati entrambi i backend",
        body: "Imposta openpurr come Apple Server Notification Forwarding URL di RevenueCat e aggiungi la sottoscrizione push di openpurr al topic delle notifiche di Play.",
      },
      {
        title: "Ottieni l'export",
        body: "Solo App Store: lo Scheduled Data Export di RevenueCat contiene ciò che serve. Con Google Play, chiedi al supporto di RevenueCat un export per la migrazione, perché solo quello contiene i token di acquisto. La guida ha una richiesta che puoi copiare.",
      },
      { title: "Importa", body: "Esegui <code>openpurr import</code>, prima con una prova a vuoto. I problemi sulle singole righe finiscono in un report e non fermano l'import." },
      { title: "Pubblica l'aggiornamento dell'app", body: "Aggiungi l'URL del proxy e una chiamata una tantum a <code>syncPurchases</code>. Pubblicalo quando l'import è finito." },
      {
        title: "Verifica",
        body: "<code>openpurr doctor</code> controlla la configurazione. Cerca clienti che conosci e confronta gli abbonamenti attivi con i grafici di RevenueCat.",
      },
      {
        title: "Completa il passaggio",
        body: "Quando la maggior parte dei clienti ha aggiornato, punta Apple e Google direttamente a openpurr, attiva i webhook di openpurr e disattiva quelli di RevenueCat.",
      },
    ],
    source: "Fonte:",
    sourceNotifications: "RevenueCat: notifiche server di Apple (in inglese)",
    sourceExports: "RevenueCat: esportare i dati o migrare altrove (in inglese)",
    more: "Ogni comando e impostazione è nella guida completa (in inglese) →",
  },
  moves: {
    eyebrow: "Cosa si sposta",
    title: "Cosa si sposta da RevenueCat e cosa no",
    rows: [
      ["Abbonamenti e acquisti, con rinnovi, rimborsi, periodi di tolleranza e scadenze", "Sì, recuperati da Apple e Google"],
      ["Chi possiede quale acquisto", "Sì, dall'export di RevenueCat"],
      ["ID utente dell'app, compresi quelli anonimi", "Sì, invariati"],
      ["Attributi dei clienti ($email, $displayName e i tuoi)", "Sì, da un Audience export"],
      ["Prodotti, entitlement e offering", "Li ricrei tu, con gli stessi identificatori"],
      ["Storico dei grafici prima del passaggio", "In parte: conserva i CSV dei grafici di RevenueCat per il tuo archivio"],
      ["Esperimenti", "Li ricrei tu: openpurr esegue esperimenti sui prezzi con i tuoi offering"],
      ["Paywall, integrazioni, Customer Center", "No: openpurr non li offre"],
    ] as [string, string][],
  },
  faq: {
    eyebrow: "FAQ",
    title: "FAQ sulla migrazione da RevenueCat",
    items: [
      {
        q: "Devo cambiare il mio codice di acquisto?",
        a: "No. openpurr funziona con il Purchases SDK ufficiale di RevenueCat, senza modifiche. L'aggiornamento dell'app aggiunge l'URL del proxy prima di configure e una chiamata una tantum a syncPurchases. getOfferings, purchase, restorePurchases, logIn e il resto restano come sono.",
      },
      {
        q: "Mi serve l'aiuto di RevenueCat per migrare?",
        a: "Per le app dell'App Store no: lo Scheduled Data Export di RevenueCat contiene gli ID transazione di cui openpurr ha bisogno. Per Google Play sì: secondo la documentazione di RevenueCat, solo un export per la migrazione preparato dal supporto di RevenueCat include i token di acquisto richiesti da Google.",
      },
      {
        q: "E i clienti che non aggiornano mai l'app?",
        a: "L'import copre anche loro: i loro acquisti vengono recuperati da Apple e Google e assegnati agli stessi ID utente dell'app. Finché usano una versione vecchia dell'app, quella versione parla con RevenueCat, ed è per questo che entrambi i backend restano informati finché la maggior parte degli utenti non ha aggiornato.",
      },
      {
        q: "Quanto dura un import?",
        a: "Ogni cliente richiede circa 30 scritture di righe nel database. Con il piano gratuito di Cloudflare sono circa 2.500 clienti al giorno, e l'import si mette in pausa da solo al limite giornaliero e riprende il giorno dopo. Con Workers Paid (5 $ al mese), un import grande richiede qualche ora.",
      },
      {
        q: "I miei dati vengono copiati da RevenueCat?",
        a: "Viene copiata solo la corrispondenza tra utenti dell'app e acquisti sugli store, più gli attributi se li importi. Gli acquisti veri e propri arrivano direttamente da Apple e Google, quindi openpurr registra lo stato attuale degli store, rinnovi e rimborsi compresi.",
      },
    ],
  },
  cta: {
    title: "Pronto a passare?",
    body: "La guida spiega ogni passaggio. Se qualcosa nella tua configurazione non torna, apri una issue: le migrazioni influenzano cosa verrà sviluppato dopo.",
    guide: "Leggi la guida (in inglese)",
    github: "openpurr su GitHub",
    issue: "Apri una issue",
  },
};
