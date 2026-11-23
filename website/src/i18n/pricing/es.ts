// The RevenueCat pricing page in this language (see en.ts for the notes).
import type { PricingDict } from "./en";

export const pricingEs: PricingDict = {
  meta: {
    title: "Precios de RevenueCat: adónde va de verdad tu 1 % · openpurr",
    description:
      "RevenueCat se lleva el 1 % de tus ingresos. Los servidores de tu app cuestan una miseria. Mira qué paga el resto: nóminas, ventas e inversores.",
    ogImageAlt: "RevenueCat se lleva el 1 % de tus ingresos; los servidores cuestan una miseria. Qué paga el resto.",
  },
  hero: {
    crumb: "Precios de RevenueCat",
    headline: "No estás pagando servidores.",
    /** The headline's second, highlighted sentence. {valuation} is "$500 million". */
    headlineAccent: "Estás pagando una empresa valorada en {valuation}.",
    /** {threshold} is "$2,500". */
    lede: "RevenueCat se lleva el 1 % de todos tus ingresos registrados en cuanto pasas de {threshold} al mes, y la factura crece cada vez que creces tú. Los servidores de tu app cuestan una miseria. El resto paga la empresa: sus nóminas, su equipo de ventas y el retorno de sus inversores.",
    updated: "Actualizado el {date} · Estimaciones a partir de datos públicos",
  },
  answer: {
    title: "Los precios de RevenueCat en una línea",
    /** HTML. {threshold} is "$2,500". */
    text: "Gratis por debajo de {threshold} de ingresos registrados al mes; después, <strong>el 1 % de todos ellos</strong>. Lo que eso supone en un año, junto a lo que cuestan los servidores de la misma app:",
    colRevenue: "Ingresos mensuales",
    colFee: "RevenueCat, al año",
    colServers: "Servidores, al año",
  },
  calc: {
    revenue: "Ingresos mensuales de tu app",
    fee: "RevenueCat se lleva",
    servers: "Los servidores cuestan en realidad",
    perYear: "al año",
    stackLabel: "Tu cuota anual, dividida entre los servidores y los equipos de RevenueCat",
    /** HTML. {servers} and {rest} are percentages. */
    stackNote: "Servidores: {servers}. Todo lo demás, {rest}, paga sus equipos:",
    /** {people} is a number, {salary} is like "$210K". */
    teamMeta: "Unas {people} personas · salario típico {salary}",
    ownersTitle: "Tu 1 % financia la salida de otros",
    /** {pct} is like "55%". */
    ownersInvestors: "Inversores de capital riesgo · aprox. {pct}",
    ownersRest: "Fundadores y empleados",
    ownersBarLabel: "Los inversores de capital riesgo poseen aprox. el {pct} de RevenueCat, según nuestra estimación",
    /** HTML. {funding} is "$100 million"; {vc} is an amount that moves with the slider. */
    ownersText:
      "Los inversores de capital riesgo han metido unos {funding} en RevenueCat en cinco rondas y, según las valoraciones publicadas, poseen más de la mitad. No necesitan una parte de cada pago. Cada cuota que pagas hace que la empresa que poseen valga más, y cobran cuando se vende. En términos de propiedad, unos {vc} de lo que pagas cada año van a su retorno.",
    investorsLabel: "Los inversores de RevenueCat",
    /** HTML. {days} is a number, {infra} an amount; both move with the slider. */
    punch: "Tu 1 % compra unos {days} días de ingeniero al año en RevenueCat. Hacer el mismo trabajo por tu cuenta cuesta {infra}.",
    /** HTML. {keep} is an amount that moves with the slider. */
    keep: "Quédate con los otros {keep}.",
    ctaKeep: "Quédate con tu 1 % →",
    ctaGithub: "openpurr en GitHub",
  },
  teams: {
    eng: { name: "Ingeniería", basis: "Oferta de Senior SDK Engineer, 212 000 $" },
    product: { name: "Producto, diseño y datos", basis: "Ofertas de Senior Product Manager, 230 000 $; Senior Data Scientist, 220 000 $" },
    sales: { name: "Ventas", basis: "Oferta de Head of Sales, 363 000 $; Senior Sales Engineer, 200 000 $; Product Expert, 133 000 $" },
    growth: { name: "Marketing y crecimiento", basis: "Oferta de Head of Customer Growth, 259 000 $; CRO Designer, 205 000 $; Product Marketing, 168 000 $" },
    support: { name: "Customer success y soporte", basis: "Oferta de Developer Support Engineer, 118 000 $" },
    community: { name: "Relaciones con desarrolladores y comunidad", basis: "La mediana general de las ofertas, unos 215 000 $, con un descuento por la mezcla de niveles" },
    ops: { name: "Operaciones, finanzas y personas", basis: "Oferta de Sales and Operations Specialist, 167 000 $; Head of People, 280 000 $" },
    exec: { name: "Directivos", basis: "Por encima de la oferta de Head of Sales (363 000 $) para algunos, por debajo para otros" },
  },
  faq: {
    title: "Lo que la gente pregunta",
    /** Each answer is also the page's FAQ structured data. Amounts are filled in by the page. */
    items: {
      cost: {
        q: "¿Cuánto cuesta RevenueCat?",
        /** {threshold} "$2,500"; {at10k} the yearly fee at $10,000 a month, {at100k} at $100,000 a month; {m10k} "$10,000", {m100k} "$100,000". */
        a: "El plan Pro de RevenueCat es gratis por debajo de {threshold} de ingresos registrados al mes. A partir de ahí cuesta el 1 % de todos ellos, no solo de la parte que supera {threshold}: {at10k} al año para una app que ingresa {m10k} al mes, {at100k} al año con {m100k} al mes. Las cuentas grandes pueden negociar precios Enterprise.",
      },
      pays: {
        q: "¿Qué paga la comisión del 1 % de RevenueCat?",
        /** {servers} and {fee} are yearly amounts for an app making {m25k} ("$25,000") a month; {people} is a number. */
        a: "Sobre todo, la empresa. Los servidores de una app típica cuestan unos pocos dólares al mes: {servers} al año para una app que ingresa {m25k} al mes, frente a {fee} en comisiones. El resto paga un equipo de unas {people} personas, con ingeniería, ventas, marketing y directivos, y genera valor para los inversores de la empresa.",
      },
      owns: {
        q: "¿De quién es RevenueCat?",
        /** {funding} "$100 million"; {investors} the list of firms, already joined; {pct} like "55%". */
        a: "RevenueCat ha levantado unos {funding} de inversores de capital riesgo en cinco rondas, entre ellos {investors}. Encadenando las valoraciones publicadas de cada ronda, los inversores poseen aproximadamente el {pct} de la empresa. El resto es de sus fundadores y empleados.",
      },
      worth: {
        q: "¿Cuánto vale RevenueCat?",
        /** {valuation} "$500 million", {round} "$50 million", {revenue} "$30 million". */
        a: "Según la prensa, RevenueCat estaba valorada en {valuation} cuando levantó su Serie C de {round} en 2025, con unos {revenue} de ingresos anuales en ese momento. Son cifras de prensa y analistas, no datos publicados por la empresa.",
      },
      alternative: {
        q: "¿Hay alguna alternativa a RevenueCat sin reparto de ingresos?",
        a: "Sí. openpurr es un backend gratuito, de código abierto y autoalojado que funciona con el SDK de Purchases oficial de RevenueCat. Apuntas la URL de proxy del SDK a tu propio servidor y mantienes tu código de compras. Para apps pequeñas funciona en el plan gratuito de Cloudflare, sin reparto de ingresos ni comisiones por transacción.",
      },
    },
  },
  more: {
    title: "Sí, hacen más cosas",
    text: "RevenueCat ofrece más que un backend de compras: paywalls, experimentos, integraciones, soporte. Si lo usas todo, quizá te compense. Si lo que necesitas es validar compras y mantener las suscripciones al día, estás entregando una parte de todo lo que vayas a ganar por un trabajo que funciona con unos pocos dólares de servidores al mes.",
  },
  method: {
    title: "Cómo lo estimamos",
    /** HTML. Each item starts with a bold label. */
    fee: "<b>Tu cuota:</b> el precio de lista del plan Pro de RevenueCat, el 1 % de los ingresos mensuales registrados a partir de {threshold}. Las cuentas grandes pueden negociar otros precios.",
    /** HTML. {calculator} becomes a link labelled with `calculatorLink`. */
    servers:
      "<b>Servidores:</b> lo que cuesta openpurr Lite en Cloudflare para una app con esos ingresos, con el mismo modelo que nuestra {calculator}. Los costes de alojamiento de RevenueCat no son públicos; esto es lo que cuesta el trabajo cuando lo ejecutas tú.",
    calculatorLink: "calculadora de ahorro",
    /** HTML. {used}, {low}, {high} are headcounts; {loaded} is "1.3". */
    teams:
      "<b>Equipos:</b> funciones, no personas. Suponemos {used} personas (las estimaciones públicas van de {low} a {high}) y las repartimos nosotros entre funciones. Los salarios salen de las ofertas de empleo públicas de RevenueCat, que indican el sueldo; el coste de cada equipo es personas × salario × {loaded} por impuestos, beneficios y equipo, sin acciones. La parte de tu cuota que no va a servidores se reparte en proporción a esos costes.",
    split:
      "<b>Por qué ventas y crecimiento superan a ingeniería:</b> el {date}, la bolsa de empleo de RevenueCat tenía {open} puestos abiertos: {gtm} en ventas, marketing y crecimiento, y {eng} en ingeniería central. Una empresa en su etapa está construyendo su go-to-market, y su nuevo puesto de Head of Sales es la oferta mejor pagada de la lista.",
    /** HTML. {funding} "$100 million", {pct} like "55%", {revenue} "$30 million". */
    investors:
      "<b>Inversores:</b> cinco rondas de 2018 a 2025, unos {funding} en total. La propiedad no es pública, así que la calculamos encadenando las valoraciones publicadas: los inversores de cada ronda reciben el importe dividido entre la valoración post-money, y todos los anteriores se diluyen en esa misma proporción. Eso da aproximadamente el {pct}. No se cuentan los pools de opciones ni la participación de la aceleradora Y Combinator. Su parte es del valor de la empresa, no una partida de sus costes, por eso se muestra aparte. En la ronda de 2025, la empresa tenía, según la prensa, unos {revenue} de ingresos anuales, cerca del punto de equilibrio.",
    colRound: "Ronda",
    colRaised: "Captado",
    colValuation: "Valoración",
    colLead: "Liderada por",
    notReported: "no publicado",
    /** HTML. */
    affiliation: "<b>Sin afiliación:</b> openpurr no está afiliado a RevenueCat. Son nuestras estimaciones, no cifras de RevenueCat.",
    assumptions: "Los supuestos, equipo por equipo",
    colTeam: "Equipo",
    colPeople: "Personas",
    colSalary: "Salario",
    colCost: "Coste anual",
    colBasis: "Salario según",
  },
  sources: {
    title: "Fuentes",
    /** One label per source, in this order. The links themselves are in English. */
    items: [
      "Precios de RevenueCat: el 1 % de los ingresos mensuales registrados a partir de 2500 $",
      "La bolsa de empleo de RevenueCat, con rangos salariales (Ashby)",
      "Ofertas anteriores de RevenueCat con salario (Greenhouse)",
      "TechCrunch: RevenueCat levanta 50 M$ y suma 100 M$ en total (mayo de 2025)",
      "TechCrunch: la Serie B de 40 M$, liderada por el Continuity Fund de Y Combinator, con una valoración de 300 M$ (2021)",
      "TechCrunch: una Serie C de 12 M$ liderada por Adjacent (2024)",
      "SaaStr: la ronda semilla de 2018 con una valoración de 7 M$, y las rondas posteriores",
      "Multiples.vc: unos 30 M$ de ingresos y una valoración de 500 M$ en la ronda de 2025 (estimaciones)",
      "Estimaciones de plantilla: TipRanks (185)",
      "Estimaciones de plantilla: TrueUp (130)",
    ],
    /** HTML. {date} is the date; {issue} becomes a link labelled with `issueLink`. */
    checked: "Revisado el {date}. ¿Ves algo desactualizado? {issue}.",
    issueLink: "Abre un issue",
  },
};
