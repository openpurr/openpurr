// The "RevenueCat's CEO on X" page in this language (see en.ts for the notes).
import type { CeoDict } from "./en";

export const ceoFr: CeoDict = {
  meta: {
    title: "Le CEO de RevenueCat, Jacob Eiting, poste {perDay} fois par jour sur X",
    description:
      "Le CEO de RevenueCat, Jacob Eiting, a posté {posts} fois sur X en 90 jours, sur {hours} heures distinctes par jour. Environ {pct} parle de RevenueCat. Votre 1 % aide à le payer.",
    ogImageAlt: "Le CEO de RevenueCat poste sur X environ 10 fois par jour, tous les jours. Votre 1 % aide à le payer.",
  },
  hero: {
    crumb: "Le CEO sur X",
    eyebrow: "Où va votre 1 %",
    headline: "Le CEO de RevenueCat, Jacob Eiting, poste sur X {perDay} fois par jour.",
    headlineAccent: "Votre 1 % aide à le payer.",
    lede: "Ces {days} derniers jours, le CEO de RevenueCat, Jacob Eiting ({handle}), a posté {posts} fois sur X. Cela fait environ {perDay} posts par jour, répartis sur {hours} heures différentes par jour, {active} jours sur {days}.",
    updated: "Mis à jour le {date} - Compté à partir des posts publics",
  },
  stats: {
    posts: "posts en {days} jours",
    perDay: "posts par jour",
    hours: "heures actives par jour",
    active: "jours avec au moins un post, sur {days}",
  },
  calendar: {
    title: "{days} jours de posts",
    note: "Chaque case est un jour. Plus elle est foncée, plus ce jour-là compte d'heures avec un post.",
    less: "Aucun post",
    more: "Plus d'heures",
    cell: "{date} : {posts} posts sur {hours} heures",
  },
  topic: {
    title: "Quelle part parle de RevenueCat ?",
    text: "Selon les règles ci-dessous, <b>{pct}</b> de ses posts mentionnent RevenueCat ou son activité : {onTopic} sur {posts}. Les mêmes règles ne trouvent que {basePct} dans les posts du compte {base} lui-même, elles en manquent donc une partie. Malgré tout, l'essentiel de ce qu'il poste parle d'autre chose.",
    ceo: "Ses posts",
    base: "Posts de {base}",
    about: "Sur RevenueCat",
  },
  pays: {
    title: "Votre 1 % paie aussi ses réseaux sociaux",
    text: "RevenueCat prend 1 % de la totalité de vos revenus dès que vous dépassez {threshold} par mois. Cet argent fait tourner l'entreprise, y compris ce qu'elle verse à son CEO. Une partie de votre 1 % paie donc {perDay} posts par jour sur X.",
    link: "Voir où va le reste de votre 1 % →",
    ctaKeep: "Gardez votre 1 % →",
    ctaGithub: "openpurr sur GitHub",
  },
  faq: {
    title: "Les questions qu'on nous pose",
    items: {
      who: {
        q: "Qui est le CEO de RevenueCat ?",
        a: "Jacob Eiting est le cofondateur et CEO de RevenueCat. Il poste sur X sous le nom {handle}, où environ {followers} personnes le suivent.",
      },
      often: {
        q: "À quelle fréquence le CEO de RevenueCat poste-t-il sur X ?",
        a: "Sur les {days} jours jusqu'au {end}, Jacob Eiting a posté {posts} fois sur X, réponses comprises mais sans les reposts. Cela fait environ {perDay} posts par jour, sur {hours} heures différentes par jour, {active} jours sur {days}.",
      },
      about: {
        q: "De quoi parle le CEO de RevenueCat sur X ?",
        a: "Surtout d'autre chose que de RevenueCat. Selon nos règles par mots-clés, {pct} de ses posts mentionnent RevenueCat ou son activité, contre {basePct} des posts du compte {base} lui-même. Les règles manquent certains posts : voyez {pct} comme un minimum.",
      },
      pays: {
        q: "Le 1 % de RevenueCat paie-t-il son CEO ?",
        a: "En partie. RevenueCat prend 1 % de la totalité de vos revenus dès que vous dépassez {threshold} par mois, et cet argent fait tourner l'entreprise, y compris ce qu'elle verse à sa direction. RevenueCat ne publie pas la rémunération de ses dirigeants.",
      },
    },
  },
  method: {
    title: "Comment nous avons compté",
    posts: "<b>Posts :</b> tous les posts et réponses publics de {handle} du {start} au {end}, lus via l'API de X le {checked}. Les reposts ne sont pas comptés, et les posts supprimés ne peuvent pas l'être.",
    hours: "<b>Heures actives :</b> heures d'horloge avec au moins un post. Des posts à 9 h 05, 9 h 40 et 14 h 10 font 2 heures actives. On compte les heures avec un post, pas le temps passé. Les jours vont de minuit à minuit, en UTC.",
    rules: "<b>Sur RevenueCat :</b> un post qui mentionne {accounts}, renvoie vers {sites} ou emploie l'un de ces termes : {terms}.",
    limits: "<b>Ce que cela ne dit pas :</b> poster peut faire partie du travail d'un CEO, et ces chiffres ne montrent pas quand il travaille. Ils montrent à quelle fréquence il poste, et sur quoi.",
    data: "<b>Données :</b> nous ne gardons que des décomptes, aucun texte de post. Le script qui les a comptés est {script}.",
    scriptLink: "dans notre dépôt",
    affiliation: "<b>Aucune affiliation :</b> openpurr n'est pas affilié à RevenueCat.",
  },
};
