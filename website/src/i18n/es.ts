// Spanish copy. Follows en.ts; see the notes there. Uses "tú", as is usual for developer tools.
import type { Dict } from "./en";

export const es: Dict = {
  meta: {
    title: "openpurr: la alternativa a RevenueCat de código abierto y autoalojada",
    description:
      "openpurr es una alternativa a RevenueCat de código abierto y autoalojada. Mantén el SDK de Purchases que ya usas, apúntalo a tu propio servidor y no compartas tus ingresos.",
    ogImageAlt: "openpurr: una alternativa a RevenueCat de código abierto y autoalojada, junto a su panel de gráficos de suscripciones",
  },
  header: {
    home: "Inicio de openpurr",
    nav: { features: "Funciones", editions: "Ediciones", roadmap: "Hoja de ruta", faq: "FAQ", migrate: "Migrar" },
    language: "Idioma",
  },
  footer: {
    tagline: "Infraestructura de compras de código abierto que gestionas tú mismo.",
    roadmap: "Hoja de ruta",
    contributing: "Contribuir",
    sponsor: "Patrocinar",
    contact: "Contacto",
    privacy: "Privacidad (en inglés)",
    disclaimer:
      "openpurr es un proyecto independiente. No está afiliado a RevenueCat, Inc. ni cuenta con su respaldo. App Store es una marca de Apple Inc. Google Play es una marca de Google LLC.",
    copyright: "Copyright {year} colaboradores de openpurr.",
    cookieSettings: "Configuración de cookies",
  },
  consent: {
    label: "Consentimiento de cookies",
    text: "Nos gustaría usar cookies de Google Analytics para contar visitas y ver qué páginas resultan útiles. No se instala nada a menos que aceptes, y puedes cambiar de opinión cuando quieras en Configuración de cookies.",
    privacy: "Privacidad (en inglés)",
    decline: "Rechazar",
    accept: "Aceptar",
  },
  snippet: {
    tabs: "Plataforma del SDK",
    note: "Una línea. El mismo SDK, el mismo código de compras.",
  },
  home: {
    hero: {
      title: 'La <span class="accent">alternativa a RevenueCat</span> de código abierto y <span class="nowrap">autoalojada</span>',
      lede: "Controla tu propia infraestructura de compras, no compartas ni una parte de tus ingresos y no dependas de ningún servicio comercial. Mantén el SDK de Purchases que ya usas: cambia una URL, no tu código de compras.",
      star: "Danos una estrella en GitHub",
      how: "Cómo funciona",
      shotAlt:
        "El panel de openpurr Lite, con 12 meses de movimiento del MRR, suscripciones activas, cancelaciones, clientes nuevos, pruebas nuevas y pruebas activas",
    },
    why: {
      eyebrow: "Para quién",
      title: "Para desarrolladores de apps que prefieren gestionarlo ellos mismos",
      lede: "openpurr funciona con los SDK oficiales, sin modificar. Para cambiarte, empiezas cambiando una URL, no reescribiendo tu código de compras.",
      reasons: [
        {
          title: "Tus datos, tus servidores",
          body: "Los registros de compras, los entitlements y las credenciales de las tiendas viven en una base de datos que gestionas, consultas, respaldas y exportas. Ningún servicio externo se interpone entre tu app y tus clientes.",
        },
        {
          title: "Sin reparto de ingresos",
          body: "Sin porcentaje de tus ingresos ni comisiones por transacción. La edición Lite está pensada para caber en el plan gratuito de Cloudflare, así que una app pequeña puede usarla sin pagar nada.",
        },
        {
          title: "Sin depender de un proveedor",
          body: "Es de código abierto bajo Apache 2.0. Lee el código, modifícalo y muévelo entre Cloudflare y tu propia nube.",
        },
      ],
    },
    how: {
      eyebrow: "Cómo funciona",
      title: "Tu servidor ocupa el lugar del proveedor",
      lede: "Tu app mantiene el SDK de Purchases de código abierto con el que ya se distribuye. El SDK habla con openpurr. openpurr habla con las tiendas, guarda el estado de las suscripciones y avisa a tu backend de lo que ha cambiado.",
      flowLabel: "Flujo de una solicitud",
      app: "Tu app",
      sdkLicense: "Oficial, sin modificar, con licencia MIT",
      sdkPlatforms: "iOS, Android, Flutter o React Native",
      coreWhere: "En Cloudflare Workers o en tu propia nube",
      appStoreApi: "Server API y notificaciones",
      playApi: "Developer API y RTDN",
      backend: "Tu backend",
      backendHooks: "Webhooks firmados",
      steps: [
        {
          title: "Despliega",
          body: "Ejecuta openpurr Lite en tu propia cuenta de Cloudflare. Una configuración guiada, <code>pnpm run setup</code>, crea la base de datos, despliega los dos Workers y crea tu cuenta de propietario.",
        },
        {
          title: "Apunta el SDK",
          body: "Define la URL del proxy antes de <code>configure</code>. Usa un dominio propio para poder mudarte más adelante.",
        },
        {
          title: "Conecta las tiendas",
          body: "Añade las credenciales de tus tiendas y las URL de notificación. La comprobación de configuración, <code>openpurr doctor</code>, las verifica y te dice cómo arreglar lo que falte.",
        },
      ],
    },
    features: {
      eyebrow: "Qué hace",
      title: "El backend de suscripciones, sin los extras que no usas",
      items: [
        {
          title: "Compras y notificaciones de las tiendas",
          body: "Valida transacciones de StoreKit 2 y compras de Google Play, devuelve el CustomerInfo y los entitlements que espera el SDK, y mantiene al día las renovaciones, los reembolsos y los periodos de gracia con las notificaciones del App Store y de Google Play.",
        },
        {
          title: "Webhooks",
          body: "Envía a tu backend eventos con el formato de RevenueCat, firmados con HMAC-SHA256 y reintentados durante unas 72 horas.",
        },
        {
          title: "Gráficos",
          body: "16 gráficos: ingresos, MRR y ARR, movimiento del MRR y de las suscripciones, suscripciones activas y de pago, estado de las suscripciones, cancelaciones, pruebas y conversión de pruebas, clientes nuevos, reembolsos y tasa de reembolso, y compras únicas. Filtra por app, tienda, producto y entorno, con los ingresos convertidos a USD.",
        },
        {
          title: "Experimentos de precios",
          body: "Muestra offerings distintos a los clientes nuevos de tu app y compara la conversión y los ingresos por cliente, con la probabilidad de que cada variante supere al control. Sin actualizar la app.",
        },
        {
          title: "Acceso y auditoría",
          body: "Claves de SDK y claves secretas, inicio de sesión de operadores con códigos de autenticación opcionales, roles, tokens de acceso y registro de auditoría.",
        },
        {
          title: "Servidor MCP y skills de Claude",
          body: "Pregunta a un asistente de IA por qué un cliente tiene o no un entitlement, busca compras o deja que te guíe en la configuración de App Store Connect y Play Console.",
        },
      ],
    },
    editions: {
      eyebrow: "Dos ediciones",
      title: "Empieza en pequeño y crece sin actualizar la app",
      lede: "Las dos ediciones pasan la misma batería de pruebas de conformidad. Si tu app apunta a un dominio propio, pasar de Lite a Standard no requiere publicar una nueva versión de la app.",
      lite: {
        badge: "Para apps indie",
        price: "0 $",
        priceNote: "en el plan gratuito de Cloudflare",
        items: ["TypeScript en Cloudflare Workers y D1", "Ligera y barata de ejecutar", "Alertas antes de llegar a los límites del plan gratuito"],
      },
      standard: {
        badge: "Para carteras más grandes",
        price: "Tu factura de la nube",
        priceNote: "nada más",
        items: ["Go y Postgres en contenedores", "GCP, AWS o DigitalOcean", "Una plantilla de despliegue para cada una"],
      },
    },
    savings: {
      eyebrow: "Coste",
      title: "Lo que conservas frente a RevenueCat",
      lede: "El plan Pro de RevenueCat es gratis por debajo de 2500 $ al mes de ingresos registrados y después cobra el 1 % de todos ellos. Lite funciona en el plan gratuito de Cloudflare y, cuando tu app lo supera, en Workers Paid desde 5 $ al mes.",
      revenue: "Ingresos mensuales",
      rc: "RevenueCat",
      op: "openpurr Lite",
      saved: "Ahorro al año",
      perMonth: "{amount} al mes",
      free: "Plan gratuito de Cloudflare",
      paid: "Cloudflare Workers Paid",
      chartLabel: "Coste mensual según los ingresos mensuales: el de RevenueCat crece con los ingresos y el de openpurr Lite se queda cerca de cero",
      gapLegend: "Lo que conservas",
      tableSummary: "Comparar con otros niveles de ingresos",
      colRevenue: "Ingresos mensuales",
      colRc: "RevenueCat, al mes",
      colOp: "openpurr Lite, al mes",
      colSaved: "Ahorro al año",
      methodSummary: "Cómo lo calculamos",
      pricingLink: "¿A dónde va el 1 % de RevenueCat? →",
      method: [
        "RevenueCat: el precio de lista del plan Pro, el 1 % de los ingresos mensuales registrados a partir de 2500 $. Los ingresos registrados cuentan los planes anuales y las compras únicas en el mes en que se pagan, así que pueden superar el MRR. Las cuentas grandes pueden negociar precios Enterprise.",
        "openpurr Lite: los precios de Cloudflare para Workers y D1. Suponemos unos 1,50 $ de ingresos mensuales y unas 10 peticiones del SDK al día por usuario activo diario. Así, las 100 000 peticiones diarias del plan gratuito cubren hasta unos {paidFrom} de ingresos mensuales, con margen. Por encima contamos Workers Paid: 5 $ al mes, más 0,30 $ por cada millón de peticiones por encima de 10 millones.",
        "No incluido: tu tiempo para mantenerlo. Las comisiones de las tiendas son las mismas en ambos casos.",
        "Precios comprobados el {date}. openpurr no está afiliado a RevenueCat.",
      ],
    },
    fit: {
      eyebrow: "Con franqueza",
      title: "Puede que todavía no sea para ti",
      lede: "Si necesitas creadores de paywalls, integraciones de analítica de terceros o un contrato de soporte, las plataformas comerciales ya los ofrecen hoy.",
      outTitle: "Fuera de alcance por ahora",
      tags: [
        "Paywalls",
        "Eventos publicitarios",
        "Customer Center",
        "Monedas virtuales",
        "Pagos web",
        "Amazon",
        "Integraciones de analítica",
      ],
    },
    roadmap: {
      eyebrow: "Hoja de ruta",
      title: "Hacia dónde va",
      lede: "El orden está decidido, pero no hay fechas. Si algo te importa, dilo en un issue.",
      status: { done: "Hecho", wip: "En curso", planned: "Planificado", later: "Tú decides" },
      phases: [
        {
          phase: "Lite",
          items: [
            "Última versión: {version}",
            "Pensado para el plan gratuito de Cloudflare",
            "App Store y Google Play",
            "Webhooks, panel y administración",
            "Varias apps en un mismo despliegue",
            "Experimentos de precios",
            "Servidor MCP, CLI y skills de Claude",
            "Siguiente: pruebas en dispositivos y luego la 1.0",
          ],
        },
        {
          phase: "Standard",
          items: ["Go y Postgres en contenedores", "GCP, AWS y DigitalOcean", "La misma batería de conformidad que Lite", "Migración desde Lite sin actualizar la app"],
        },
        {
          phase: "Definido por la comunidad",
          items: ["Identidad verificada de los usuarios finales", "Extras de Standard para equipos grandes", "Lo que pidas en los issues"],
        },
      ],
      more: "Lee la hoja de ruta completa (en inglés) →",
    },
    cta: {
      title: "Ayuda a darle forma",
      body: "La ayuda más útil ahora mismo son tus comentarios: suposiciones equivocadas sobre los SDK o las tiendas, y casos límite reales en renovaciones, reembolsos y periodos de gracia.",
      star: "Danos una estrella en GitHub",
      issue: "Abre un issue",
      coffee: "Invítanos a un café",
    },
  },
  faq: {
    eyebrow: "FAQ",
    title: "openpurr como alternativa a RevenueCat",
    lede: "Qué cambia cuando gestionas tu propio backend de suscripciones, y qué no.",
    items: [
      {
        q: "¿Qué es openpurr?",
        a: "openpurr es una alternativa a RevenueCat de código abierto y autoalojada. Es un backend para compras dentro de la app y suscripciones que funciona con el SDK de Purchases oficial de RevenueCat. Valida compras del App Store y de Google Play, controla los entitlements, recibe las notificaciones de las tiendas, envía webhooks a tu backend y muestra en gráficos tus métricas clave de suscripción, todo en una infraestructura que controlas tú.",
      },
      {
        q: "¿En qué se diferencia openpurr de RevenueCat?",
        a: "RevenueCat es un servicio comercial alojado que cobra una parte de los ingresos por encima de un nivel gratuito. openpurr es software que ejecutas tú: tus registros de compras, entitlements y credenciales de las tiendas están en tu propia base de datos, y no hay reparto de ingresos ni comisiones por transacción. Hoy RevenueCat ofrece más funciones, como paywalls e integraciones de analítica. openpurr se centra en lo esencial del backend de suscripciones.",
      },
      {
        q: "¿Tengo que reescribir mi código de compras para dejar RevenueCat?",
        a: "No. openpurr funciona con el SDK de Purchases oficial, sin modificar. Configuras la URL del proxy del SDK con tu servidor de openpurr antes de llamar a configure, y el resto de tu código de compras sigue igual. Usa un dominio propio para poder cambiar de servidor más adelante sin actualizar la app.",
      },
      {
        q: "¿Cómo paso mis clientes actuales de RevenueCat a openpurr?",
        a: "Importándolos. Pide a RevenueCat una exportación de migración, y openpurr import obtiene las compras de cada cliente de Apple y Google y las asigna a los mismos IDs de usuario. La nueva versión de tu app también envía una vez las compras de cada cliente, y los dos backends se mantienen al día mientras la gente actualiza, así que nadie pierde el acceso.",
        link: "Cómo migrar",
      },
      {
        q: "¿Puedo pasarme desde Adapty?",
        a: "Sí, con una actualización de la app. El SDK de Adapty no se puede apuntar a otro servidor, así que la actualización lo sustituye por el SDK de Purchases, con el que funciona openpurr. Tus productos siguen siendo los mismos en las tiendas. openpurr importa tus clientes del App Store desde la exportación de eventos de Adapty, la nueva versión de tu app trae a todos los demás la primera vez que se abre, y los dos backends se mantienen al día mientras la gente actualiza.",
        link: "Lee la guía de Adapty",
        linkTo: "adapty",
      },
      {
        q: "¿Qué plataformas y tiendas admite openpurr?",
        a: "El SDK de Purchases para iOS, Android, Flutter y React Native, con compras del App Store y de Google Play. Amazon y los pagos web quedan fuera de alcance por ahora.",
      },
      {
        q: "¿Cuánto cuesta openpurr?",
        a: "openpurr es gratuito y de código abierto bajo la licencia Apache 2.0. Solo pagas la infraestructura en la que se ejecuta. La edición Lite está pensada para el plan gratuito de Cloudflare, así que una app pequeña puede usarla sin pagar nada. La edición Standard se ejecuta en contenedores en tu propia nube, así que su coste es tu factura de la nube.",
      },
      {
        q: "¿Dónde se guardan mis datos?",
        a: "En tu propia base de datos. La edición Lite usa Cloudflare D1 en tu cuenta de Cloudflare. La edición Standard usa Postgres en GCP, AWS o DigitalOcean. Puedes consultarlos, respaldarlos y exportarlos, y ningún servicio externo se interpone entre tu app y tus clientes.",
      },
      {
        q: "¿openpurr envía webhooks como RevenueCat?",
        a: "Sí. openpurr envía a tu backend eventos con el formato de RevenueCat, firmados con HMAC-SHA256 y reintentados durante unas 72 horas, así que los manejadores de webhooks que ya tienes necesitan pocos cambios o ninguno.",
      },
      {
        q: "¿Qué hace RevenueCat que openpurr no hace?",
        a: "Paywalls, integraciones de analítica de terceros, Customer Center, monedas virtuales, pagos web, Amazon, eventos publicitarios y un contrato de soporte comercial quedan fuera de alcance por ahora. Los experimentos de precios ya vienen incluidos. Si necesitas el resto hoy, te conviene más una plataforma comercial.",
      },
      {
        q: "¿Está openpurr listo para producción?",
        a: "Todavía no. openpurr está en sus inicios: las dos ediciones funcionan y pasan la misma batería de pruebas de conformidad, pero aún no se han probado de principio a fin con compras en dispositivos reales. Sigue la hoja de ruta en GitHub y abre un issue si algo te importa.",
      },
      {
        q: "¿Está openpurr afiliado a RevenueCat?",
        a: "No. openpurr es un proyecto independiente de código abierto, no afiliado a RevenueCat, Inc. ni respaldado por ella. Funciona con el SDK de Purchases oficial de RevenueCat, que tiene licencia MIT.",
      },
    ],
  },
  structured: {
    description:
      "Una alternativa a RevenueCat de código abierto y autoalojada: un backend para compras dentro de la app y suscripciones del App Store y Google Play que funciona con el SDK de Purchases oficial, sin modificar. Valida compras, controla los entitlements, recibe las notificaciones de las tiendas, envía webhooks y muestra en gráficos las métricas de suscripción.",
    subCategory: "Backend de compras dentro de la app y suscripciones",
    features: [
      "Funciona con el SDK de Purchases oficial de RevenueCat para iOS, Android, Flutter y React Native",
      "Validación de compras de StoreKit 2 y Google Play",
      "App Store Server Notifications V2 y Real-time Developer Notifications de Google Play",
      "Webhooks con el formato de RevenueCat, firmados con HMAC-SHA256",
      "16 gráficos de suscripción, entre ellos MRR, cancelaciones y conversión de pruebas",
      "Experimentos de precios sobre offerings, con resultados por variante",
      "Servidor MCP, CLI y skills de Claude",
    ],
  },
};
