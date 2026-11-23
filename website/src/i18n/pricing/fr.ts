// The RevenueCat pricing page in this language (see en.ts for the notes).
import type { PricingDict } from "./en";

export const pricingFr: PricingDict = {
  meta: {
    title: "Tarifs RevenueCat : où va vraiment votre 1 % · openpurr",
    description:
      "RevenueCat prend 1 % de vos revenus. Vos serveurs coûtent une erreur d'arrondi. Le reste paie des salaires, des commerciaux et des investisseurs.",
    ogImageAlt: "RevenueCat prend 1 % de vos revenus ; les serveurs coûtent une erreur d'arrondi. Ce que paie le reste.",
  },
  hero: {
    crumb: "Tarifs RevenueCat",
    eyebrow: "Où va votre 1 %",
    headline: "Vous ne payez pas des serveurs.",
    /** The headline's second, highlighted sentence. {valuation} is "$500 million". */
    headlineAccent: "Vous payez une entreprise valorisée à {valuation}.",
    /** {threshold} is "$2,500". */
    lede: "RevenueCat prend 1 % de la totalité de vos revenus suivis dès que vous dépassez {threshold} par mois, et la facture grimpe à chaque palier franchi. Les serveurs derrière votre app coûtent une erreur d'arrondi. Le reste paie l'entreprise : ses salaires, son équipe commerciale et le retour de ses investisseurs.",
    updated: "Mis à jour le {date} · Estimations d'après des chiffres publics",
  },
  answer: {
    title: "Les tarifs de RevenueCat en une ligne",
    /** HTML. {threshold} is "$2,500". */
    text: "Gratuit sous {threshold} de revenus suivis par mois, puis <strong>1 % de la totalité</strong>. Ce que ça représente sur un an, à côté de ce que coûtent les serveurs pour la même app :",
    colRevenue: "Revenus mensuels",
    colFee: "RevenueCat, par an",
    colServers: "Serveurs, par an",
  },
  calc: {
    revenue: "Les revenus mensuels de votre app",
    fee: "RevenueCat prend",
    servers: "Les serveurs coûtent en réalité",
    perYear: "par an",
    stackLabel: "Vos frais annuels, répartis entre les serveurs et les équipes de RevenueCat",
    /** HTML. {servers} and {rest} are percentages. */
    stackNote: "Serveurs : {servers}. Tout le reste, {rest}, paie leurs équipes :",
    /** {people} is a number, {salary} is like "$210K". */
    teamMeta: "Environ {people} personnes · salaire type {salary}",
    ownersTitle: "Votre 1 % finance la sortie de quelqu'un d'autre",
    /** {pct} is like "55%". */
    ownersInvestors: "Investisseurs en capital-risque · environ {pct}",
    ownersRest: "Fondateurs et salariés",
    ownersBarLabel: "Les investisseurs en capital-risque détiennent environ {pct} de RevenueCat, selon notre estimation",
    /** HTML. {funding} is "$100 million"; {vc} is an amount that moves with the slider. */
    ownersText:
      "Les investisseurs en capital-risque ont mis environ {funding} dans RevenueCat en cinq tours, et d'après les valorisations rapportées, ils en détiennent plus de la moitié. Ils n'ont pas besoin d'une part de chaque paiement. Chaque centime que vous payez fait grimper la valeur de l'entreprise qu'ils possèdent, et ils encaissent à la revente. Au prorata du capital, environ {vc} de ce que vous payez chaque année construit leur plus-value.",
    investorsLabel: "Les investisseurs de RevenueCat",
    /** HTML. {days} is a number, {infra} an amount; both move with the slider. */
    punch: "Votre 1 % paie environ {days} jours d'ingénieur par an chez RevenueCat. Faire tourner le même service vous-même coûte {infra}.",
    /** HTML. {keep} is an amount that moves with the slider. */
    keep: "Gardez les {keep} restants.",
    ctaKeep: "Gardez votre 1 % →",
    ctaGithub: "openpurr sur GitHub",
  },
  teams: {
    eng: { name: "Ingénierie", basis: "Offre de Senior SDK Engineer, 212 000 $" },
    product: { name: "Produit, design et data", basis: "Offres de Senior Product Manager, 230 000 $ ; Senior Data Scientist, 220 000 $" },
    sales: { name: "Ventes", basis: "Offre de Head of Sales, 363 000 $ ; Senior Sales Engineer, 200 000 $ ; Product Expert, 133 000 $" },
    growth: { name: "Marketing et croissance", basis: "Offre de Head of Customer Growth, 259 000 $ ; CRO Designer, 205 000 $ ; Product Marketing, 168 000 $" },
    support: { name: "Customer success et support", basis: "Offre de Developer Support Engineer, 118 000 $" },
    community: { name: "Relations développeurs et communauté", basis: "Médiane globale des offres, environ 215 000 $, minorée pour refléter des niveaux variés" },
    ops: { name: "Opérations, finance et RH", basis: "Offre de Sales and Operations Specialist, 167 000 $ ; Head of People, 280 000 $" },
    exec: { name: "Direction", basis: "Au-dessus de l'offre de Head of Sales (363 000 $) pour certains, en dessous pour d'autres" },
  },
  faq: {
    title: "Les questions qu'on nous pose",
    /** Each answer is also the page's FAQ structured data. Amounts are filled in by the page. */
    items: {
      cost: {
        q: "Combien coûte RevenueCat ?",
        /** {threshold} "$2,500"; {at10k} the yearly fee at $10,000 a month, {at100k} at $100,000 a month; {m10k} "$10,000", {m100k} "$100,000". */
        a: "L'offre Pro de RevenueCat est gratuite sous {threshold} de revenus suivis par mois. Au-delà, elle coûte 1 % de la totalité, pas seulement de la part au-dessus de {threshold} : {at10k} par an pour une app qui fait {m10k} par mois, {at100k} par an à {m100k} par mois. Les gros comptes peuvent négocier un tarif Enterprise.",
      },
      pays: {
        q: "Que paie le 1 % de RevenueCat ?",
        /** {servers} and {fee} are yearly amounts for an app making {m25k} ("$25,000") a month; {people} is a number. */
        a: "Surtout l'entreprise. Les serveurs derrière une app typique coûtent quelques dollars par mois : {servers} par an pour une app qui fait {m25k} par mois, contre {fee} de frais. Le reste paie une équipe d'environ {people} personnes, ingénierie, ventes, marketing et direction compris, et crée de la valeur pour les investisseurs de l'entreprise.",
      },
      owns: {
        q: "À qui appartient RevenueCat ?",
        /** {funding} "$100 million"; {investors} the list of firms, already joined; {pct} like "55%". */
        a: "RevenueCat a levé environ {funding} auprès d'investisseurs en capital-risque en cinq tours, dont {investors}. En cumulant les valorisations rapportées à chaque tour, les investisseurs détiendraient environ {pct} de l'entreprise. Le reste appartient à ses fondateurs et à ses salariés.",
      },
      worth: {
        q: "Combien vaut RevenueCat ?",
        /** {valuation} "$500 million", {round} "$50 million", {revenue} "$30 million". */
        a: "RevenueCat aurait été valorisée à {valuation} lors de sa série C de {round} en 2025, avec environ {revenue} de revenus annuels à l'époque. Ce sont des chiffres de la presse et d'analystes, pas des données publiées par l'entreprise.",
      },
      alternative: {
        q: "Existe-t-il une alternative à RevenueCat sans part des revenus ?",
        a: "Oui. openpurr est un backend gratuit, open source et auto-hébergé qui fonctionne avec le SDK Purchases officiel de RevenueCat. Vous pointez l'URL de proxy du SDK vers votre propre serveur et gardez votre code d'achat. Pour les petites apps, il tourne sur l'offre gratuite de Cloudflare, sans part des revenus ni frais par transaction.",
      },
    },
  },
  more: {
    title: "Oui, ils en font plus",
    text: "RevenueCat fait plus qu'un backend d'achats : paywalls, expérimentations, intégrations, support. Si vous utilisez tout ça, ça vaut peut-être le coup pour vous. Si vous avez juste besoin d'achats validés et d'abonnements à jour, vous cédez une part de tout ce que vous gagnerez jamais pour un travail qui tourne sur quelques dollars de serveurs par mois.",
  },
  method: {
    title: "Comment nous l'estimons",
    /** HTML. Each item starts with a bold label. */
    fee: "<b>Vos frais :</b> le prix catalogue de l'offre Pro de RevenueCat, 1 % des revenus mensuels suivis à partir de {threshold}. Les gros comptes peuvent négocier d'autres tarifs.",
    /** HTML. {calculator} becomes a link labelled with `calculatorLink`. */
    servers:
      "<b>Serveurs :</b> ce que coûte openpurr Lite sur Cloudflare pour une app avec ces revenus, selon le même modèle que notre {calculator}. Les coûts d'hébergement de RevenueCat ne sont pas publics ; c'est ce que coûte le travail quand vous le faites tourner vous-même.",
    calculatorLink: "calculateur d'économies",
    /** HTML. {used}, {low}, {high} are headcounts; {loaded} is "1.3". */
    teams:
      "<b>Équipes :</b> des fonctions, pas des personnes. Nous supposons {used} personnes (les estimations publiques vont de {low} à {high}) et les répartissons nous-mêmes entre les fonctions. Les salaires viennent des offres d'emploi publiques de RevenueCat, qui affichent la rémunération ; le coût de chaque équipe est personnes × salaire × {loaded} pour les charges, les avantages et l'équipement, hors actions. La part de vos frais qui ne va pas aux serveurs est répartie au prorata de ces coûts.",
    split:
      "<b>Pourquoi les ventes et la croissance dépassent l'ingénierie :</b> le {date}, la page carrières de RevenueCat affichait {open} postes ouverts : {gtm} dans les ventes, le marketing et la croissance, et {eng} dans l'ingénierie cœur de produit. Une entreprise à ce stade développe sa force commerciale (go-to-market), et son nouveau poste de Head of Sales est l'offre la mieux payée de la page.",
    /** HTML. {funding} "$100 million", {pct} like "55%", {revenue} "$30 million". */
    investors:
      "<b>Investisseurs :</b> cinq tours de 2018 à 2025, environ {funding} au total. La répartition du capital n'est pas publique, nous la calculons donc à partir des valorisations rapportées : les investisseurs de chaque tour reçoivent le montant divisé par la valorisation post-money, et tous ceux d'avant sont dilués d'autant. On obtient environ {pct}. Les pools d'options et la participation de l'accélérateur Y Combinator ne sont pas comptés. Leur part porte sur la valeur de l'entreprise, pas sur une ligne de ses coûts, c'est pourquoi elle est présentée à part. Lors du tour de 2025, l'entreprise aurait réalisé environ {revenue} de revenus annuels, proche de l'équilibre.",
    colRound: "Tour",
    colRaised: "Levée",
    colValuation: "Valorisation",
    colLead: "Mené par",
    notReported: "non communiqué",
    /** HTML. */
    affiliation: "<b>Aucune affiliation :</b> openpurr n'est pas affilié à RevenueCat. Ce sont nos estimations, pas les chiffres de RevenueCat.",
    assumptions: "Les hypothèses, équipe par équipe",
    colTeam: "Équipe",
    colPeople: "Personnes",
    colSalary: "Salaire",
    colCost: "Coût annuel",
    colBasis: "Salaire d'après",
  },
  sources: {
    title: "Sources",
    /** One label per source, in this order. The links themselves are in English. */
    items: [
      "Tarifs RevenueCat : 1 % des revenus mensuels suivis à partir de 2 500 $",
      "Le site carrières de RevenueCat, avec les fourchettes de salaire (Ashby)",
      "Anciennes offres de RevenueCat avec salaire (Greenhouse)",
      "TechCrunch : RevenueCat lève 50 M$, pour un total de 100 M$ (mai 2025)",
      "TechCrunch : la série B de 40 M$, menée par le Continuity Fund de Y Combinator, pour une valorisation de 300 M$ (2021)",
      "TechCrunch : une série C de 12 M$ menée par Adjacent (2024)",
      "SaaStr : le tour d'amorçage de 2018 à une valorisation de 7 M$, et les tours suivants",
      "Multiples.vc : environ 30 M$ de revenus et une valorisation de 500 M$ lors du tour de 2025 (estimations)",
      "Estimations d'effectifs : TipRanks (185)",
      "Estimations d'effectifs : TrueUp (130)",
    ],
    /** HTML. {date} is the date; {issue} becomes a link labelled with `issueLink`. */
    checked: "Vérifié le {date}. Une info périmée ? {issue}.",
    issueLink: "Ouvrez une issue",
  },
};
