// Spanish copy of the migration page. Follows en.ts; see the notes there.
import type { MigrateDict } from "./en";

export const migrateEs: MigrateDict = {
  meta: {
    title: "Cómo migrar de RevenueCat a openpurr, paso a paso",
    description:
      "Pasa tu app de RevenueCat a openpurr, la alternativa a RevenueCat de código abierto: mantén el SDK de Purchases, importa a cada suscriptor y conserva su acceso.",
    ogImageAlt:
      "Pasa de RevenueCat a openpurr sin perder ni un suscriptor: mantén el SDK de Purchases, importa a todos tus clientes y las versiones antiguas de la app siguen funcionando.",
  },
  hero: {
    crumb: "Migrar desde RevenueCat",
    eyebrow: "Guía de migración",
    headline: "Pasa de RevenueCat a openpurr sin perder ni un suscriptor",
    lede: "Mantén el SDK de Purchases que tu app ya usa. Importa tus clientes actuales desde la exportación de RevenueCat: openpurr obtiene cada compra directamente de Apple y Google. Las versiones antiguas de la app siguen funcionando mientras la gente actualiza.",
    guide: "Lee la guía paso a paso (en inglés)",
    steps: "Ver los pasos",
    updated: "Actualizado el {date}",
  },
  summary: {
    title: "En resumen",
    items: [
      "openpurr es una alternativa a RevenueCat autoalojada y de código abierto. Funciona con el SDK de Purchases oficial de RevenueCat, sin modificar.",
      "Tu app añade una línea (la URL del proxy del SDK) y una llamada única a <code>syncPurchases</code>. El resto de tu código de compras sigue igual.",
      "<code>openpurr import</code> trae a tus clientes actuales desde la exportación de RevenueCat. Las compras en sí se obtienen de Apple y Google, no se copian.",
      "Las apps del App Store pueden usar la Scheduled Data Export de RevenueCat. Para Google Play hace falta una exportación de migración del soporte de RevenueCat, la única que incluye los purchase tokens.",
      "Los dos backends se mantienen al día hasta que la mayoría de la gente haya actualizado la app, así que nadie pierde el acceso.",
      "En el plan gratuito de Cloudflare, la importación procesa unos 2500 clientes al día. Con Workers Paid, una importación grande tarda unas horas.",
    ],
  },
  how: {
    eyebrow: "Cómo funciona",
    title: "Cómo funciona una migración desde RevenueCat",
    lede: "openpurr no copia los registros de compras de RevenueCat. Solo necesita saber quién es el dueño de cada compra, y después pregunta a las tiendas, igual que cuando tu app envía una compra.",
    ways: [
      {
        title: "La importación",
        body: "La exportación de RevenueCat indica qué usuario de la app es dueño de cada compra en la tienda. <code>openpurr import</code> pide cada compra a Apple y Google y registra la respuesta de la tienda para ese usuario. Trae a todo el mundo de una vez, incluidas las personas que no vuelven a abrir la app.",
      },
      {
        title: "La actualización de la app",
        body: "La nueva versión apunta el SDK de Purchases a openpurr y envía una vez las compras de cada cliente con <code>syncPurchases</code>. Así se cubre a quien no estuviera en la exportación y a quien comprara después de generarla.",
      },
      {
        title: "Los dos backends, durante un tiempo",
        body: "Las versiones antiguas de la app siguen hablando con RevenueCat hasta que la gente actualiza. RevenueCat reenvía a openpurr las notificaciones de Apple, y una segunda suscripción de Pub/Sub hace lo mismo con Google, así que los dos se mantienen al día.",
      },
    ],
  },
  app: {
    eyebrow: "En tu app",
    title: "Qué cambia en tu app",
    lede: "Define la URL del proxy antes de configure y envía una vez las compras de cada cliente. Los mismos dos cambios sirven en Android, Flutter y React Native; la guía tiene el código para cada uno.",
    codeLabel: "Ejemplo en Swift: la URL del proxy y una sincronización única",
    proxyComment: "Antes de configure(): la única línea que añaden la mayoría de las apps",
    syncComment: "Una vez por instalación: envía las compras de este cliente a openpurr",
  },
  import: {
    eyebrow: "La importación",
    title: "Importar clientes desde RevenueCat",
    lede: "La CLI de openpurr lee las columnas de RevenueCat tal como vienen: IDs de usuario de la app, IDs de transacción del App Store, purchase tokens de Google Play y atributos como <code>$email</code>.",
    codeLabel: "Terminal: importar la exportación de RevenueCat",
    dryRunComment: "Revisa las primeras filas: consulta a Apple y Google, no escribe nada",
    importComment: "Importa a todos. Detenlo cuando quieras; vuelve a ejecutarlo para seguir.",
    safeguards: [
      ["Nadie pierde el acceso", "Una compra que la app ya envió para un cliente sigue siendo suya; la importación nunca la mueve."],
      ["Sin webhooks duplicados", "Las compras importadas no son nuevas, así que openpurr no envía eventos por ellas."],
      ["Gráficos fieles", "Los clientes importados se fechan por su primera compra, no se cuentan como nuevos el día de la importación."],
      ["Tu app sigue funcionando", "En el plan gratuito de Cloudflare, la importación se detiene al 90 % de un límite diario y continúa al día siguiente."],
      ["Detener y reanudar", "El progreso se guarda. Importar una fila dos veces no cambia nada, así que puedes volver a ejecutar una exportación más reciente."],
      ["Pruébalo primero", "Una ejecución de prueba consulta a las tiendas e informa de lo que pasaría, sin escribir nada."],
    ] as [string, string][],
  },
  steps: {
    eyebrow: "Paso a paso",
    title: "Cómo migrar de RevenueCat en siete pasos",
    lede: "Los dos backends siguen funcionando hasta que estés listo para hacer el cambio, así que los clientes con versiones antiguas de la app conservan su acceso.",
    items: [
      {
        title: "Configura openpurr",
        body: "Despliega openpurr Lite en tu cuenta de Cloudflare, dale acceso a las API del App Store y de Google Play, y vuelve a crear tus productos, entitlements y offerings con los mismos identificadores. Incluso puedes conservar tus claves públicas de SDK de RevenueCat.",
      },
      {
        title: "Mantén informados a los dos backends",
        body: "Configura openpurr como Apple Server Notification Forwarding URL de RevenueCat y añade la suscripción push de openpurr a tu tema de notificaciones de Play.",
      },
      {
        title: "Consigue tu exportación",
        body: "Solo App Store: la Scheduled Data Export de RevenueCat tiene lo necesario. Con Google Play, pide al soporte de RevenueCat una exportación de migración, ya que solo esa incluye los purchase tokens. La guía tiene una solicitud que puedes copiar.",
      },
      { title: "Importa", body: "Ejecuta <code>openpurr import</code>, primero con una ejecución de prueba. Los problemas con filas sueltas van a un informe y no detienen la importación." },
      { title: "Publica la actualización de la app", body: "Añade la URL del proxy y una llamada única a <code>syncPurchases</code>. Publícala cuando haya terminado la importación." },
      {
        title: "Comprueba",
        body: "<code>openpurr doctor</code> revisa la configuración. Busca clientes que conozcas y compara las suscripciones activas con los gráficos de RevenueCat.",
      },
      {
        title: "Completa el cambio",
        body: "Cuando la mayoría de los clientes hayan actualizado, apunta Apple y Google directamente a openpurr, activa los webhooks de openpurr y desactiva los de RevenueCat.",
      },
    ],
    source: "Fuente:",
    sourceNotifications: "RevenueCat: notificaciones del servidor de Apple (en inglés)",
    sourceExports: "RevenueCat: exportar datos o migrar a otro servicio (en inglés)",
    more: "Todos los comandos y ajustes están en la guía completa (en inglés) →",
  },
  moves: {
    eyebrow: "Qué se migra",
    title: "Qué se migra desde RevenueCat y qué no",
    rows: [
      ["Suscripciones y compras, con renovaciones, reembolsos, periodos de gracia y vencimientos", "Sí, obtenidas de Apple y Google"],
      ["Quién es dueño de cada compra", "Sí, desde la exportación de RevenueCat"],
      ["IDs de usuario de la app, incluidos los anónimos", "Sí, sin cambios"],
      ["Atributos de clientes ($email, $displayName y los tuyos propios)", "Sí, desde una Audience export"],
      ["Productos, entitlements y offerings", "Los vuelves a crear, con los mismos identificadores"],
      ["Historial de gráficos anterior al cambio", "En parte: guarda los CSV de gráficos de RevenueCat para tus registros"],
      ["Paywalls, experimentos, integraciones, Customer Center", "No: openpurr no los tiene"],
    ] as [string, string][],
  },
  faq: {
    eyebrow: "FAQ",
    title: "Preguntas frecuentes sobre migrar desde RevenueCat",
    items: [
      {
        q: "¿Tengo que cambiar mi código de compras?",
        a: "No. openpurr funciona con el SDK de Purchases oficial de RevenueCat, sin modificar. La actualización de la app añade la URL del proxy antes de configure y una llamada única a syncPurchases. getOfferings, purchase, restorePurchases, logIn y el resto siguen igual.",
      },
      {
        q: "¿Necesito la ayuda de RevenueCat para migrar?",
        a: "Para las apps del App Store, no: la Scheduled Data Export de RevenueCat incluye los IDs de transacción que necesita openpurr. Para Google Play, sí: según la documentación de RevenueCat, solo una exportación de migración preparada por el soporte de RevenueCat incluye los purchase tokens que exige Google.",
      },
      {
        q: "¿Qué pasa con los clientes que nunca actualizan la app?",
        a: "La importación los cubre: sus compras se obtienen de Apple y Google y se asignan a los mismos IDs de usuario de la app. Mientras sigan en una versión antigua, esa versión habla con RevenueCat, y por eso los dos backends se mantienen informados hasta que la mayoría de la gente haya actualizado.",
      },
      {
        q: "¿Cuánto tarda una importación?",
        a: "Cada cliente requiere unas 30 escrituras de filas en la base de datos. En el plan gratuito de Cloudflare, eso son unos 2500 clientes al día, y la importación se pausa sola al llegar al límite diario y se reanuda al día siguiente. Con Workers Paid (5 $ al mes), una importación grande tarda unas horas.",
      },
      {
        q: "¿Se copian mis datos desde RevenueCat?",
        a: "Solo la relación entre usuarios de la app y compras en las tiendas, y los atributos si los importas. Las compras en sí vienen directamente de Apple y Google, así que openpurr registra el estado actual según las tiendas, con renovaciones y reembolsos incluidos.",
      },
    ],
  },
  cta: {
    title: "¿Listo para cambiarte?",
    body: "La guía explica cada paso. Si algo de tu configuración no encaja, abre un issue: las migraciones deciden qué se construye a continuación.",
    guide: "Lee la guía (en inglés)",
    github: "openpurr en GitHub",
    issue: "Abre un issue",
  },
};
