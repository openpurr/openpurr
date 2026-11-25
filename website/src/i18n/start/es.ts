// The "Add in-app purchases" page in this language (see en.ts for the notes).
import type { StartDict } from "./en";

export const startEs: StartDict = {
  meta: {
    title: "Añade compras in-app y suscripciones gratis a tu app - openpurr",
    description:
      "¿Empiezas una app? Añade compras in-app y suscripciones con el SDK de Purchases oficial y un backend de código abierto que ejecutas tú. Sin reparto de ingresos.",
    ogImageAlt: "¿Empiezas una app nueva? Empieza sin reparto de ingresos. Quédate con tu 1 % e inviértelo en tu negocio.",
  },
  hero: {
    crumb: "Añadir compras in-app",
    eyebrow: "Para apps nuevas",
    headline: "¿Empiezas una app nueva?",
    headlineAccent: "Empieza sin reparto de ingresos.",
    lede: "La mayoría de los backends de compras se llevan el 1 % de tus ingresos en cuanto pasas de {threshold} al mes, y la factura crece cada vez que creces tú. Lo más fácil es evitarlo antes de tu primera venta. openpurr es un backend gratuito y de código abierto para compras in-app y suscripciones que ejecutas tú, con el mismo SDK oficial que usan las grandes plataformas.",
    ctaStart: "Empieza en GitHub",
    ctaAi: "Copia un prompt para tu asistente de IA",
  },
  growth: {
    title: "Tu 1 %, desde el primer día",
    text: "Elige dónde esperas que esté tu app dentro de tres años. Esto es lo que sumaría un reparto de ingresos del 1 % por el camino, suponiendo un crecimiento constante desde cero.",
    target: "Ingresos mensuales dentro de tres años",
    fee: "Reparto de ingresos del 1 %, en 3 años",
    servers: "Ejecutándolo tú, en 3 años",
    after: "Y después, cada año",
    chartLabel: "El reparto de ingresos acumulándose mes a mes durante tres años",
    summary: "Son <b>{fee}</b> que entregarías antes del cuarto año, frente a <b>{servers}</b> para tus propios servidores. Quédatelo e inviértelo en tu negocio.",
  },
  invest: {
    title: "Inviértelo en tu negocio, y en ti",
    text: "Lo que compra un año de tu 1 % si te lo quedas:",
  },
  how: {
    title: "Cómo funciona",
    lede: "Cuatro pasos, y el código que escribes es el mismo que en cualquier tutorial de RevenueCat.",
    steps: [
      {
        title: "Despliega openpurr",
        text: "Ejecuta la instalación en tu cuenta de Cloudflare. Para apps pequeñas, Lite cabe en el <b>plan gratuito</b>, y puedes volver a ejecutar la instalación sin riesgo si se detiene a medias.",
      },
      {
        title: "Añade tu app y tus productos",
        text: "El panel empieza por añadir tu primera app: su bundle ID y su nombre de paquete, y luego productos, entitlements y offerings.",
      },
      {
        title: "Añade el SDK de Purchases",
        text: "Instala el SDK de Purchases oficial de RevenueCat, de código abierto con licencia MIT, y configura <b>una URL de proxy</b> antes de inicializarlo.",
      },
      {
        title: "Publica",
        text: "Las compras se validan con Apple y Google, las renovaciones y los reembolsos llegan por notificaciones de las tiendas, y tu backend recibe webhooks. ¿Usas Claude Code? El plugin de openpurr te guía en la configuración de App Store Connect y Play Console.",
      },
    ],
    setupLabel: "Instalación, en tu equipo",
  },
  ai: {
    title: "Configúralo con tu asistente de programación con IA",
    text: "Abre el proyecto de tu app en Claude Code, Codex, Cursor, Grok o cualquier agente de programación y pega este prompt. Despliega openpurr, conecta las tiendas y añade el SDK, y te pregunta antes de cualquier cosa que necesite tu inicio de sesión.",
    copy: "Copiar prompt",
    copied: "Copiado",
    claudeTip: "¿Usas Claude Code? Añade antes el plugin de openpurr, que te guía paso a paso:",
  },
  includes: {
    title: "Lo que obtienes",
    yes: [
      "Compras y suscripciones en el App Store y Google Play",
      "Entitlements y offerings",
      "Webhooks a tu backend, firmados y con reintentos",
      "16 gráficos: ingresos, MRR, churn, pruebas y más",
      "Experimentos de precios",
      "Tus datos en tu propia base de datos",
    ],
    notYetTitle: "Todavía no",
    notYet: "Creadores de paywalls, integraciones de analítica de terceros, eventos publicitarios, pagos web y Amazon. Si los necesitas desde el primer día, las plataformas comerciales ya los ofrecen hoy.",
  },
  lockin: {
    title: "Sin ataduras, en ningún sentido",
    text: "Como openpurr usa el SDK de Purchases estándar, tu código de compras funciona con cualquiera de los dos backends. Si openpurr se te queda pequeño, o quieres lo que añaden las plataformas comerciales, cambiar es un ajuste de configuración y una importación de clientes, no reescribir nada.",
  },
  pricingLink: {
    text: "¿Te preguntas adónde va el 1 % cuando lo pagas?",
    link: "Mira los precios de RevenueCat, desglosados →",
  },
  faq: {
    title: "Lo que la gente pregunta",
    items: {
      backend: {
        q: "¿Necesito un backend para las compras in-app?",
        a: "No es imprescindible: StoreKit y Google Play Billing funcionan en el dispositivo. Pero un backend mantiene las suscripciones en orden. Valida las compras con Apple y Google, sigue las renovaciones, cancelaciones y reembolsos a través de las notificaciones de las tiendas, y le dice a tu app y a tu servidor quién tiene acceso. openpurr es ese backend, y lo ejecutas tú.",
      },
      cheapest: {
        q: "¿Cuál es la forma más barata de añadir suscripciones a una app de iOS o Android?",
        a: "Ejecutar el backend tú mismo. Para apps pequeñas, openpurr Lite cabe en el plan gratuito de Cloudflare y funciona con el SDK de Purchases, gratuito y de código abierto, así que lo que pagas son los servidores: unos {servers} al año para una app que ingresa {m25k} al mes según nuestro modelo, sin reparto de ingresos.",
      },
      free: {
        q: "¿openpurr es gratis de verdad?",
        a: "Sí. Es de código abierto con licencia Apache 2.0, sin reparto de ingresos ni comisiones por transacción. Pagas tus propios servidores, y las apps pequeñas caben en el plan gratuito de Cloudflare.",
      },
      switch: {
        q: "¿Puedo pasarme a RevenueCat más adelante?",
        a: "Sí. openpurr usa el SDK de Purchases oficial de RevenueCat, así que el código de compras de tu app funciona con cualquiera de los dos backends y tus productos siguen siendo los mismos en las tiendas. Cambiar es un ajuste de configuración más mover los registros de tus clientes.",
      },
      missing: {
        q: "¿Qué no hace openpurr todavía?",
        a: "Creadores de paywalls, integraciones de analítica de terceros, eventos publicitarios, pagos web y Amazon. Los experimentos de precios ya vienen incluidos. Si necesitas el resto desde el primer día, una plataforma comercial ya lo ofrece hoy.",
      },
    },
  },
};
