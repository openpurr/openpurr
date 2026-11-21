<!-- translated-from: README.md sha256:7fe66f74f9217d9d -->
<h1 align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset=".github/assets/openpurr-logo-dark.png">
    <img src=".github/assets/openpurr-logo.png" alt="openpurr" width="400">
  </picture>
</h1>

<!-- languages -->
<p align="center"><a href="README.md">English</a> · <a href="README.de.md">Deutsch</a> · <b>Español</b> · <a href="README.fr.md">Français</a> · <a href="README.it.md">Italiano</a> · <a href="README.nl.md">Nederlands</a> · <a href="README.pl.md">Polski</a> · <a href="README.pt-BR.md">Português (Brasil)</a> · <a href="README.tr.md">Türkçe</a> · <a href="README.id.md">Bahasa Indonesia</a> · <a href="README.vi.md">Tiếng Việt</a> · <a href="README.ar.md">العربية</a> · <a href="README.hi.md">हिन्दी</a> · <a href="README.ja.md">日本語</a> · <a href="README.ko.md">한국어</a> · <a href="README.zh-CN.md">简体中文</a> · <a href="README.zh-TW.md">繁體中文</a></p>
<!-- /languages -->

Un backend alternativo a RevenueCat, autoalojado y de código abierto.

Con los SDK de Purchases de código abierto de RevenueCat, apunta el `Purchases.proxyURL` de tu app a tu propio servidor. openpurr valida las compras del App Store y de Google Play, controla los entitlements, recibe las notificaciones de las tiendas, envía webhooks a tu backend y muestra en gráficos tus métricas clave de suscripción. Se ejecuta en una infraestructura que controlas tú.

openpurr es un proyecto independiente. No está afiliado a RevenueCat, Inc. ni cuenta con su respaldo.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset=".github/assets/openpurr-dashboard-demo-dark.webp">
  <img src=".github/assets/openpurr-dashboard-demo.webp" alt="Los gráficos del panel de openpurr Lite, recorridos con sus tooltips: MRR, Movimiento del MRR, Ingresos, Suscripciones activas, Cancelaciones">
</picture>

## Para quién es

Desarrolladores de apps que:

- **Quieren controlar su propia infraestructura de compras.** Tus registros de compras, entitlements y credenciales de las tiendas viven en servidores que gestionas tú, en una base de datos que puedes consultar, respaldar y exportar. Ningún servicio externo se interpone entre tu app y tus clientes.
- **No quieren compartir un porcentaje de sus ingresos.** openpurr no tiene reparto de ingresos ni comisiones por transacción. La edición Lite está pensada para caber en el plan gratuito de Cloudflare, así que una app pequeña puede usarla sin pagar nada.
- **No quieren depender de un servicio comercial.** Es de código abierto: puedes leer el código, modificarlo y moverlo entre Cloudflare y tu propia nube.

