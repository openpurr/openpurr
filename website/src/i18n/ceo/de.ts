// The "RevenueCat's CEO on X" page in this language (see en.ts for the notes).
import type { CeoDict } from "./en";

export const ceoDe: CeoDict = {
  meta: {
    title: "RevenueCat-CEO Jacob Eiting: {perDay} Posts am Tag auf X",
    description:
      "RevenueCat-CEO Jacob Eiting postete in 90 Tagen {posts}-mal auf X, in {hours} verschiedenen Stunden pro Tag. Etwa {pct} erwähnt RevenueCat. Deine 1 % bezahlen das mit.",
    ogImageAlt: "Der CEO von RevenueCat postet etwa 10-mal am Tag auf X, jeden Tag. Deine 1 % bezahlen das mit.",
  },
  hero: {
    crumb: "CEO auf X",
    eyebrow: "Wohin deine 1 % gehen",
    headline: "Der CEO von RevenueCat, Jacob Eiting, postet {perDay}-mal am Tag auf X.",
    headlineAccent: "Deine 1 % bezahlen das mit.",
    lede: "In den letzten {days} Tagen hat Jacob Eiting ({handle}), CEO von RevenueCat, {posts}-mal auf X gepostet. Das sind etwa {perDay} Posts am Tag, verteilt auf {hours} verschiedene Stunden pro Tag, an {active} von {days} Tagen.",
    updated: "Aktualisiert am {date} - Gezählt aus öffentlichen Posts",
  },
  stats: {
    posts: "Posts in {days} Tagen",
    perDay: "Posts pro Tag",
    hours: "aktive Stunden pro Tag",
    active: "Tage mit Post, von {days}",
  },
  calendar: {
    title: "{days} Tage auf X",
    note: "Jedes Kästchen ist ein Tag. Je dunkler es ist, desto mehr Stunden dieses Tages hatten einen Post.",
    less: "Keine Posts",
    more: "Mehr Stunden",
    cell: "{date}: {posts} Posts in {hours} Stunden",
  },
  topic: {
    title: "Wie viel davon dreht sich um RevenueCat?",
    text: "Nach den Regeln unten erwähnen <b>{pct}</b> seiner Posts RevenueCat oder dessen Geschäft: {onTopic} von {posts}. In den eigenen Posts von {base} finden dieselben Regeln {basePct}, sie übersehen also einiges. Trotzdem geht es in den meisten seiner Posts um etwas anderes.",
    ceo: "Seine Posts",
    base: "Posts von {base}",
    about: "Über RevenueCat",
  },
  pays: {
    title: "Deine 1 % bezahlen auch seine Social-Media-Zeit",
    text: "RevenueCat nimmt 1 % deines gesamten Umsatzes, sobald du {threshold} im Monat überschreitest. Von diesem Geld lebt das Unternehmen, auch das Gehalt seines CEO. Ein Teil deiner 1 % bezahlt also {perDay} Posts am Tag auf X.",
    link: "Sieh dir an, wohin der Rest deiner 1 % geht →",
    ctaKeep: "Behalte deine 1 % →",
    ctaGithub: "openpurr auf GitHub",
  },
  faq: {
    title: "Häufige Fragen",
    items: {
      who: {
        q: "Wer ist der CEO von RevenueCat?",
        a: "Jacob Eiting ist Mitgründer und CEO von RevenueCat. Auf X postet er als {handle}, wo ihm etwa {followers} Menschen folgen.",
      },
      often: {
        q: "Wie oft postet der CEO von RevenueCat auf X?",
        a: "In den {days} Tagen bis zum {end} hat Jacob Eiting {posts}-mal auf X gepostet, Antworten mitgezählt, Reposts nicht. Das sind etwa {perDay} Posts am Tag, in {hours} verschiedenen Stunden pro Tag, an {active} von {days} Tagen.",
      },
      about: {
        q: "Worüber postet der CEO von RevenueCat auf X?",
        a: "Meist über anderes als RevenueCat. Nach unseren Stichwortregeln erwähnen {pct} seiner Posts RevenueCat oder dessen Geschäft, gegenüber {basePct} der eigenen Posts von {base}. Die Regeln übersehen manche Posts, {pct} ist also eine Untergrenze.",
      },
      pays: {
        q: "Bezahlen deine 1 % an RevenueCat auch den CEO?",
        a: "Zum Teil. RevenueCat nimmt 1 % deines gesamten Umsatzes, sobald du {threshold} im Monat überschreitest, und von diesem Geld lebt das Unternehmen, auch das, was es seiner Führung zahlt. Was RevenueCat seinen Führungskräften zahlt, veröffentlicht es nicht.",
      },
    },
  },
  method: {
    title: "So haben wir gezählt",
    posts: "<b>Posts:</b> alle öffentlichen Posts und Antworten von {handle} vom {start} bis {end}, abgerufen über die API von X am {checked}. Reposts zählen nicht, gelöschte Posts lassen sich nicht zählen.",
    hours: "<b>Aktive Stunden:</b> Stunden auf der Uhr (9 bis 10 Uhr, 10 bis 11 Uhr …) mit mindestens einem Post. Posts um 9:05, 9:40 und 14:10 ergeben 2 aktive Stunden. Gezählt werden Stunden mit einem Post, nicht die aufgewendete Zeit. Ein Tag läuft von Mitternacht bis Mitternacht, UTC.",
    rules: "<b>Über RevenueCat:</b> ein Post, der {accounts} erwähnt, auf {sites} verlinkt oder einen dieser Begriffe verwendet: {terms}.",
    limits: "<b>Was das nicht aussagt:</b> Posten kann zum Job eines CEOs gehören, und diese Zahlen zeigen nicht, wann er arbeitet. Sie zeigen, wie oft er postet und worüber.",
    data: "<b>Daten:</b> Wir speichern nur Zahlen, keine Post-Texte. Das Skript, das sie gezählt hat, liegt {script}.",
    scriptLink: "in unserem Repository",
    affiliation: "<b>Keine Verbindung:</b> openpurr ist nicht mit RevenueCat verbunden.",
  },
};
