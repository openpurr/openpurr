// The "Add in-app purchases" page in this language (see en.ts for the notes).
import type { StartDict } from "./en";

export const startIt: StartDict = {
  meta: {
    title: "Acquisti in-app e abbonamenti gratis nella tua app - openpurr",
    description:
      "Nuova app? Aggiungi acquisti in-app e abbonamenti con il Purchases SDK ufficiale e un backend open source che gestisci tu. Nessuna quota dei ricavi, mai.",
    ogImageAlt: "Stai iniziando una nuova app? Parti senza quota dei ricavi. Tieniti il tuo 1% e investilo nella tua attività.",
  },
  hero: {
    crumb: "Aggiungi acquisti in-app",
    eyebrow: "Per le nuove app",
    headline: "Stai iniziando una nuova app?",
    headlineAccent: "Parti senza quota dei ricavi.",
    lede: "La maggior parte dei backend per gli acquisti si prende l'1% dei tuoi ricavi appena superi {threshold} al mese, e il conto cresce ogni volta che cresci tu. Il modo più semplice per evitarlo è farlo prima della tua prima vendita. openpurr è un backend gratuito e open source per acquisti in-app e abbonamenti che gestisci tu, con lo stesso SDK ufficiale usato dalle grandi piattaforme.",
    ctaStart: "Inizia su GitHub",
    ctaHow: "Come funziona",
    ctaAi: "Copia un prompt per il tuo assistente IA",
  },
  growth: {
    title: "Il tuo 1%, dal primo giorno",
    text: "Scegli dove pensi che sarà la tua app tra tre anni. Ecco quanto si accumulerebbe con una quota dei ricavi dell'1% lungo la strada, ipotizzando una crescita costante da zero.",
    target: "Ricavi mensili tra tre anni",
    fee: "Quota dei ricavi dell'1%, in 3 anni",
    servers: "Gestendolo tu, in 3 anni",
    after: "E poi, ogni anno",
    chartLabel: "La quota dei ricavi che si accumula mese dopo mese in tre anni",
    summary: "Sono <b>{fee}</b> che cederesti prima del quarto anno, contro <b>{servers}</b> per i tuoi server. Tienili e investili nella tua attività.",
  },
  invest: {
    title: "Investilo nella tua attività, e in te",
    text: "Cosa compra un anno del tuo 1% se lo tieni:",
  },
  how: {
    title: "Come funziona",
    lede: "Quattro passaggi, e il codice che scrivi è lo stesso di qualsiasi tutorial di RevenueCat.",
    steps: [
      {
        title: "Fai il deploy di openpurr",
        text: "Esegui il setup sul tuo account Cloudflare. Per le app piccole Lite sta nel <b>piano gratuito</b>, e puoi rilanciare il setup senza rischi se si ferma a metà.",
      },
      {
        title: "Aggiungi la tua app e i prodotti",
        text: "La dashboard si apre sull'aggiunta della tua prima app: bundle ID e nome del pacchetto, poi prodotti, entitlement e offering.",
      },
      {
        title: "Aggiungi il Purchases SDK",
        text: "Installa il Purchases SDK ufficiale di RevenueCat, open source con licenza MIT, e imposta <b>un URL proxy</b> prima di configurarlo.",
      },
      {
        title: "Pubblica",
        text: "Gli acquisti vengono convalidati con Apple e Google, rinnovi e rimborsi arrivano tramite le notifiche degli store, e il tuo backend riceve i webhook. Usi Claude Code? Il plugin di openpurr ti guida nella configurazione di App Store Connect e Play Console.",
      },
    ],
    setupLabel: "Setup, sul tuo computer",
  },
  ai: {
    title: "Configuralo con il tuo assistente di programmazione IA",
    text: "Apri il progetto della tua app in Claude Code, Codex, Cursor, Grok o qualsiasi agente di programmazione e incolla questo prompt. Fa il deploy di openpurr, collega gli store e aggiunge l'SDK, chiedendoti prima di tutto ciò che richiede il tuo accesso.",
    copy: "Copia il prompt",
    copied: "Copiato",
    claudeTip: "Usi Claude Code? Aggiungi prima il plugin di openpurr, che ti guida passo passo:",
  },
  includes: {
    title: "Cosa ottieni",
    yes: [
      "Acquisti e abbonamenti su App Store e Google Play",
      "Entitlement e offering",
      "Webhook verso il tuo backend, firmati e con nuovi tentativi",
      "16 grafici: ricavi, MRR, churn, prove gratuite e altro",
      "Esperimenti sui prezzi",
      "I tuoi dati nel tuo database",
    ],
    notYetTitle: "Non ancora",
    notYet: "Editor di paywall, integrazioni di analytics di terze parti, eventi pubblicitari, pagamenti web e Amazon. Se ti servono dal primo giorno, le piattaforme commerciali li offrono già oggi.",
  },
  lockin: {
    title: "Nessun vincolo, in nessuna direzione",
    text: "Dato che openpurr usa il Purchases SDK standard, il tuo codice di acquisto funziona con entrambi i backend. Se openpurr ti sta stretto, o vuoi quello che aggiungono le piattaforme commerciali, cambiare è una modifica di configurazione e un import dei clienti, non una riscrittura.",
  },
  pricingLink: {
    text: "Ti chiedi dove finisce l'1% quando lo paghi?",
    link: "Guarda i prezzi di RevenueCat, voce per voce →",
  },
  faq: {
    title: "Le domande che ci fanno",
    items: {
      backend: {
        q: "Mi serve un backend per gli acquisti in-app?",
        a: "Non per forza: StoreKit e Google Play Billing girano sul dispositivo. Ma un backend tiene in ordine gli abbonamenti. Convalida gli acquisti con Apple e Google, segue rinnovi, cancellazioni e rimborsi tramite le notifiche degli store, e dice alla tua app e al tuo server chi ha accesso. openpurr è quel backend, e lo gestisci tu.",
      },
      cheapest: {
        q: "Qual è il modo più economico per aggiungere abbonamenti a un'app iOS o Android?",
        a: "Gestire il backend da te. Per le app piccole openpurr Lite sta nel piano gratuito di Cloudflare e funziona con il Purchases SDK, gratuito e open source, quindi paghi solo i server: circa {servers} all'anno per un'app che fa {m25k} al mese nel nostro modello, senza quota dei ricavi.",
      },
      free: {
        q: "openpurr è davvero gratis?",
        a: "Sì. È open source con licenza Apache 2.0, senza quote dei ricavi né commissioni per transazione. Paghi i tuoi server, e le app piccole stanno nel piano gratuito di Cloudflare.",
      },
      switch: {
        q: "Posso passare a RevenueCat più avanti?",
        a: "Sì. openpurr usa il Purchases SDK ufficiale di RevenueCat, quindi il codice di acquisto della tua app funziona con entrambi i backend e i tuoi prodotti negli store restano gli stessi. Cambiare è una modifica di configurazione più lo spostamento dei dati dei tuoi clienti.",
      },
      missing: {
        q: "Cosa non fa ancora openpurr?",
        a: "Editor di paywall, integrazioni di analytics di terze parti, eventi pubblicitari, pagamenti web e Amazon. Gli esperimenti sui prezzi sono già inclusi. Se ti serve il resto dal primo giorno, una piattaforma commerciale lo offre già oggi.",
      },
    },
  },
};
