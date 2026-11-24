// French copy. Follows en.ts; see the notes there. Uses "vous". French puts a non-breaking space
// (U+00A0) before : ? ! and between a number and its currency; this file uses the character itself.
import type { Dict } from "./en";

export const fr: Dict = {
  meta: {
    title: "openpurr : l'alternative open source et auto-hébergée à RevenueCat",
    description:
      "openpurr est une alternative open source et auto-hébergée à RevenueCat. Gardez le SDK Purchases que vous utilisez déjà, pointez-le vers votre propre serveur et ne reversez aucune part de vos revenus.",
    ogImageAlt: "openpurr : une alternative open source et auto-hébergée à RevenueCat, à côté de son tableau de bord d'abonnements",
  },
  header: {
    home: "Accueil openpurr",
    nav: { features: "Fonctionnalités", editions: "Éditions", roadmap: "Feuille de route", faq: "FAQ", migrate: "Migrer" },
    language: "Langue",
  },
  footer: {
    tagline: "Une infrastructure d'achats open source que vous hébergez vous-même.",
    roadmap: "Feuille de route",
    contributing: "Contribuer",
    sponsor: "Soutenir",
    contact: "Contact",
    privacy: "Confidentialité (en anglais)",
    disclaimer:
      "openpurr est un projet indépendant, sans lien avec RevenueCat, Inc. et non soutenu par cette société. App Store est une marque d'Apple Inc. Google Play est une marque de Google LLC.",
    copyright: "Copyright {year} contributeurs d'openpurr.",
    cookieSettings: "Paramètres des cookies",
  },
  consent: {
    label: "Consentement aux cookies",
    text: "Nous aimerions utiliser les cookies de Google Analytics pour compter les visites et voir quelles pages sont utiles. Rien n'est déposé sans votre accord, et vous pouvez changer d'avis à tout moment dans Paramètres des cookies.",
    privacy: "Confidentialité (en anglais)",
    decline: "Refuser",
    accept: "Accepter",
  },
  snippet: {
    tabs: "Plateforme du SDK",
    note: "Une ligne. Le même SDK, le même code d'achat.",
  },
  home: {
    hero: {
      title: 'L\'<span class="accent">alternative à RevenueCat</span> open source et <span class="nowrap">auto-hébergée</span>',
      lede: "Gardez la main sur votre infrastructure d'achats, ne partagez aucune part de vos revenus et ne dépendez d'aucun service commercial. Conservez le SDK Purchases que vous utilisez déjà : changez une URL, pas votre code d'achat.",
      star: "Mettre une étoile sur GitHub",
      how: "Comment ça marche",
      shotAlt:
        "Le tableau de bord d'openpurr Lite, avec 12 mois d'évolution du MRR, les abonnements actifs, le churn, les nouveaux clients, les nouveaux essais et les essais en cours",
    },
    why: {
      eyebrow: "Pour qui",
      title: "Pour les développeurs d'applications qui préfèrent héberger eux-mêmes",
      lede: "openpurr fonctionne avec les SDK officiels, sans modification. Pour migrer, vous commencez par changer une URL, pas par réécrire votre code d'achat.",
      reasons: [
        {
          title: "Vos données, vos serveurs",
          body: "Les achats, les entitlements et les identifiants des stores sont stockés dans une base de données que vous gérez, interrogez, sauvegardez et exportez. Aucun service externe ne s'interpose entre votre application et vos clients.",
        },
        {
          title: "Aucune part des revenus",
          body: "Aucun pourcentage sur vos revenus, aucuns frais par transaction. L'édition Lite est conçue pour tenir dans l'offre gratuite de Cloudflare : une petite application peut la faire tourner sans rien payer.",
        },
        {
          title: "Aucun fournisseur dont dépendre",
          body: "Le code est open source sous licence Apache 2.0. Lisez-le, modifiez-le et déplacez-le entre Cloudflare et votre propre cloud.",
        },
      ],
    },
    how: {
      eyebrow: "Comment ça marche",
      title: "Votre serveur prend la place du fournisseur",
      lede: "Votre application garde le SDK Purchases open source avec lequel elle est déjà livrée. Le SDK parle à openpurr. openpurr parle aux stores, tient à jour l'état des abonnements et informe votre backend de ce qui a changé.",
      flowLabel: "Parcours d'une requête",
      app: "Votre application",
      sdkLicense: "Officiel, non modifié, sous licence MIT",
      sdkPlatforms: "iOS, Android, Flutter ou React Native",
      coreWhere: "Sur Cloudflare Workers ou votre propre cloud",
      appStoreApi: "Server API et notifications",
      playApi: "Developer API et RTDN",
      backend: "Votre backend",
      backendHooks: "Webhooks signés",
      steps: [
        {
          title: "Déployer",
          body: "Faites tourner openpurr Lite sur votre propre compte Cloudflare. Une installation guidée, <code>pnpm run setup</code>, crée la base de données, déploie les deux Workers et crée votre compte propriétaire.",
        },
        {
          title: "Pointer le SDK",
          body: "Définissez l'URL de proxy avant <code>configure</code>. Utilisez un domaine personnalisé qui vous appartient pour pouvoir migrer plus tard.",
        },
        {
          title: "Connecter les stores",
          body: "Ajoutez les identifiants de vos stores et les URL de notification. La vérification de configuration, <code>openpurr doctor</code>, les contrôle et indique comment corriger ce qui manque.",
        },
      ],
    },
    features: {
      eyebrow: "Ce qu'il fait",
      title: "Le backend d'abonnements, sans les extras dont vous ne vous servez pas",
      items: [
        {
          title: "Achats et notifications des stores",
          body: "Valide les transactions StoreKit 2 et les achats Google Play, renvoie le CustomerInfo et les entitlements attendus par le SDK, et tient à jour les renouvellements, remboursements et délais de grâce à partir des notifications de l'App Store et de Google Play.",
        },
        {
          title: "Webhooks",
          body: "Envoie à votre backend des événements au format RevenueCat, signés en HMAC-SHA256 et renvoyés pendant environ 72 heures.",
        },
        {
          title: "Graphiques",
          body: "16 graphiques : revenus, MRR et ARR, évolution du MRR et des abonnements, abonnements actifs et payants, statut des abonnements, churn, essais et conversion des essais, nouveaux clients, remboursements et taux de remboursement, et achats ponctuels. Filtrez par application, store, produit et environnement, avec les revenus convertis en USD.",
        },
        {
          title: "Tests de prix",
          body: "Montrez des offres différentes aux nouveaux clients de votre application, puis comparez la conversion et les revenus par client, avec la probabilité que chaque variante batte le groupe témoin. Sans mise à jour de l'application.",
        },
        {
          title: "Authentification et audit",
          body: "Clés SDK et clés secrètes, connexion des opérateurs avec codes d'authentification facultatifs, rôles, jetons d'accès et journal d'audit.",
        },
        {
          title: "Serveur MCP et skills Claude",
          body: "Demandez à un assistant IA pourquoi un client a ou n'a pas un entitlement, retrouvez des achats ou laissez-vous guider dans la configuration d'App Store Connect et de la Play Console.",
        },
      ],
    },
    editions: {
      eyebrow: "Deux éditions",
      title: "Commencez petit, évoluez sans mettre à jour l'application",
      lede: "Les deux éditions passent la même suite de tests de conformité. Si votre application pointe vers un domaine personnalisé qui vous appartient, passer de Lite à Standard ne demande aucune nouvelle version de l'application.",
      lite: {
        badge: "Pour les apps indépendantes",
        price: "0 $",
        priceNote: "avec l'offre gratuite de Cloudflare",
        items: [
          "TypeScript sur Cloudflare Workers et D1",
          "Léger et peu coûteux à faire tourner",
          "Des alertes avant d'atteindre les limites de l'offre gratuite",
        ],
      },
      standard: {
        badge: "Pour les grands portefeuilles",
        price: "Votre facture cloud",
        priceNote: "rien de plus",
        items: ["Go et Postgres dans des conteneurs", "GCP, AWS ou DigitalOcean", "Un modèle de déploiement pour chacun"],
      },
    },
    savings: {
      eyebrow: "Coût",
      title: "Ce que vous gardez par rapport à RevenueCat",
      lede: "L'offre Pro de RevenueCat est gratuite sous 2 500 $ de revenus suivis par mois, puis facture 1 % de la totalité. Lite tourne sur l'offre gratuite de Cloudflare, puis sur Workers Paid, à partir de 5 $ par mois, quand votre app la dépasse.",
      revenue: "Revenus mensuels",
      rc: "RevenueCat",
      op: "openpurr Lite",
      saved: "Économie par an",
      perMonth: "{amount} par mois",
      free: "Offre gratuite de Cloudflare",
      paid: "Cloudflare Workers Paid",
      chartLabel: "Coût mensuel selon les revenus mensuels : celui de RevenueCat augmente avec les revenus, celui d'openpurr Lite reste proche de zéro",
      gapLegend: "Ce que vous gardez",
      tableSummary: "Comparer à d'autres niveaux de revenus",
      colRevenue: "Revenus mensuels",
      colRc: "RevenueCat, par mois",
      colOp: "openpurr Lite, par mois",
      colSaved: "Économie par an",
      methodSummary: "Comment nous l'estimons",
      pricingLink: "Où va le 1 % de RevenueCat ? →",
      method: [
        "RevenueCat : le prix catalogue de l'offre Pro, 1 % des revenus mensuels suivis à partir de 2 500 $. Les revenus suivis comptent les abonnements annuels et les achats uniques le mois de leur paiement, ils peuvent donc dépasser le MRR. Les gros comptes peuvent négocier un tarif Enterprise.",
        "openpurr Lite : les tarifs de Cloudflare pour Workers et D1. Nous supposons environ 1,50 $ de revenus mensuels et environ 10 requêtes SDK par jour par utilisateur actif quotidien. Les 100 000 requêtes par jour de l'offre gratuite couvrent alors jusqu'à environ {paidFrom} de revenus mensuels, avec de la marge. Au-delà, nous comptons Workers Paid : 5 $ par mois, plus 0,30 $ par million de requêtes au-delà de 10 millions.",
        "Non inclus : le temps que vous passez à l'exploiter. Les commissions des stores sont les mêmes dans les deux cas.",
        "Tarifs vérifiés le {date}. openpurr n'est pas affilié à RevenueCat.",
      ],
    },
    fit: {
      eyebrow: "En toute franchise",
      title: "Ce n'est peut-être pas encore pour vous",
      lede: "Si vous avez besoin d'un éditeur de paywalls, d'intégrations analytiques tierces ou d'un contrat de support, les plateformes commerciales les proposent dès aujourd'hui.",
      outTitle: "Hors périmètre pour l'instant",
      tags: [
        "Paywalls",
        "Événements publicitaires",
        "Customer Center",
        "Monnaies virtuelles",
        "Paiement web",
        "Amazon",
        "Intégrations analytiques",
      ],
    },
    roadmap: {
      eyebrow: "Feuille de route",
      title: "Où va le projet",
      lede: "L'ordre est arrêté, mais il n'y a pas de dates. Si quelque chose compte pour vous, dites-le dans une issue.",
      status: { done: "Terminé", wip: "En cours", planned: "Prévu", later: "À vous de voir" },
      phases: [
        {
          phase: "Lite",
          items: [
            "Dernière version : {version}",
            "Conçu pour l'offre gratuite de Cloudflare",
            "App Store et Google Play",
            "Webhooks, tableau de bord et administration",
            "Plusieurs applications dans un même déploiement",
            "Tests de prix",
            "Serveur MCP, CLI et skills Claude",
            "Ensuite : tests sur appareils, puis la 1.0",
          ],
        },
        {
          phase: "Standard",
          items: [
            "Go et Postgres dans des conteneurs",
            "GCP, AWS et DigitalOcean",
            "La même suite de conformité que Lite",
            "Migration depuis Lite sans mise à jour de l'application",
          ],
        },
        {
          phase: "Façonné par la communauté",
          items: ["Identité vérifiée des utilisateurs finaux", "Extras de Standard pour les grandes équipes", "Tout ce que vous demanderez dans les issues"],
        },
      ],
      more: "Lire la feuille de route complète (en anglais) →",
    },
    cta: {
      title: "Participez",
      body: "L'aide la plus utile en ce moment, ce sont vos retours : les hypothèses erronées sur les SDK ou les stores, et les cas limites réels de renouvellements, remboursements et délais de grâce.",
      star: "Mettre une étoile sur GitHub",
      issue: "Ouvrir une issue",
      coffee: "Offrez-nous un café",
    },
  },
  faq: {
    eyebrow: "FAQ",
    title: "openpurr, une alternative à RevenueCat",
    lede: "Ce qui change quand vous hébergez votre propre backend d'abonnements, et ce qui ne change pas.",
    items: [
      {
        q: "Qu'est-ce qu'openpurr ?",
        a: "openpurr est une alternative open source et auto-hébergée à RevenueCat. C'est un backend pour les achats intégrés et les abonnements qui fonctionne avec le SDK Purchases officiel de RevenueCat. Il valide les achats de l'App Store et de Google Play, suit les entitlements, reçoit les notifications des stores, envoie des webhooks à votre backend et trace vos principaux indicateurs d'abonnement, le tout sur une infrastructure que vous contrôlez.",
      },
      {
        q: "En quoi openpurr diffère-t-il de RevenueCat ?",
        a: "RevenueCat est un service commercial hébergé qui prélève une part des revenus au-delà d'un palier gratuit. openpurr est un logiciel que vous faites tourner vous-même : vos achats, vos entitlements et les identifiants de vos stores sont dans votre propre base de données, sans part des revenus ni frais par transaction. RevenueCat propose aujourd'hui davantage de fonctionnalités, comme les paywalls et les intégrations analytiques. openpurr se concentre sur l'essentiel du backend d'abonnements.",
      },
      {
        q: "Dois-je réécrire mon code d'achat pour quitter RevenueCat ?",
        a: "Non. openpurr fonctionne avec le SDK Purchases officiel, sans modification. Vous définissez l'URL de proxy du SDK sur votre serveur openpurr avant d'appeler configure, et le reste de votre code d'achat ne change pas. Utilisez un domaine personnalisé qui vous appartient pour pouvoir changer de serveur plus tard sans mise à jour de l'application.",
      },
      {
        q: "Comment transférer mes clients existants depuis RevenueCat ?",
        a: "En les important. Demandez un export de migration à RevenueCat : openpurr import récupère les achats de chaque client auprès d'Apple et de Google et les attribue aux mêmes identifiants d'utilisateur. La nouvelle version de votre application envoie aussi une fois les achats de chaque client, et les deux backends restent à jour pendant que les utilisateurs mettent à jour l'application : personne ne perd son accès.",
        link: "Comment migrer",
      },
      {
        q: "Puis-je migrer depuis Adapty ?",
        a: "Oui, avec une mise à jour de l'application. Le SDK d'Adapty ne peut pas être pointé vers un autre serveur : la mise à jour le remplace donc par le SDK Purchases, avec lequel openpurr fonctionne. Vos produits restent les mêmes dans les stores. openpurr importe vos clients App Store depuis l'export d'événements d'Adapty, la nouvelle version de votre application transfère tous les autres à son premier lancement, et les deux backends restent à jour pendant que les utilisateurs mettent à jour l'application.",
        link: "Lire le guide Adapty",
        linkTo: "adapty",
      },
      {
        q: "Quelles plateformes et quels stores openpurr prend-il en charge ?",
        a: "Le SDK Purchases pour iOS, Android, Flutter et React Native, avec les achats de l'App Store et de Google Play. Amazon et le paiement web sont hors périmètre pour l'instant.",
      },
      {
        q: "Combien coûte openpurr ?",
        a: "openpurr est gratuit et open source sous licence Apache 2.0. Vous ne payez que l'infrastructure sur laquelle il tourne. L'édition Lite est conçue pour l'offre gratuite de Cloudflare : une petite application peut la faire tourner sans rien payer. L'édition Standard tourne dans des conteneurs sur votre propre cloud : son coût est celui de votre facture cloud.",
      },
      {
        q: "Où sont stockées mes données ?",
        a: "Dans votre propre base de données. L'édition Lite utilise Cloudflare D1 dans votre compte Cloudflare. L'édition Standard utilise Postgres sur GCP, AWS ou DigitalOcean. Vous pouvez les interroger, les sauvegarder et les exporter, et aucun service externe ne s'interpose entre votre application et vos clients.",
      },
      {
        q: "openpurr envoie-t-il des webhooks comme RevenueCat ?",
        a: "Oui. openpurr envoie à votre backend des événements au format RevenueCat, signés en HMAC-SHA256 et renvoyés pendant environ 72 heures. Les gestionnaires de webhooks existants ne demandent donc que peu ou pas de modifications.",
      },
      {
        q: "Que fait RevenueCat qu'openpurr ne fait pas ?",
        a: "Les paywalls, les intégrations analytiques tierces, Customer Center, les monnaies virtuelles, le paiement web, Amazon, les événements publicitaires et un contrat de support commercial sont hors périmètre pour l'instant. Les tests de prix sont intégrés. Si vous avez besoin du reste dès aujourd'hui, une plateforme commerciale vous conviendra mieux.",
      },
      {
        q: "openpurr est-il prêt pour la production ?",
        a: "Pas encore. openpurr n'en est qu'à ses débuts : les deux éditions fonctionnent et passent la même suite de tests de conformité, mais elles n'ont pas encore été testées de bout en bout avec des achats sur de vrais appareils. Suivez la feuille de route sur GitHub et ouvrez une issue si quelque chose compte pour vous.",
      },
      {
        q: "openpurr est-il lié à RevenueCat ?",
        a: "Non. openpurr est un projet open source indépendant, sans lien avec RevenueCat, Inc. et non soutenu par cette société. Il fonctionne avec le SDK Purchases officiel de RevenueCat, distribué sous licence MIT.",
      },
    ],
  },
  structured: {
    description:
      "Une alternative open source et auto-hébergée à RevenueCat : un backend pour les achats intégrés et les abonnements de l'App Store et de Google Play, qui fonctionne avec le SDK Purchases officiel, sans modification. Il valide les achats, suit les entitlements, reçoit les notifications des stores, envoie des webhooks et trace les indicateurs d'abonnement.",
    subCategory: "Backend pour les achats intégrés et les abonnements",
    features: [
      "Fonctionne avec le SDK Purchases officiel de RevenueCat pour iOS, Android, Flutter et React Native",
      "Validation des achats StoreKit 2 et Google Play",
      "App Store Server Notifications V2 et Real-time Developer Notifications de Google Play",
      "Webhooks au format RevenueCat, signés en HMAC-SHA256",
      "16 graphiques d'abonnement, dont le MRR, le churn et la conversion des essais",
      "Tests de prix sur les offres, avec résultats par variante",
      "Serveur MCP, CLI et skills Claude",
    ],
  },
};
