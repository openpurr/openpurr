// French copy of the migration page. Follows en.ts; see the notes there.
import type { MigrateDict } from "./en";

export const migrateFr: MigrateDict = {
  meta: {
    title: "Migrer de RevenueCat vers openpurr, étape par étape",
    description:
      "Migrez votre application de RevenueCat vers openpurr, l'alternative open source à RevenueCat : gardez le SDK Purchases et importez chacun de vos abonnés.",
    ogImageAlt:
      "Passer de RevenueCat à openpurr sans perdre un seul abonné : gardez le SDK Purchases, importez tous vos clients, et les anciennes versions de l'application continuent de fonctionner.",
  },
  hero: {
    crumb: "Migrer depuis RevenueCat",
    eyebrow: "Guide de migration",
    headline: "Passer de RevenueCat à openpurr sans perdre un seul abonné",
    lede: "Gardez le SDK Purchases que votre application utilise déjà. Importez vos clients existants à partir de l'export de RevenueCat : openpurr récupère lui-même chaque achat auprès d'Apple et de Google. Les anciennes versions de l'application continuent de fonctionner pendant que les utilisateurs mettent à jour.",
    guide: "Lire le guide détaillé (en anglais)",
    steps: "Voir les étapes",
    updated: "Mis à jour le {date}",
  },
  summary: {
    title: "En bref",
    items: [
      "openpurr est une alternative open source et auto-hébergée à RevenueCat. Il fonctionne avec le SDK Purchases officiel de RevenueCat, sans modification.",
      "Votre application ajoute une ligne (l'URL de proxy du SDK) et un appel unique à <code>syncPurchases</code>. Le reste de votre code d'achat ne change pas.",
      "<code>openpurr import</code> transfère les clients existants à partir de l'export de RevenueCat. Les achats eux-mêmes sont récupérés auprès d'Apple et de Google, pas copiés.",
      "Les applications App Store peuvent utiliser le Scheduled Data Export de RevenueCat. Google Play demande un export de migration fourni par le support de RevenueCat, le seul qui contient les jetons d'achat.",
      "Les deux backends restent à jour jusqu'à ce que la plupart des utilisateurs aient mis à jour l'application : personne ne perd son accès.",
      "Avec l'offre gratuite de Cloudflare, l'import traite environ 2 500 clients par jour. Avec Workers Paid, un import important prend quelques heures.",
    ],
  },
  how: {
    eyebrow: "Comment ça marche",
    title: "Comment se déroule une migration depuis RevenueCat",
    lede: "openpurr ne copie pas les enregistrements d'achat de RevenueCat. Il lui suffit de savoir qui possède quel achat, puis il interroge les stores, exactement comme lorsque votre application lui envoie un achat.",
    ways: [
      {
        title: "L'import",
        body: "L'export de RevenueCat indique quel utilisateur de l'application possède quel achat sur les stores. <code>openpurr import</code> interroge Apple et Google pour chaque achat et enregistre la réponse du store pour cet utilisateur. Tout le monde est transféré d'un coup, y compris les personnes qui ne rouvriront jamais l'application.",
      },
      {
        title: "La mise à jour de l'application",
        body: "La nouvelle version fait pointer le SDK Purchases vers openpurr et envoie une fois les achats de chaque client avec <code>syncPurchases</code>. Cela rattrape les clients absents de l'export, ainsi que ceux qui ont acheté après sa création.",
      },
      {
        title: "Les deux backends, pendant un temps",
        body: "Les anciennes versions de l'application continuent de parler à RevenueCat jusqu'à leur mise à jour. RevenueCat transmet les notifications d'Apple à openpurr, et un second abonnement Pub/Sub fait de même pour Google : les deux restent à jour.",
      },
    ],
  },
  app: {
    eyebrow: "Dans votre application",
    title: "Ce qui change dans votre application",
    lede: "Définissez l'URL de proxy avant configure, et envoyez une fois les achats de chaque client. Ces deux mêmes changements fonctionnent sur Android, Flutter et React Native ; le guide donne le code pour chacun.",
    codeLabel: "Exemple Swift : l'URL de proxy et une synchronisation unique",
    proxyComment: "Avant configure() : la seule ligne ajoutée par la plupart des apps",
    syncComment: "Une fois par installation : envoie les achats du client à openpurr",
  },
  import: {
    eyebrow: "L'import",
    title: "Importer les clients depuis RevenueCat",
    lede: "La CLI openpurr lit les colonnes de RevenueCat telles quelles : identifiants d'utilisateur de l'application, identifiants de transaction App Store, jetons d'achat Google Play et attributs comme <code>$email</code>.",
    codeLabel: "Terminal : importer l'export de RevenueCat",
    dryRunComment: "Vérifier les premières lignes : interroge Apple et Google, n'écrit rien",
    importComment: "Tout importer. Arrêtez quand vous voulez ; relancez pour reprendre.",
    safeguards: [
      ["Personne ne perd son accès", "Un achat que l'application a déjà envoyé pour un client reste le sien ; l'import ne le déplace jamais."],
      ["Pas de webhooks en double", "Les achats importés ne sont pas nouveaux : openpurr n'envoie donc aucun événement pour eux."],
      ["Des graphiques fidèles", "Les clients importés sont datés de leur premier achat, et non comptés comme nouveaux le jour de l'import."],
      ["Votre application continue de fonctionner", "Avec l'offre gratuite de Cloudflare, l'import s'arrête à 90 % d'une limite quotidienne et reprend le lendemain."],
      ["Arrêt et reprise", "La progression est enregistrée. Importer deux fois une ligne ne change rien : vous pouvez relancer l'import avec un export plus récent."],
      ["Essayez d'abord", "Un essai à blanc interroge les stores et indique ce qui se passerait, sans rien écrire."],
    ] as [string, string][],
  },
  steps: {
    eyebrow: "Étape par étape",
    title: "Migrer depuis RevenueCat en sept étapes",
    lede: "Les deux backends continuent de tourner jusqu'à ce que vous soyez prêt à basculer : les clients sur d'anciennes versions de l'application gardent leur accès.",
    items: [
      {
        title: "Installer openpurr",
        body: "Déployez openpurr Lite sur votre compte Cloudflare, donnez-lui accès aux API de l'App Store et de Google Play, et recréez vos produits, entitlements et offres avec les mêmes identifiants. Vous pouvez même garder vos clés SDK publiques de RevenueCat.",
      },
      {
        title: "Tenir les deux backends informés",
        body: "Définissez openpurr comme Apple Server Notification Forwarding URL dans RevenueCat, et ajoutez l'abonnement push d'openpurr à votre topic de notifications Play.",
      },
      {
        title: "Obtenir votre export",
        body: "App Store uniquement : le Scheduled Data Export de RevenueCat contient ce qu'il faut. Avec Google Play, demandez un export de migration au support de RevenueCat, car lui seul contient les jetons d'achat. Le guide fournit une demande que vous pouvez copier.",
      },
      { title: "Importer", body: "Lancez <code>openpurr import</code>, en commençant par un essai à blanc. Les problèmes sur des lignes isolées vont dans un rapport et n'arrêtent pas l'import." },
      { title: "Publier la mise à jour de l'application", body: "Ajoutez l'URL de proxy et un appel unique à <code>syncPurchases</code>. Publiez-la une fois l'import terminé." },
      {
        title: "Vérifier",
        body: "<code>openpurr doctor</code> vérifie la configuration. Recherchez des clients que vous connaissez, et comparez les abonnements actifs avec les graphiques de RevenueCat.",
      },
      {
        title: "Terminer la bascule",
        body: "Une fois que la plupart des clients ont mis à jour, faites pointer Apple et Google directement vers openpurr, activez les webhooks d'openpurr et désactivez ceux de RevenueCat.",
      },
    ],
    source: "Source :",
    sourceNotifications: "RevenueCat : notifications serveur d'Apple (en anglais)",
    sourceExports: "RevenueCat : exporter ses données ou migrer (en anglais)",
    more: "Toutes les commandes et tous les réglages sont dans le guide complet (en anglais) →",
  },
  moves: {
    eyebrow: "Ce qui est transféré",
    title: "Ce qui est transféré depuis RevenueCat, et ce qui ne l'est pas",
    rows: [
      ["Abonnements et achats, avec renouvellements, remboursements, délais de grâce et expirations", "Oui, récupérés auprès d'Apple et de Google"],
      ["Qui possède quel achat", "Oui, à partir de l'export de RevenueCat"],
      ["Identifiants d'utilisateur de l'application, y compris anonymes", "Oui, inchangés"],
      ["Attributs des clients ($email, $displayName et les vôtres)", "Oui, à partir d'un Audience export"],
      ["Produits, entitlements et offres", "Vous les recréez, avec les mêmes identifiants"],
      ["Historique des graphiques avant la bascule", "En partie : conservez les CSV des graphiques de RevenueCat pour vos archives"],
      ["Expériences", "Vous les recréez : openpurr mène des tests de prix sur vos offres"],
      ["Paywalls, intégrations, Customer Center", "Non : openpurr ne les propose pas"],
    ] as [string, string][],
  },
  faq: {
    eyebrow: "FAQ",
    title: "FAQ sur la migration depuis RevenueCat",
    items: [
      {
        q: "Dois-je modifier mon code d'achat ?",
        a: "Non. openpurr fonctionne avec le SDK Purchases officiel de RevenueCat, sans modification. La mise à jour de l'application ajoute l'URL de proxy avant configure, et un appel unique à syncPurchases. getOfferings, purchase, restorePurchases, logIn et le reste ne changent pas.",
      },
      {
        q: "Ai-je besoin de l'aide de RevenueCat pour migrer ?",
        a: "Pour les applications App Store, non : le Scheduled Data Export de RevenueCat contient les identifiants de transaction dont openpurr a besoin. Pour Google Play, oui : d'après la documentation de RevenueCat, seul un export de migration préparé par le support de RevenueCat contient les jetons d'achat exigés par Google.",
      },
      {
        q: "Qu'en est-il des clients qui ne mettent jamais l'application à jour ?",
        a: "L'import les couvre : leurs achats sont récupérés auprès d'Apple et de Google et attribués aux mêmes identifiants d'utilisateur. Tant qu'ils utilisent une ancienne version de l'application, cette version parle à RevenueCat. C'est pourquoi les deux backends restent informés jusqu'à ce que la plupart des utilisateurs aient mis à jour.",
      },
      {
        q: "Combien de temps dure un import ?",
        a: "Chaque client représente environ 30 écritures de lignes dans la base de données. Avec l'offre gratuite de Cloudflare, cela fait environ 2 500 clients par jour, et l'import se met en pause de lui-même à la limite quotidienne avant de reprendre le lendemain. Avec Workers Paid (5 $ par mois), un import important prend quelques heures.",
      },
      {
        q: "Mes données sont-elles copiées depuis RevenueCat ?",
        a: "Seule la correspondance entre les utilisateurs de l'application et les achats sur les stores est copiée, ainsi que les attributs si vous les importez. Les achats eux-mêmes viennent directement d'Apple et de Google : openpurr enregistre donc l'état actuel des stores, renouvellements et remboursements compris.",
      },
    ],
  },
  cta: {
    title: "Prêt à migrer ?",
    body: "Le guide détaille chaque étape. Si quelque chose dans votre configuration ne colle pas, ouvrez une issue : les migrations orientent ce qui sera développé ensuite.",
    guide: "Lire le guide (en anglais)",
    github: "openpurr sur GitHub",
    issue: "Ouvrir une issue",
  },
};