También encaja si ya usas los SDK de RevenueCat y quieres conservarlos. openpurr funciona con los SDK oficiales, sin modificar, así que para cambiarte empiezas cambiando una URL, no reescribiendo tu código de compras. Para traer a tus clientes actuales, consulta [Cómo migrar desde RevenueCat](https://openpurr.org/es/migrate-from-revenuecat/).

**Puede que (todavía) no sea para ti** si necesitas creadores de paywalls, experimentos A/B, integraciones de analítica de terceros o un contrato de soporte. Las plataformas comerciales ya los ofrecen hoy. Consulta la [hoja de ruta](ROADMAP.md) (en inglés) para ver lo que viene.

## Qué hace

- **Compras:** valida transacciones de StoreKit 2 y compras de Google Play, y devuelve el `CustomerInfo` y los entitlements que espera el SDK.
- **Notificaciones de las tiendas:** recibe las App Store Server Notifications V2 y las Real-time Developer Notifications de Google Play.
- **Webhooks:** envía a tu backend eventos con el formato de RevenueCat, firmados con HMAC-SHA256 y reintentados durante unas 72 horas.
- **Gráficos:** 16 gráficos en el panel, con filtros por proyecto, app, tienda, producto y entorno, y descarga en CSV:
  - **Ingresos:** ingresos, reembolsos, tasa de reembolso y compras que no son suscripciones.
  - **Ingresos recurrentes:** MRR, ARR y movimiento del MRR.
  - **Suscripciones:** suscripciones activas, suscripciones de pago, movimiento de suscripciones, estado de las suscripciones y cancelaciones.
  - **Pruebas:** pruebas activas, pruebas nuevas y movimiento de pruebas.
  - **Clientes:** clientes nuevos.
- **Autenticación:** claves de SDK y claves secretas, inicio de sesión de operadores (contraseña con códigos de autenticación opcionales; Cloudflare Access está previsto), roles y registro de auditoría.
- **Servidor MCP y skills de Claude:** un asistente de IA puede buscar clientes, explicar por qué alguien tiene o no un entitlement y guiarte en la configuración del App Store y de Play Console.

**Fuera de alcance por ahora:** paywalls, eventos publicitarios, Customer Center, monedas virtuales, pagos web, Amazon e integraciones de analítica de terceros. Los experimentos de precios están en la [hoja de ruta](ROADMAP.md#later-) (en inglés).

## Dos ediciones

| | Lite | Standard |
|---|---|---|
| Lenguaje | TypeScript | Go |
| Se ejecuta en | Cloudflare Workers + D1 | Contenedores + Postgres en GCP o AWS |
| Coste | Pensada para caber en el plan gratuito de Cloudflare | Tu factura de la nube |
| Para | Apps indie: ligera y barata de ejecutar | Carteras de apps más grandes (próximamente) |

Las dos ediciones pasan la misma batería de pruebas de conformidad, en `spec/`. Puedes pasar de Lite a Standard sin publicar una actualización de la app, siempre que tu app apunte a un dominio propio.

## Lo que conservas frente a RevenueCat

El plan Pro de RevenueCat es gratis por debajo de 2500 $ al mes de ingresos registrados y después cobra el 1 % de todos ellos. Lite funciona en el plan gratuito de Cloudflare y, cuando tu app lo supera, en Workers Paid desde 5 $ al mes.

<a href="https://openpurr.org/es/#savings">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset=".github/assets/openpurr-savings-dark.webp">
    <img src=".github/assets/openpurr-savings.webp" alt="La calculadora de ahorro: a medida que los ingresos mensuales suben hasta 250 000 $, el coste mensual de RevenueCat crece y el de openpurr Lite se queda cerca de cero">
  </picture>
</a>

| Ingresos mensuales | RevenueCat, al mes | openpurr Lite, al mes | Ahorro al año |
|---|--:|--:|--:|
| 2000 US$ | 0 US$ | 0 US$ | **0 US$** |
| 5000 US$ | 50 US$ | 0 US$ | **600 US$** |
| 10.000 US$ | 100 US$ | 0 US$ | **1200 US$** |
| 25.000 US$ | 250 US$ | 5 US$ | **2940 US$** |
| 50.000 US$ | 500 US$ | 5 US$ | **5939 US$** |
| 100.000 US$ | 1000 US$ | 9 US$ | **11.896 US$** |
| 250.000 US$ | 2500 US$ | 20 US$ | **29.764 US$** |

Estimaciones, con precios comprobados el 21 de noviembre de 2026. Suponen unos 1,50 $ de ingresos mensuales y 10 peticiones del SDK al día por usuario activo diario, así que el paso a Workers Paid llega hacia los 11.250 US$ al mes. [Prueba con tus cifras](https://openpurr.org/es/#savings).

## Compatibilidad con los SDK

Desde el primer día se usan los SDK oficiales, sin modificar (todos con licencia MIT):

| SDK | Cómo apuntarlo a openpurr |
|---|---|
| iOS | `Purchases.proxyURL = URL(string: "https://purchases.example.com")` |
| Android | `Purchases.proxyURL = URL("https://purchases.example.com")` |
| Flutter, React Native | `Purchases.setProxyURL("https://purchases.example.com")` |

Define la URL del proxy antes de llamar a `configure`. Deja la verificación de entitlements con su valor predeterminado (desactivada), porque las respuestas firmadas dependen de la clave propia de RevenueCat.

**Limitación conocida en Android:** el SDK envía tráfico de diagnóstico, paywalls y anuncios directamente a tres hosts de RevenueCat, aunque haya una URL de proxy configurada. openpurr desactiva el diagnóstico mediante la configuración remota. No uses los paywalls ni los anuncios de RevenueCatUI en Android con openpurr.

## Estructura prevista del repositorio

```
spec/       language-neutral contract: OpenAPI, JSON schemas, fixtures, conformance suite
lite/       Lite edition: lightweight, for indie apps on Cloudflare Workers (TypeScript)
standard/   Standard edition: for larger app portfolios on AWS or GCP (Go, coming soon)
cli/        `npx @openpurr/cli` (works with either edition)
skills/     Claude Code plugin
examples/   sample apps
infra/      Terraform/OpenTofu modules for GCP, AWS and DigitalOcean
```

## Primeros pasos

Lite está en la versión 0.1.0, su primera versión, así que espera cambios antes de la 1.0. Para probarlo en tu propia cuenta de Cloudflare (basta con el plan gratuito), con Node 22.12 o posterior:

```sh
git clone https://github.com/openpurr/openpurr && cd openpurr
npx pnpm install
cd lite && npx wrangler login
npx pnpm run setup      # database, both Workers, operator secret and your owner account
```

Puedes volver a ejecutar la configuración sin problemas si se detiene a medias. Termina con un enlace al panel, que se abre en el paso de añadir tu primera app: su bundle ID y su nombre de paquete, y después productos, entitlements y offerings. Un mismo despliegue puede ejecutar varias apps como proyectos separados, cada uno con sus propios clientes. Después:

- **Comprueba tu configuración:** ejecuta `npx @openpurr/cli login` y después `npx @openpurr/cli doctor`. Te dice qué falta y cómo arreglar cada punto.
- **Recibe alertas de uso:** añade un token de API de Cloudflare con el permiso Account Analytics: Read como secreto `CLOUDFLARE_ANALYTICS_TOKEN`, y el panel te avisará antes de que los límites diarios del plan gratuito bloqueen solicitudes.
- **Respalda tus datos:** `npx pnpm db:backup` exporta la base de datos a un archivo. D1 también guarda 7 días de historial en el plan gratuito (30 con Workers Paid).
- **Despliega con cada push:** haz un fork del repositorio y añade los datos de tu cuenta de Cloudflare como secretos del repositorio. [`lite-deploy.yml`](.github/workflows/lite-deploy.yml) los enumera.

¿Usas Claude Code? El [plugin de openpurr](plugin/) (en inglés) te guía por los mismos pasos, además de la configuración de App Store Connect y Play Console.

## Contribuir

Consulta [CONTRIBUTING.md](CONTRIBUTING.md) (en inglés). Ahora mismo, la ayuda más útil son los comentarios en issues: suposiciones erróneas sobre los SDK o las tiendas, y casos límite reales.

Para cualquier otra cosa, escribe a [hello@openpurr.org](mailto:hello@openpurr.org).

## Historial de estrellas

<a href="https://www.star-history.com/?repos=openpurr%2Fopenpurr&type=timeline&legend=bottom-right">
 <picture>
   <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/chart?repos=openpurr/openpurr&type=date&theme=dark&legend=bottom-right" />
   <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/chart?repos=openpurr/openpurr&type=date&legend=bottom-right" />
   <img alt="Gráfico del historial de estrellas" src="https://api.star-history.com/chart?repos=openpurr/openpurr&type=date&legend=bottom-right" />
 </picture>
</a>

## Licencia

[Apache License 2.0](LICENSE). Copyright 2026 colaboradores de openpurr.
