// The RevenueCat pricing page in this language (see en.ts for the notes).
import type { PricingDict } from "./en";

export const pricingDe: PricingDict = {
  meta: {
    title: "RevenueCat-Preise: Wohin deine 1 % wirklich gehen · openpurr",
    description:
      "RevenueCat nimmt 1 % deines Umsatzes. Die Server hinter deiner App kosten fast nichts. Wofür der Rest draufgeht: Gehälter, Vertrieb und Risikokapitalgeber.",
    ogImageAlt: "RevenueCat nimmt 1 % deines Umsatzes, die Server kosten einen Rundungsfehler. Wofür der Rest bezahlt.",
  },
  hero: {
    crumb: "RevenueCat-Preise",
    eyebrow: "Wohin deine 1 % gehen",
    headline: "Du zahlst nicht für Server.",
    /** The headline's second, highlighted sentence. {valuation} is "$500 million". */
    headlineAccent: "Du zahlst für ein Unternehmen, das {valuation} wert ist.",
    /** {threshold} is "$2,500". */
    lede: "RevenueCat nimmt 1 % deines gesamten erfassten Umsatzes, sobald du {threshold} im Monat überschreitest, und die Rechnung wächst mit jedem Dollar mit. Die Server hinter deiner App kosten einen Rundungsfehler. Der Rest bezahlt das Unternehmen: seine Gehälter, sein Vertriebsteam und die Rendite seiner Investoren.",
    updated: "Aktualisiert am {date} · Schätzungen auf Basis öffentlicher Zahlen",
  },
  answer: {
    title: "RevenueCat-Preise in einem Satz",
    /** HTML. {threshold} is "$2,500". */
    text: "Kostenlos unter {threshold} erfasstem Umsatz im Monat, danach <strong>1 % vom gesamten Umsatz</strong>. Was das im Jahr ausmacht, neben dem, was die Server für dieselbe App kosten:",
    colRevenue: "Monatlicher Umsatz",
    colFee: "RevenueCat, pro Jahr",
    colServers: "Server, pro Jahr",
  },
  calc: {
    revenue: "Monatlicher Umsatz deiner App",
    fee: "RevenueCat nimmt",
    servers: "Die Server kosten tatsächlich",
    perYear: "im Jahr",
    stackLabel: "Deine Jahresgebühr, aufgeteilt in Server und die Teams von RevenueCat",
    /** HTML. {servers} and {rest} are percentages. */
    stackNote: "Server: {servers}. Alles andere, {rest}, bezahlt die Teams:",
    /** {people} is a number, {salary} is like "$210K". */
    teamMeta: "Etwa {people} Personen · typisches Gehalt {salary}",
    swag: "Ebenfalls auf der Rechnung: leuchtende RevenueCat-Skateboards fürs Team und der Rest der Mühe, cool zu wirken. Auch das bezahlt dein 1 %.",
    swagPostAlt: "Post eines RevenueCat-Mitarbeiters auf X: „Mein RevenueCat-Skateboard ist gestern angekommen! Hier ist ein Link, um dein eigenes kostenloses RevenueCat-Skateboard zu bekommen“, mit Link zur Jobbörse von RevenueCat",
    swagPhotoAlt: "Ein leuchtendes RevenueCat-Skateboard",
    swagCaption: "Gepostet auf X, {date}. Der Link zum „eigenen Skateboard“ führt zu ihrer Jobbörse. {link}",
    swagLink: "Zum Post",
    ownersTitle: "Deine 1 % finanzieren den Exit anderer Leute",
    /** {pct} is like "55%". */
    ownersInvestors: "Risikokapitalgeber · etwa {pct}",
    ownersRest: "Gründer und Mitarbeitende",
    ownersBarLabel: "Risikokapitalgebern gehören etwa {pct} von RevenueCat, nach unserer Schätzung",
    /** HTML. {funding} is "$100 million"; {vc} is an amount that moves with the slider. */
    ownersText:
      "Risikokapitalgeber haben in fünf Runden etwa {funding} in RevenueCat gesteckt, und nach den gemeldeten Bewertungen gehört ihnen mehr als die Hälfte. Einen Anteil an jeder Zahlung brauchen sie nicht. Jede Gebühr, die du zahlst, macht ihr Unternehmen mehr wert, und beim Verkauf kassieren sie. Nach Anteilen gerechnet fließen etwa {vc} von dem, was du jedes Jahr zahlst, in ihre Rendite.",
    investorsLabel: "Die Investoren von RevenueCat",
    /** HTML. {days} is a number, {infra} an amount; both move with the slider. */
    punch: "Deine 1 % kaufen bei RevenueCat etwa {days} Entwicklertage im Jahr. Denselben Job selbst zu betreiben kostet {infra}.",
    /** HTML. {keep} is an amount that moves with the slider. */
    keep: "Behalte die restlichen {keep}.",
    ctaKeep: "Behalte deine 1 % →",
    ctaGithub: "openpurr auf GitHub",
  },
  teams: {
    eng: { name: "Engineering", basis: "Stellenanzeige Senior SDK Engineer, 212.000 $" },
    product: { name: "Produkt, Design und Daten", basis: "Stellenanzeigen Senior Product Manager, 230.000 $; Senior Data Scientist, 220.000 $" },
    sales: { name: "Vertrieb", basis: "Stellenanzeige Head of Sales, 363.000 $; Senior Sales Engineer, 200.000 $; Product Expert, 133.000 $" },
    growth: { name: "Marketing und Wachstum", basis: "Stellenanzeige Head of Customer Growth, 259.000 $; CRO Designer, 205.000 $; Product Marketing, 168.000 $" },
    support: { name: "Customer Success und Support", basis: "Stellenanzeige Developer Support Engineer, 118.000 $" },
    community: { name: "Developer Relations und Community", basis: "Median aller Stellenanzeigen, etwa 215.000 $, mit Abschlag für gemischte Senioritätsstufen" },
    ops: { name: "Operations, Finanzen und Personal", basis: "Stellenanzeige Sales and Operations Specialist, 167.000 $; Head of People, 280.000 $" },
    exec: { name: "Geschäftsführung", basis: "Teils über der Stellenanzeige Head of Sales (363.000 $), teils darunter" },
  },
  faq: {
    title: "Häufige Fragen",
    /** Each answer is also the page's FAQ structured data. Amounts are filled in by the page. */
    items: {
      cost: {
        q: "Was kostet RevenueCat?",
        /** {threshold} "$2,500"; {at10k} the yearly fee at $10,000 a month, {at100k} at $100,000 a month; {m10k} "$10,000", {m100k} "$100,000". */
        a: "Der Pro-Tarif von RevenueCat ist unter {threshold} erfasstem Umsatz im Monat kostenlos. Danach kostet er 1 % des gesamten Umsatzes, nicht nur des Teils über {threshold}: {at10k} im Jahr für eine App mit {m10k} Monatsumsatz, {at100k} im Jahr bei {m100k} im Monat. Große Kunden können Enterprise-Preise verhandeln.",
      },
      pays: {
        q: "Wofür zahlst du die 1 % an RevenueCat?",
        /** {servers} and {fee} are yearly amounts for an app making {m25k} ("$25,000") a month; {people} is a number. */
        a: "Vor allem für das Unternehmen. Die Server hinter einer typischen App kosten ein paar Dollar im Monat: {servers} im Jahr für eine App mit {m25k} Monatsumsatz, gegenüber {fee} an Gebühren. Der Rest bezahlt ein Team von etwa {people} Personen, von Engineering über Vertrieb und Marketing bis zur Geschäftsführung, und steigert den Wert des Unternehmens für seine Investoren.",
      },
      owns: {
        q: "Wem gehört RevenueCat?",
        /** {funding} "$100 million"; {investors} the list of firms, already joined; {pct} like "55%". */
        a: "RevenueCat hat in fünf Runden etwa {funding} von Risikokapitalgebern eingesammelt, unter anderem von {investors}. Verrechnet man die gemeldeten Bewertungen der Runden, gehören den Investoren schätzungsweise {pct} des Unternehmens. Der Rest gehört den Gründern und Mitarbeitenden.",
      },
      worth: {
        q: "Wie viel ist RevenueCat wert?",
        /** {valuation} "$500 million", {round} "$50 million", {revenue} "$30 million". */
        a: "RevenueCat wurde laut Berichten mit {valuation} bewertet, als es 2025 seine Series C über {round} abschloss, bei damals etwa {revenue} Jahresumsatz. Das sind Zahlen aus Presse und Analysen, keine Angaben des Unternehmens.",
      },
      alternative: {
        q: "Gibt es eine Alternative zu RevenueCat ohne Umsatzbeteiligung?",
        a: "Ja. openpurr ist ein kostenloses, selbst gehostetes Open-Source-Backend, das mit dem offiziellen RevenueCat Purchases SDK funktioniert. Du richtest die Proxy-URL des SDK auf deinen eigenen Server und behältst deinen Kaufcode. Kleine Apps betreibst du damit im kostenlosen Cloudflare-Tarif, ohne Umsatzbeteiligung und ohne Gebühren pro Transaktion.",
      },
    },
  },
  more: {
    title: "Ja, sie bieten mehr",
    text: "RevenueCat baut mehr als ein Kauf-Backend: Paywalls, Experimente, Integrationen, Support. Wenn du das alles nutzt, ist es dir das vielleicht wert. Wenn du nur validierte Käufe und aktuelle Abos brauchst, gibst du einen Anteil an allem ab, was du je verdienen wirst, für einen Job, der auf Servern für ein paar Dollar im Monat läuft.",
  },
  method: {
    title: "So schätzen wir das",
    /** HTML. Each item starts with a bold label. */
    fee: "<b>Deine Gebühr:</b> der Listenpreis des Pro-Tarifs von RevenueCat, 1 % des monatlich erfassten Umsatzes ab {threshold}. Große Kunden können andere Preise verhandeln.",
    /** HTML. {calculator} becomes a link labelled with `calculatorLink`. */
    servers:
      "<b>Server:</b> was openpurr Lite auf Cloudflare für eine App mit diesem Umsatz kostet, nach demselben Modell wie unser {calculator}. Die eigenen Hosting-Kosten von RevenueCat sind nicht öffentlich; das hier kostet der Job, wenn du ihn selbst betreibst.",
    calculatorLink: "Ersparnisrechner",
    /** HTML. {used}, {low}, {high} are headcounts; {loaded} is "1.3". */
    teams:
      "<b>Teams:</b> Funktionen, keine Personen. Wir nehmen {used} Personen an (öffentliche Schätzungen reichen von {low} bis {high}) und verteilen sie selbst auf die Funktionen. Die Gehälter stammen aus den öffentlichen Stellenanzeigen von RevenueCat, die das Gehalt nennen; die Kosten eines Teams sind Personen × Gehalt × {loaded} für Steuern, Sozialleistungen und Ausstattung, ohne Aktienbeteiligung. Der Teil deiner Gebühr, der nicht auf Server entfällt, wird im Verhältnis dieser Kosten aufgeteilt.",
    split:
      "<b>Warum Vertrieb und Wachstum das Engineering überwiegen:</b> Am {date} listete die Jobbörse von RevenueCat {open} offene Stellen: {gtm} in Vertrieb, Marketing und Growth und {eng} im Kern-Engineering. Ein Unternehmen in dieser Phase baut seinen Go-to-Market aus, und die neue Stelle als Head of Sales ist die bestbezahlte Anzeige auf der Jobbörse.",
    /** HTML. {funding} "$100 million", {pct} like "55%", {revenue} "$30 million". */
    investors:
      "<b>Investoren:</b> fünf Runden von 2018 bis 2025, insgesamt etwa {funding}. Die Anteile sind nicht öffentlich, also berechnen wir sie aus den gemeldeten Bewertungen: Die Investoren jeder Runde erhalten den Betrag geteilt durch die Post-Money-Bewertung, und alle vorherigen werden um denselben Anteil verwässert. Das ergibt etwa {pct}. Optionspools und die Beteiligung des Y Combinator Accelerators sind nicht eingerechnet. Ihr Anteil bezieht sich auf den Wert des Unternehmens, nicht auf einen Kostenposten, deshalb zeigen wir ihn getrennt. Bei der Runde 2025 lag der Jahresumsatz laut Berichten bei etwa {revenue}, nahe der Gewinnschwelle.",
    colRound: "Runde",
    colRaised: "Volumen",
    colValuation: "Bewertung",
    colLead: "Lead-Investor",
    notReported: "nicht veröffentlicht",
    /** HTML. */
    affiliation: "<b>Keine Verbindung:</b> openpurr ist nicht mit RevenueCat verbunden. Das sind unsere Schätzungen, keine Zahlen von RevenueCat.",
    assumptions: "Die Annahmen, Team für Team",
    colTeam: "Team",
    colPeople: "Personen",
    colSalary: "Gehalt",
    colCost: "Kosten pro Jahr",
    colBasis: "Gehalt laut",
  },
  sources: {
    title: "Quellen",
    /** One label per source, in this order. The links themselves are in English. */
    items: [
      "RevenueCat-Preise: 1 % des monatlich erfassten Umsatzes ab 2.500 $",
      "Die Jobbörse von RevenueCat, mit Gehaltsspannen (Ashby)",
      "Frühere Stellenanzeigen von RevenueCat mit Gehalt (Greenhouse)",
      "TechCrunch: RevenueCat sammelt 50 Mio. $ ein, insgesamt 100 Mio. $ (Mai 2025)",
      "TechCrunch: die Series B über 40 Mio. $, angeführt vom Continuity Fund von Y Combinator, bei 300 Mio. $ Bewertung (2021)",
      "TechCrunch: eine Series C über 12 Mio. $, angeführt von Adjacent (2024)",
      "SaaStr: die Seed-Runde 2018 bei 7 Mio. $ Bewertung und die Runden danach",
      "Multiples.vc: etwa 30 Mio. $ Umsatz und 500 Mio. $ Bewertung bei der Runde 2025 (Schätzungen)",
      "Schätzungen der Mitarbeiterzahl: TipRanks (185)",
      "Schätzungen der Mitarbeiterzahl: TrueUp (130)",
    ],
    /** HTML. {date} is the date; {issue} becomes a link labelled with `issueLink`. */
    checked: "Geprüft am {date}. Etwas ist veraltet? {issue}.",
    issueLink: "Issue eröffnen",
  },
};
