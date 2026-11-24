// The RevenueCat pricing page in this language (see en.ts for the notes).
import type { PricingDict } from "./en";

export const pricingIt: PricingDict = {
  meta: {
    title: "Prezzi RevenueCat: dove finisce davvero il tuo 1% · openpurr",
    description:
      "RevenueCat si prende l'1% dei tuoi ricavi. I server dietro la tua app costano spiccioli. Ecco cosa paga il resto: stipendi, vendite e investitori.",
    ogImageAlt: "RevenueCat si prende l'1% dei tuoi ricavi; i server costano spiccioli. Cosa paga il resto.",
  },
  hero: {
    crumb: "Prezzi di RevenueCat",
    eyebrow: "Dove finisce il tuo 1%",
    headline: "Non stai pagando dei server.",
    /** The headline's second, highlighted sentence. {valuation} is "$500 million". */
    headlineAccent: "Stai pagando un'azienda da {valuation}.",
    /** {threshold} is "$2,500". */
    lede: "RevenueCat si prende l'1% di tutti i tuoi ricavi tracciati appena superi {threshold} al mese, e il conto cresce ogni volta che cresci tu. I server dietro la tua app costano spiccioli. Il resto paga l'azienda: i suoi stipendi, il suo team commerciale e il ritorno dei suoi investitori.",
    updated: "Aggiornato il {date} · Stime basate su dati pubblici",
  },
  answer: {
    title: "I prezzi di RevenueCat in una riga",
    /** HTML. {threshold} is "$2,500". */
    text: "Gratis sotto {threshold} di ricavi tracciati al mese, poi <strong>l'1% di tutto</strong>. Quanto fa in un anno, accanto a quanto costano i server per la stessa app:",
    colRevenue: "Ricavi mensili",
    colFee: "RevenueCat, all'anno",
    colServers: "Server, all'anno",
  },
  calc: {
    revenue: "I ricavi mensili della tua app",
    fee: "RevenueCat si prende",
    servers: "I server costano in realtà",
    perYear: "all'anno",
    stackLabel: "La tua quota annuale, divisa tra i server e i team di RevenueCat",
    /** HTML. {servers} and {rest} are percentages. */
    stackNote: "Server: {servers}. Tutto il resto, {rest}, paga i loro team:",
    /** {people} is a number, {salary} is like "$210K". */
    teamMeta: "Circa {people} persone · stipendio tipico {salary}",
    swag: "Sempre in conto: skateboard luminosi RevenueCat per il team, e tutto il resto dello sforzo per sembrare cool. Il tuo 1% paga anche questo.",
    ownersTitle: "Il tuo 1% costruisce l'exit di qualcun altro",
    /** {pct} is like "55%". */
    ownersInvestors: "Investitori di venture capital · circa {pct}",
    ownersRest: "Fondatori e dipendenti",
    ownersBarLabel: "Gli investitori di venture capital possiedono circa il {pct} di RevenueCat, secondo la nostra stima",
    /** HTML. {funding} is "$100 million"; {vc} is an amount that moves with the slider. */
    ownersText:
      "Gli investitori di venture capital hanno messo circa {funding} in RevenueCat in cinque round e, in base alle valutazioni riportate, ne possiedono più della metà. Non hanno bisogno di una fetta di ogni pagamento. Ogni commissione che paghi fa salire il valore dell'azienda che possiedono, e incassano quando viene venduta. In termini di quote, circa {vc} di quello che paghi ogni anno costruisce il loro ritorno.",
    investorsLabel: "Gli investitori di RevenueCat",
    /** HTML. {days} is a number, {infra} an amount; both move with the slider. */
    punch: "Il tuo 1% compra circa {days} giornate di un ingegnere all'anno da RevenueCat. Gestire lo stesso lavoro da solo costa {infra}.",
    /** HTML. {keep} is an amount that moves with the slider. */
    keep: "Tieniti gli altri {keep}.",
    ctaKeep: "Tieniti il tuo 1% →",
    ctaGithub: "openpurr su GitHub",
  },
  teams: {
    eng: { name: "Engineering", basis: "Annuncio per Senior SDK Engineer, 212.000 $" },
    product: { name: "Prodotto, design e dati", basis: "Annunci per Senior Product Manager, 230.000 $; Senior Data Scientist, 220.000 $" },
    sales: { name: "Vendite", basis: "Annuncio per Head of Sales, 363.000 $; Senior Sales Engineer, 200.000 $; Product Expert, 133.000 $" },
    growth: { name: "Marketing e crescita", basis: "Annuncio per Head of Customer Growth, 259.000 $; CRO Designer, 205.000 $; Product Marketing, 168.000 $" },
    support: { name: "Customer success e assistenza", basis: "Annuncio per Developer Support Engineer, 118.000 $" },
    community: { name: "Developer relations e community", basis: "La mediana complessiva degli annunci, circa 215.000 $, ridotta per un mix di livelli" },
    ops: { name: "Operations, finanza e HR", basis: "Annuncio per Sales and Operations Specialist, 167.000 $; Head of People, 280.000 $" },
    exec: { name: "Dirigenti", basis: "Sopra l'annuncio per Head of Sales (363.000 $) per alcuni, sotto per altri" },
  },
  faq: {
    title: "Le domande che ci fanno",
    /** Each answer is also the page's FAQ structured data. Amounts are filled in by the page. */
    items: {
      cost: {
        q: "Quanto costa RevenueCat?",
        /** {threshold} "$2,500"; {at10k} the yearly fee at $10,000 a month, {at100k} at $100,000 a month; {m10k} "$10,000", {m100k} "$100,000". */
        a: "Il piano Pro di RevenueCat è gratuito sotto {threshold} di ricavi tracciati al mese. Da lì costa l'1% di tutti i ricavi, non solo della parte sopra {threshold}: {at10k} all'anno per un'app che fa {m10k} al mese, {at100k} all'anno con {m100k} al mese. Gli account grandi possono negoziare prezzi Enterprise.",
      },
      pays: {
        q: "Cosa paga la commissione dell'1% di RevenueCat?",
        /** {servers} and {fee} are yearly amounts for an app making {m25k} ("$25,000") a month; {people} is a number. */
        a: "Soprattutto l'azienda. I server dietro un'app tipica costano pochi dollari al mese: {servers} all'anno per un'app che fa {m25k} al mese, contro {fee} di commissioni. Il resto paga un team di circa {people} persone, tra engineering, vendite, marketing e dirigenti, e crea valore per gli investitori dell'azienda.",
      },
      owns: {
        q: "Di chi è RevenueCat?",
        /** {funding} "$100 million"; {investors} the list of firms, already joined; {pct} like "55%". */
        a: "RevenueCat ha raccolto circa {funding} da investitori di venture capital in cinque round, tra cui {investors}. Combinando le valutazioni riportate dei vari round, gli investitori possiedono circa il {pct} dell'azienda. Il resto appartiene ai fondatori e ai dipendenti.",
      },
      worth: {
        q: "Quanto vale RevenueCat?",
        /** {valuation} "$500 million", {round} "$50 million", {revenue} "$30 million". */
        a: "Secondo la stampa, RevenueCat era valutata {valuation} quando ha raccolto la sua Serie C da {round} nel 2025, con circa {revenue} di ricavi annuali all'epoca. Sono cifre di stampa e analisti, non dati comunicati dall'azienda.",
      },
      alternative: {
        q: "Esiste un'alternativa a RevenueCat senza quota dei ricavi?",
        a: "Sì. openpurr è un backend gratuito, open source e self-hosted che funziona con il Purchases SDK ufficiale di RevenueCat. Punti l'URL proxy dell'SDK al tuo server e tieni il tuo codice di acquisto. Per le app piccole gira sul piano gratuito di Cloudflare, senza quote dei ricavi né commissioni per transazione.",
      },
    },
  },
  more: {
    title: "Sì, fanno di più",
    text: "RevenueCat offre più di un backend per gli acquisti: paywall, esperimenti, integrazioni, assistenza. Se usi tutto, forse per te ne vale la pena. Se ti servono solo acquisti convalidati e abbonamenti aggiornati, stai cedendo una quota di tutto quello che guadagnerai per un lavoro che gira su pochi dollari di server al mese.",
  },
  method: {
    title: "Come facciamo la stima",
    /** HTML. Each item starts with a bold label. */
    fee: "<b>La tua quota:</b> il prezzo di listino del piano Pro di RevenueCat, l'1% dei ricavi mensili tracciati a partire da {threshold}. Gli account grandi possono negoziare prezzi diversi.",
    /** HTML. {calculator} becomes a link labelled with `calculatorLink`. */
    servers:
      "<b>Server:</b> quanto costa openpurr Lite su Cloudflare per un'app con quei ricavi, con lo stesso modello del nostro {calculator}. I costi di hosting di RevenueCat non sono pubblici; questo è quanto costa il lavoro quando lo gestisci tu.",
    calculatorLink: "calcolatore del risparmio",
    /** HTML. {used}, {low}, {high} are headcounts; {loaded} is "1.3". */
    teams:
      "<b>Team:</b> funzioni, non persone. Ipotizziamo {used} persone (le stime pubbliche vanno da {low} a {high}) e le distribuiamo noi tra le funzioni. Gli stipendi vengono dagli annunci di lavoro pubblici di RevenueCat, che indicano la retribuzione; il costo di ogni team è persone × stipendio × {loaded} per tasse, benefit e attrezzatura, senza equity. La parte della tua quota che non va ai server è divisa in proporzione a questi costi.",
    split:
      "<b>Perché vendite e crescita superano l'engineering:</b> il {date}, la pagina delle offerte di lavoro di RevenueCat elencava {open} posizioni aperte: {gtm} in vendite, marketing e crescita, e {eng} nell'engineering core. Un'azienda in questa fase sta costruendo il go-to-market, e il nuovo annuncio per Head of Sales è il più pagato della pagina.",
    /** HTML. {funding} "$100 million", {pct} like "55%", {revenue} "$30 million". */
    investors:
      "<b>Investitori:</b> cinque round dal 2018 al 2025, circa {funding} in tutto. Le quote non sono pubbliche, quindi le ricaviamo combinando le valutazioni riportate: gli investitori di ogni round ottengono l'importo diviso per la valutazione post-money, e tutti quelli precedenti vengono diluiti della stessa quota. Ne risulta circa il {pct}. Non contiamo i pool di opzioni né la quota dell'acceleratore Y Combinator. La loro quota riguarda il valore dell'azienda, non una voce di costo, per questo la mostriamo a parte. Al round del 2025, secondo la stampa, l'azienda aveva circa {revenue} di ricavi annuali, vicino al pareggio.",
    colRound: "Round",
    colRaised: "Raccolti",
    colValuation: "Valutazione",
    colLead: "Guidato da",
    notReported: "non comunicato",
    /** HTML. */
    affiliation: "<b>Nessuna affiliazione:</b> openpurr non è affiliato a RevenueCat. Queste sono stime nostre, non cifre di RevenueCat.",
    assumptions: "Le ipotesi, team per team",
    colTeam: "Team",
    colPeople: "Persone",
    colSalary: "Stipendio",
    colCost: "Costo annuo",
    colBasis: "Stipendio da",
  },
  sources: {
    title: "Fonti",
    /** One label per source, in this order. The links themselves are in English. */
    items: [
      "Prezzi di RevenueCat: l'1% dei ricavi mensili tracciati da 2.500 $",
      "La pagina delle posizioni aperte di RevenueCat, con le fasce di stipendio (Ashby)",
      "Annunci precedenti di RevenueCat con stipendio (Greenhouse)",
      "TechCrunch: RevenueCat raccoglie 50 mln $ e arriva a 100 mln $ in totale (maggio 2025)",
      "TechCrunch: la Serie B da 40 mln $, guidata dal Continuity Fund di Y Combinator, con una valutazione di 300 mln $ (2021)",
      "TechCrunch: una Serie C da 12 mln $ guidata da Adjacent (2024)",
      "SaaStr: il seed del 2018 con una valutazione di 7 mln $, e i round successivi",
      "Multiples.vc: circa 30 mln $ di ricavi e una valutazione di 500 mln $ al round del 2025 (stime)",
      "Stime sull'organico: TipRanks (185)",
      "Stime sull'organico: TrueUp (130)",
    ],
    /** HTML. {date} is the date; {issue} becomes a link labelled with `issueLink`. */
    checked: "Verificato il {date}. Hai trovato qualcosa di non aggiornato? {issue}.",
    issueLink: "Apri una issue",
  },
};
