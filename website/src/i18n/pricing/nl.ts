// The RevenueCat pricing page in this language (see en.ts for the notes).
import type { PricingDict } from "./en";

export const pricingNl: PricingDict = {
  meta: {
    title: "RevenueCat-prijzen: waar je 1% écht naartoe gaat - openpurr",
    description:
      "RevenueCat rekent 1% van je omzet. De servers achter je app kosten een schijntje. Zie waar de rest naartoe gaat: salarissen, sales en durfinvesteerders.",
    ogImageAlt: "RevenueCat neemt 1% van je omzet; de servers kosten een schijntje. Hier gaat de rest naartoe.",
  },
  hero: {
    crumb: "RevenueCat-prijzen",
    eyebrow: "Waar je 1% naartoe gaat",
    headline: "Je betaalt niet voor servers.",
    /** The headline's second, highlighted sentence. {valuation} is "$500 million". */
    headlineAccent: "Je betaalt voor een bedrijf van {valuation}.",
    /** {threshold} is "$2,500". */
    lede: "RevenueCat neemt 1% van al je bijgehouden omzet zodra je boven {threshold} per maand komt, en de rekening groeit met elke stap die je zet. De servers achter je app kosten een schijntje. De rest betaalt het bedrijf: de salarissen, het salesteam en het rendement van de investeerders.",
    updated: "Bijgewerkt op {date} - Schattingen op basis van openbare cijfers",
  },
  answer: {
    title: "RevenueCat-prijzen in één zin",
    /** HTML. {threshold} is "$2,500". */
    text: "Gratis onder {threshold} bijgehouden omzet per maand, daarna <strong>1% van alles</strong>. Wat dat per jaar kost, naast wat de servers voor dezelfde app kosten:",
    colRevenue: "Maandelijkse omzet",
    colFee: "RevenueCat, per jaar",
    colServers: "Servers, per jaar",
  },
  calc: {
    revenue: "Maandelijkse omzet van je app",
    fee: "RevenueCat neemt",
    servers: "De servers kosten eigenlijk",
    perYear: "per jaar",
    stackLabel: "Je jaarlijkse kosten, verdeeld over servers en de teams van RevenueCat",
    /** HTML. {servers} and {rest} are percentages. */
    stackNote: "Servers: {servers}. Al het andere, {rest}, gaat naar hun teams:",
    /** {people} is a number, {salary} is like "$210K". */
    teamMeta: "Ongeveer {people} mensen - gangbaar salaris {salary}",
    swag: "Ook op de rekening: oplichtende RevenueCat-skateboards voor het team. Jouw 1% betaalt dat ook.",
    swagPostAlt: "Post van een RevenueCat-medewerker op X: ‘Mijn RevenueCat-skateboard is gisteren aangekomen! Hier is een link om je eigen gratis RevenueCat-skateboard te claimen’, met een link naar de vacaturepagina van RevenueCat",
    swagPhotoAlt: "Een oplichtend RevenueCat-skateboard",
    swagCaption: "Gepost op X, {date}. De link om ‘je eigen’ te claimen gaat naar hun vacaturepagina. {link}",
    swagLink: "Bekijk de post",
    ceoLink: "Je 1% betaalt ook de sociale media van de CEO: zo'n {perDay} posts per dag op X, elke dag.",
    ceoLinkLabel: "Bekijk de cijfers →",
    ownersTitle: "Je 1% bouwt aan de exit van een ander",
    /** {pct} is like "55%". */
    ownersInvestors: "Durfinvesteerders - ongeveer {pct}",
    ownersRest: "Oprichters en medewerkers",
    ownersBarLabel: "Durfinvesteerders bezitten ongeveer {pct} van RevenueCat, volgens onze schatting",
    /** HTML. {funding} is "$100 million"; {vc} is an amount that moves with the slider. */
    ownersText:
      "Durfinvesteerders hebben in vijf rondes ongeveer {funding} in RevenueCat gestoken, en volgens de gerapporteerde waarderingen bezitten ze er meer dan de helft van. Ze hoeven geen deel van elke betaling. Elke vergoeding die je betaalt, maakt het bedrijf dat van hen is meer waard, en bij de verkoop cashen zij. In eigendom uitgedrukt gaat ongeveer {vc} van wat je elk jaar betaalt naar hun rendement.",
    investorsLabel: "De investeerders van RevenueCat",
    /** HTML. {days} is a number, {infra} an amount; both move with the slider. */
    punch: "Je 1% koopt ongeveer {days} ontwikkelaarsdagen per jaar bij RevenueCat. Hetzelfde werk zelf draaien kost {infra}.",
    /** HTML. {keep} is an amount that moves with the slider. */
    keep: "Houd die andere {keep} zelf.",
    ctaKeep: "Houd je 1% →",
    ctaGithub: "openpurr op GitHub",
  },
  teams: {
    eng: { name: "Engineering", basis: "Vacature voor senior SDK-engineer, $ 212.000" },
    product: { name: "Product, design en data", basis: "Vacatures voor senior productmanager, $ 230.000; senior datascientist, $ 220.000" },
    sales: { name: "Sales", basis: "Vacature voor Head of Sales, $ 363.000; senior sales engineer, $ 200.000; productexpert, $ 133.000" },
    growth: { name: "Marketing en groei", basis: "Vacature voor Head of Customer Growth, $ 259.000; CRO-designer, $ 205.000; productmarketing, $ 168.000" },
    support: { name: "Customer success en support", basis: "Vacature voor developer support engineer, $ 118.000" },
    community: { name: "Developer relations en community", basis: "De algemene mediaan van de vacatures, ongeveer $ 215.000, verlaagd voor een mix van niveaus" },
    ops: { name: "Operations, financiën en HR", basis: "Vacature voor sales- en operationsspecialist, $ 167.000; Head of People, $ 280.000" },
    exec: { name: "Directie", basis: "Voor sommigen boven de vacature voor Head of Sales ($ 363.000), voor anderen eronder" },
  },
  faq: {
    title: "Wat mensen vragen",
    /** Each answer is also the page's FAQ structured data. Amounts are filled in by the page. */
    items: {
      cost: {
        q: "Wat kost RevenueCat?",
        /** {threshold} "$2,500"; {at10k} the yearly fee at $10,000 a month, {at100k} at $100,000 a month; {m10k} "$10,000", {m100k} "$100,000". */
        a: "Het Pro-abonnement van RevenueCat is gratis onder {threshold} bijgehouden omzet per maand. Daarboven kost het 1% van alles, niet alleen van het deel boven {threshold}: {at10k} per jaar voor een app die {m10k} per maand verdient, {at100k} per jaar bij {m100k} per maand. Grote klanten kunnen over Enterprise-prijzen onderhandelen.",
      },
      pays: {
        q: "Waar betaal je de 1% van RevenueCat eigenlijk voor?",
        /** {servers} and {fee} are yearly amounts for an app making {m25k} ("$25,000") a month; {people} is a number. */
        a: "Vooral voor het bedrijf. De servers achter een gemiddelde app kosten een paar dollar per maand: {servers} per jaar voor een app die {m25k} per maand verdient, tegenover {fee} aan kosten. De rest betaalt een team van ongeveer {people} mensen, waaronder engineering, sales, marketing en directie, en bouwt waarde op voor de investeerders van het bedrijf.",
      },
      owns: {
        q: "Van wie is RevenueCat?",
        /** {funding} "$100 million"; {investors} the list of firms, already joined; {pct} like "55%". */
        a: "RevenueCat heeft in vijf rondes ongeveer {funding} opgehaald bij durfinvesteerders, onder wie {investors}. Wie de gerapporteerde waarderingen per ronde doorrekent, komt uit op een geschat belang van {pct} voor investeerders. De rest is van de oprichters en medewerkers.",
      },
      worth: {
        q: "Hoeveel is RevenueCat waard?",
        /** {valuation} "$500 million", {round} "$50 million", {revenue} "$30 million". */
        a: "RevenueCat werd volgens berichten gewaardeerd op {valuation} toen het in 2025 een Series C van {round} ophaalde, met op dat moment ongeveer {revenue} jaaromzet. Dit zijn cijfers uit de pers en van analisten, geen bekendmakingen van het bedrijf.",
      },
      alternative: {
        q: "Is er een alternatief voor RevenueCat zonder omzetaandeel?",
        a: "Ja. openpurr is een gratis, open-source, self-hosted backend die werkt met de officiële RevenueCat Purchases SDK. Je stelt de proxy-URL van de SDK in op je eigen server en houdt je aankoopcode. Voor kleine apps draait het op het gratis abonnement van Cloudflare, zonder omzetaandeel en zonder kosten per transactie.",
      },
    },
  },
  more: {
    title: "Ja, ze doen meer",
    text: "RevenueCat bouwt meer dan een aankoopbackend: paywalls, experimenten, integraties, een supportlijn. Gebruik je dat allemaal, dan is het je het misschien waard. Heb je alleen gevalideerde aankopen en actuele abonnementen nodig, dan geef je een deel van alles wat je ooit verdient weg voor werk dat draait op een paar dollar aan servers per maand.",
  },
  method: {
    title: "Hoe we dit schatten",
    /** HTML. Each item starts with a bold label. */
    fee: "<b>Je kosten:</b> de lijstprijs van het Pro-abonnement van RevenueCat, 1% van de maandelijks bijgehouden omzet vanaf {threshold}. Grote klanten kunnen over andere prijzen onderhandelen.",
    /** HTML. {calculator} becomes a link labelled with `calculatorLink`. */
    servers:
      "<b>Servers:</b> wat openpurr Lite op Cloudflare kost voor een app met die omzet, volgens hetzelfde model als onze {calculator}. De eigen hostingkosten van RevenueCat zijn niet openbaar; dit is wat het werk kost als je het zelf draait.",
    calculatorLink: "besparingscalculator",
    /** HTML. {used}, {low}, {high} are headcounts; {loaded} is "1.3". */
    teams:
      "<b>Teams:</b> functies, geen personen. We gaan uit van {used} mensen (openbare schattingen lopen van {low} tot {high}) en verdelen ze zelf over de functies. De salarissen komen uit de openbare vacatures van RevenueCat, die het salaris vermelden; de kosten van elk team zijn mensen × salaris × {loaded} voor belastingen, secundaire arbeidsvoorwaarden en apparatuur, zonder aandelen. Het deel van je kosten dat niet naar servers gaat, wordt naar verhouding van die kosten verdeeld.",
    split:
      "<b>Waarom sales en groei groter zijn dan engineering:</b> op {date} stonden er op de vacaturepagina van RevenueCat {open} openstaande functies: {gtm} in sales, marketing en groei, en {eng} in core engineering. Een bedrijf in deze fase bouwt zijn go-to-market uit, en de nieuwe vacature voor Head of Sales is de best betaalde op de pagina.",
    /** HTML. {funding} "$100 million", {pct} like "55%", {revenue} "$30 million". */
    investors:
      "<b>Investeerders:</b> vijf rondes van 2018 tot 2025, samen ongeveer {funding}. Het eigendom is niet openbaar, dus rekenen we het door vanuit de gerapporteerde waarderingen: de investeerders van elke ronde krijgen het bedrag gedeeld door de post-money-waardering, en iedereen van daarvoor verwatert met hetzelfde aandeel. Dat komt uit op ongeveer {pct}. Optiepools en het belang van accelerator Y Combinator tellen niet mee. Hun aandeel gaat over wat het bedrijf waard is, niet over een kostenpost, en staat daarom apart. Bij de ronde van 2025 had het bedrijf volgens berichten ongeveer {revenue} jaaromzet en draaide het bijna quitte.",
    colRound: "Ronde",
    colRaised: "Opgehaald",
    colValuation: "Waardering",
    colLead: "Geleid door",
    notReported: "niet gemeld",
    /** HTML. */
    affiliation: "<b>Niet gelieerd:</b> openpurr is niet gelieerd aan RevenueCat. Dit zijn onze schattingen, geen cijfers van RevenueCat.",
    assumptions: "De aannames, team voor team",
    colTeam: "Team",
    colPeople: "Mensen",
    colSalary: "Salaris",
    colCost: "Kosten per jaar",
    colBasis: "Salaris uit",
  },
  sources: {
    title: "Bronnen",
    /** One label per source, in this order. The links themselves are in English. */
    items: [
      "RevenueCat-prijzen: 1% van de maandelijks bijgehouden omzet vanaf $ 2.500",
      "Vacaturesite van RevenueCat, met salarisschalen (Ashby)",
      "Eerdere vacatures van RevenueCat met salaris (Greenhouse)",
      "TechCrunch: RevenueCat haalt $ 50 mln op, totaal nu $ 100 mln (mei 2025)",
      "TechCrunch: de Series B van $ 40 mln, geleid door het Continuity Fund van Y Combinator, bij een waardering van $ 300 mln (2021)",
      "TechCrunch: een Series C van $ 12 mln, geleid door Adjacent (2024)",
      "SaaStr: de seedronde van 2018 bij een waardering van $ 7 mln, en de rondes daarna",
      "Multiples.vc: ongeveer $ 30 mln omzet en een waardering van $ 500 mln bij de ronde van 2025 (schattingen)",
      "Schattingen van het aantal medewerkers: TipRanks (185)",
      "Schattingen van het aantal medewerkers: TrueUp (130)",
    ],
    /** HTML. {date} is the date; {issue} becomes a link labelled with `issueLink`. */
    checked: "Gecontroleerd op {date}. Zie je iets wat niet meer klopt? {issue}.",
    issueLink: "Open een issue",
  },
};
