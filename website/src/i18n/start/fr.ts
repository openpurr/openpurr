// The "Add in-app purchases" page in this language (see en.ts for the notes).
import type { StartDict } from "./en";

export const startFr: StartDict = {
  meta: {
    title: "Achats intégrés et abonnements gratuits pour votre app - openpurr",
    description:
      "Nouvelle app ? Ajoutez achats intégrés et abonnements avec le SDK Purchases officiel et un backend open source que vous hébergez. Aucune part des revenus, jamais.",
    ogImageAlt: "Vous lancez une app ? Lancez-la sans part des revenus. Gardez votre 1 % et investissez-le dans votre activité.",
  },
  hero: {
    crumb: "Ajouter des achats intégrés",
    eyebrow: "Pour les nouvelles apps",
    headline: "Vous lancez une nouvelle app ?",
    headlineAccent: "Lancez-la sans part des revenus.",
    lede: "La plupart des backends d'achats prennent 1 % de vos revenus dès que vous dépassez {threshold} par mois, et la facture grimpe à chaque palier franchi. Le plus simple est de l'éviter avant votre première vente. openpurr est un backend gratuit et open source pour les achats intégrés et les abonnements, que vous faites tourner vous-même, avec le même SDK officiel que les grandes plateformes.",
    ctaStart: "Commencer sur GitHub",
    ctaHow: "Comment ça marche",
    ctaAi: "Copier un prompt pour votre assistant IA",
  },
  growth: {
    title: "Votre 1 %, dès le premier jour",
    text: "Choisissez où vous voyez votre app dans trois ans. Voici ce que représenterait une part des revenus de 1 % d'ici là, avec une croissance régulière partant de zéro.",
    target: "Revenus mensuels dans trois ans",
    fee: "Part des revenus de 1 %, sur 3 ans",
    servers: "En l'hébergeant vous-même, sur 3 ans",
    after: "Et ensuite, chaque année",
    chartLabel: "La part des revenus qui s'accumule mois après mois sur trois ans",
    summary: "Cela fait <b>{fee}</b> versés avant la quatrième année, contre <b>{servers}</b> pour vos propres serveurs. Gardez-les et investissez-les plutôt dans votre activité.",
  },
  invest: {
    title: "Investissez-le dans votre activité, et en vous",
    text: "Ce qu'une année de votre 1 % achète quand vous le gardez :",
  },
  how: {
    title: "Comment ça marche",
    lede: "Quatre étapes, et le code que vous écrivez est le même que dans n'importe quel tutoriel RevenueCat.",
    steps: [
      {
        title: "Déployez openpurr",
        text: "Lancez l'installation sur votre compte Cloudflare. Pour les petites apps, Lite tient dans l'<b>offre gratuite</b>, et vous pouvez relancer l'installation sans risque si elle s'arrête en cours de route.",
      },
      {
        title: "Ajoutez votre app et vos produits",
        text: "Le tableau de bord commence par l'ajout de votre première app : son bundle ID et son nom de package, puis les produits, les entitlements et les offres.",
      },
      {
        title: "Ajoutez le SDK Purchases",
        text: "Installez le SDK Purchases officiel de RevenueCat, open source sous licence MIT, et définissez <b>une URL de proxy</b> avant de le configurer.",
      },
      {
        title: "Publiez",
        text: "Les achats sont validés auprès d'Apple et de Google, les renouvellements et remboursements arrivent par notification des stores, et votre backend reçoit des webhooks. Vous utilisez Claude Code ? Le plugin openpurr vous guide dans la configuration d'App Store Connect et de la Play Console.",
      },
    ],
    setupLabel: "Installation, sur votre machine",
  },
  ai: {
    title: "Installez-le avec votre assistant de code IA",
    text: "Ouvrez le projet de votre app dans Claude Code, Codex, Cursor, Grok ou tout autre agent de code, et collez ce prompt. Il déploie openpurr, connecte les stores et ajoute le SDK, en vous demandant avant toute étape qui nécessite votre connexion.",
    copy: "Copier le prompt",
    copied: "Copié",
    claudeTip: "Vous utilisez Claude Code ? Ajoutez d'abord le plugin openpurr, qui vous guide étape par étape :",
  },
  includes: {
    title: "Ce que vous obtenez",
    yes: [
      "Achats et abonnements sur l'App Store et Google Play",
      "Entitlements et offres",
      "Webhooks vers votre backend, signés et renvoyés en cas d'échec",
      "16 graphiques : revenus, MRR, churn, essais et plus",
      "Tests de prix",
      "Vos données dans votre propre base de données",
    ],
    notYetTitle: "Pas encore",
    notYet: "Éditeurs de paywalls, intégrations analytiques tierces, événements publicitaires, paiement web et Amazon. Si vous en avez besoin dès le premier jour, les plateformes commerciales les proposent dès aujourd'hui.",
  },
  lockin: {
    title: "Aucune dépendance, dans un sens comme dans l'autre",
    text: "Comme openpurr utilise le SDK Purchases standard, votre code d'achat fonctionne avec l'un ou l'autre backend. Si openpurr devient trop petit pour vous, ou si vous voulez ce qu'ajoutent les plateformes commerciales, changer se résume à un réglage de configuration et à un import de clients, pas à une réécriture.",
  },
  pricingLink: {
    text: "Curieux de savoir où va le 1 % quand vous le payez ?",
    link: "Voir les tarifs de RevenueCat, décortiqués →",
  },
  faq: {
    title: "Les questions qu'on nous pose",
    items: {
      backend: {
        q: "Ai-je besoin d'un backend pour les achats intégrés ?",
        a: "Pas forcément : StoreKit et Google Play Billing tournent sur l'appareil. Mais un backend garde les abonnements fiables. Il valide les achats auprès d'Apple et de Google, suit les renouvellements, résiliations et remboursements via les notifications des stores, et indique à votre app et à votre serveur qui a accès à quoi. openpurr est ce backend, et vous le faites tourner vous-même.",
      },
      cheapest: {
        q: "Quelle est la façon la moins chère d'ajouter des abonnements à une app iOS ou Android ?",
        a: "Faire tourner le backend vous-même. Pour les petites apps, openpurr Lite tient dans l'offre gratuite de Cloudflare et fonctionne avec le SDK Purchases, gratuit et open source : vous ne payez donc que les serveurs, soit environ {servers} par an pour une app qui fait {m25k} par mois dans notre modèle, sans part des revenus.",
      },
      free: {
        q: "openpurr est-il vraiment gratuit ?",
        a: "Oui. Il est open source sous licence Apache 2.0, sans part des revenus ni frais par transaction. Vous payez vos propres serveurs, et les petites apps tiennent dans l'offre gratuite de Cloudflare.",
      },
      switch: {
        q: "Puis-je passer à RevenueCat plus tard ?",
        a: "Oui. openpurr utilise le SDK Purchases officiel de RevenueCat : le code d'achat de votre app fonctionne donc avec l'un ou l'autre backend, et vos produits restent les mêmes dans les stores. Changer se résume à un réglage de configuration et au transfert de vos fiches clients.",
      },
      missing: {
        q: "Que ne fait pas encore openpurr ?",
        a: "Éditeurs de paywalls, intégrations analytiques tierces, événements publicitaires, paiement web et Amazon. Les tests de prix sont intégrés. Si vous avez besoin du reste dès le premier jour, une plateforme commerciale le propose dès aujourd'hui.",
      },
    },
  },
};
