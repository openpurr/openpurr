// The "RevenueCat's CEO on X" page in this language (see en.ts for the notes).
import type { CeoDict } from "./en";

export const ceoNl: CeoDict = {
  meta: {
    title: "RevenueCat-CEO Jacob Eiting post {perDay} keer per dag op X",
    description:
      "RevenueCat-CEO Jacob Eiting postte in 90 dagen {posts} keer op X, verspreid over {hours} verschillende uren per dag. Zo'n {pct} noemt RevenueCat. Je 1% betaalt daaraan mee.",
    ogImageAlt: "De CEO van RevenueCat post zo'n 10 keer per dag op X, elke dag. Je 1% betaalt daaraan mee.",
  },
  hero: {
    crumb: "CEO op X",
    eyebrow: "Waar je 1% naartoe gaat",
    headline: "De CEO van RevenueCat, Jacob Eiting, post {perDay} keer per dag op X.",
    headlineAccent: "Je 1% betaalt daaraan mee.",
    lede: "In de afgelopen {days} dagen postte de CEO van RevenueCat, Jacob Eiting ({handle}), {posts} keer op X. Dat is ongeveer {perDay} posts per dag, verspreid over {hours} verschillende uren per dag, op {active} van de {days} dagen.",
    updated: "Bijgewerkt op {date} - Geteld uit openbare posts",
  },
  stats: {
    posts: "posts in {days} dagen",
    perDay: "posts per dag",
    hours: "actieve uren per dag",
    active: "dagen met een post, van {days}",
  },
  calendar: {
    title: "{days} dagen posten",
    note: "Elk vakje is een dag. Hoe donkerder, hoe meer uren van die dag een post hadden.",
    less: "Geen posts",
    more: "Meer uren",
    cell: "{date}: {posts} posts in {hours} uur",
  },
  topic: {
    title: "Hoeveel ervan gaat over RevenueCat?",
    text: "Volgens de regels hieronder noemt <b>{pct}</b> van zijn posts RevenueCat of het bedrijf erachter: {onTopic} van {posts}. Op de eigen posts van {base} vinden dezelfde regels {basePct}, dus ze missen er een deel. Toch gaat het meeste wat hij post over iets anders.",
    ceo: "Zijn posts",
    base: "Posts van {base}",
    about: "Over RevenueCat",
  },
  pays: {
    title: "Je 1% betaalt ook zijn sociale media",
    text: "RevenueCat neemt 1% van al je omzet zodra je boven {threshold} per maand komt. Van dat geld draait het bedrijf, ook wat het zijn CEO betaalt. Een deel van je 1% betaalt dus {perDay} posts per dag op X.",
    link: "Zie waar de rest van je 1% naartoe gaat →",
    ctaKeep: "Houd je 1% →",
    ctaGithub: "openpurr op GitHub",
  },
  faq: {
    title: "Wat mensen vragen",
    items: {
      who: {
        q: "Wie is de CEO van RevenueCat?",
        a: "Jacob Eiting is medeoprichter en CEO van RevenueCat. Hij post op X als {handle}, waar zo'n {followers} mensen hem volgen.",
      },
      often: {
        q: "Hoe vaak post de CEO van RevenueCat op X?",
        a: "In de {days} dagen tot {end} postte Jacob Eiting {posts} keer op X, reacties meegeteld maar reposts niet. Dat is ongeveer {perDay} posts per dag, verspreid over {hours} verschillende uren per dag, op {active} van de {days} dagen.",
      },
      about: {
        q: "Waarover post de CEO van RevenueCat op X?",
        a: "Vooral over andere dingen dan RevenueCat. Volgens onze trefwoordregels noemt {pct} van zijn posts RevenueCat of het bedrijf erachter, tegenover {basePct} van de eigen posts van {base}. De regels missen sommige posts, dus zie {pct} als een ondergrens.",
      },
      pays: {
        q: "Betaal je met de 1% van RevenueCat ook de CEO?",
        a: "Deels. RevenueCat neemt 1% van al je omzet zodra je boven {threshold} per maand komt, en van dat geld draait het bedrijf, ook wat het zijn leiding betaalt. RevenueCat maakt niet bekend wat het zijn bestuurders betaalt.",
      },
    },
  },
  method: {
    title: "Hoe we telden",
    posts: "<b>Posts:</b> alle openbare posts en reacties van {handle} van {start} tot {end}, opgehaald via de API van X op {checked}. Reposts tellen niet mee, en verwijderde posts zijn niet te tellen.",
    hours: "<b>Actieve uren:</b> klokuren met minstens één post. Posts om 9:05, 9:40 en 14:10 zijn samen 2 actieve uren. Het telt uren met een post, niet bestede tijd. Een dag loopt van middernacht tot middernacht, UTC.",
    rules: "<b>Over RevenueCat:</b> een post die {accounts} noemt, linkt naar {sites} of een van deze termen gebruikt: {terms}.",
    limits: "<b>Wat dit niet zegt:</b> posten kan bij het werk van een CEO horen, en deze cijfers laten niet zien wanneer hij werkt. Ze laten zien hoe vaak hij post, en waarover.",
    data: "<b>Data:</b> we bewaren alleen aantallen, geen posttekst. Het script dat ze telde staat {script}.",
    scriptLink: "in onze repository",
    affiliation: "<b>Niet gelieerd:</b> openpurr is niet gelieerd aan RevenueCat.",
  },
};
