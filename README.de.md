<!-- translated-from: README.md sha256:576cb367384b5532 -->
<h1 align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset=".github/assets/openpurr-logo-dark.png">
    <img src=".github/assets/openpurr-logo.png" alt="openpurr" width="400">
  </picture>
</h1>

<!-- languages -->
<p align="center"><a href="README.md">English</a> · <b>Deutsch</b> · <a href="README.es.md">Español</a> · <a href="README.fr.md">Français</a> · <a href="README.it.md">Italiano</a> · <a href="README.nl.md">Nederlands</a> · <a href="README.pl.md">Polski</a> · <a href="README.pt-BR.md">Português (Brasil)</a> · <a href="README.tr.md">Türkçe</a> · <a href="README.id.md">Bahasa Indonesia</a> · <a href="README.vi.md">Tiếng Việt</a> · <a href="README.ar.md">العربية</a> · <a href="README.hi.md">हिन्दी</a> · <a href="README.ja.md">日本語</a> · <a href="README.ko.md">한국어</a> · <a href="README.zh-CN.md">简体中文</a> · <a href="README.zh-TW.md">繁體中文</a></p>
<!-- /languages -->

Ein selbst gehostetes Open-Source-Backend als Alternative zu RevenueCat.

Mit den Open-Source-Purchases-SDKs von RevenueCat richtest du `Purchases.proxyURL` deiner App auf deinen eigenen Server. openpurr validiert Käufe aus dem App Store und von Google Play, verwaltet Entitlements, empfängt Store-Benachrichtigungen, sendet Webhooks an dein Backend und stellt deine wichtigsten Abo-Kennzahlen in Diagrammen dar. Es läuft auf Infrastruktur, die du kontrollierst.

openpurr ist ein unabhängiges Projekt. Es ist weder mit RevenueCat, Inc. verbunden noch von RevenueCat, Inc. unterstützt.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset=".github/assets/openpurr-dashboard-demo-dark.webp">
  <img src=".github/assets/openpurr-dashboard-demo.webp" alt="Die Diagramme im Dashboard von openpurr Lite, durchgeklickt mit Tooltips: MRR, MRR-Bewegung, Umsatz, Aktive Abos, Churn">
</picture>

## Für wen

Für App-Entwickler, die:

- **ihre Kauf-Infrastruktur selbst kontrollieren wollen.** Kaufdatensätze, Entitlements und Store-Zugangsdaten liegen auf Servern, die du betreibst, in einer Datenbank, die du abfragen, sichern und exportieren kannst. Kein externer Dienst steht zwischen deiner App und deinen Kunden.
- **keinen Anteil ihres Umsatzes abgeben wollen.** openpurr hat keine Umsatzbeteiligung und keine Gebühren pro Transaktion. Die Lite-Edition ist für den kostenlosen Cloudflare-Tarif ausgelegt, sodass eine kleine App sie kostenlos betreiben kann.
- **nicht von einem kommerziellen Dienst abhängig sein wollen.** Es ist Open Source: Du kannst den Code lesen, ändern und damit zwischen Cloudflare und deiner eigenen Cloud umziehen.

Es passt auch gut, wenn du die RevenueCat SDKs schon nutzt und behalten willst. openpurr funktioniert mit den offiziellen, unveränderten SDKs. Der Umstieg beginnt also mit einer geänderten URL, nicht mit neu geschriebenem Kaufcode. Wie du deine bestehenden Kunden mitnimmst, steht unter [Umstieg von RevenueCat](https://openpurr.org/de/migrate-from-revenuecat/).

**Vielleicht ist es (noch) nichts für dich**, wenn du Paywall-Builder, Analytics-Integrationen von Drittanbietern oder einen Supportvertrag brauchst. Kommerzielle Plattformen bieten das heute schon. Was kommt, steht in der [Roadmap](ROADMAP.md) (Englisch).

## Was es kann

- **Käufe:** validiert StoreKit-2-Transaktionen und Google-Play-Käufe und liefert die `CustomerInfo` und Entitlements, die das SDK erwartet.
- **Store-Benachrichtigungen:** empfängt App Store Server Notifications V2 und Google Play Real-time Developer Notifications.
- **Webhooks:** sendet Ereignisse im Format von RevenueCat an dein Backend, signiert mit HMAC-SHA256 und etwa 72 Stunden lang erneut zugestellt.
- **Diagramme:** 16 Diagramme im Dashboard, filterbar nach Projekt, App, Store, Produkt und Umgebung und als CSV herunterladbar:
  - **Umsatz:** Umsatz, Erstattungen, Erstattungsquote und Käufe ohne Abo.
  - **Wiederkehrender Umsatz:** MRR, ARR und MRR-Bewegung.
  - **Abos:** aktive Abos, bezahlte Abos, Abo-Bewegung, Abo-Status und Churn.
  - **Testphasen:** aktive Testphasen, neue Testphasen und Testphasen-Bewegung.
  - **Kunden:** Neukunden.
- **Anmeldung:** SDK-Keys und Secret Keys, Anmeldung für Betreiber (Passwort mit optionalen Authenticator-Codes; Cloudflare Access ist geplant), Rollen und ein Audit-Log.
- **MCP-Server und Claude-Skills:** Ein KI-Assistent kann Kunden nachschlagen, erklären, warum jemand ein Entitlement hat oder nicht, und dich durch die Einrichtung in App Store und Play Console führen.

**Vorerst nicht vorgesehen:** Paywalls, Werbeereignisse, Customer Center, virtuelle Währungen, Web-Billing, Amazon und Analytics-Integrationen von Drittanbietern. Preisexperimente sind eingebaut: siehe die [Anleitung](docs/price-experiments.md) (Englisch).

## Zwei Editionen

| | Lite | Standard |
|---|---|---|
| Sprache | TypeScript | Go |
| Läuft auf | Cloudflare Workers + D1 | Containern + Postgres auf GCP, AWS oder DigitalOcean |
| Kosten | Für den kostenlosen Cloudflare-Tarif ausgelegt | Deine Cloud-Rechnung |
| Für | Indie-Apps: leichtgewichtig und günstig im Betrieb | Größere App-Portfolios |

Beide Editionen bestehen dieselbe Konformitäts-Testsuite in `spec/`. Du kannst ohne App-Update von Lite zu Standard wechseln, solange deine App auf eine eigene Domain zeigt, die dir gehört: siehe [Von Lite zu Standard wechseln](docs/migrating-from-lite-to-standard.md) (Englisch).

## Was Sie im Vergleich zu RevenueCat behalten

Der Pro-Tarif von RevenueCat ist unter 2.500 $ erfasstem Umsatz im Monat kostenlos und kostet danach 1 % des gesamten Umsatzes. Lite läuft im kostenlosen Cloudflare-Tarif und mit Workers Paid ab 5 $ im Monat, wenn Ihre App darüber hinauswächst.

<a href="https://openpurr.org/de/#savings">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset=".github/assets/openpurr-savings-dark.webp">
    <img src=".github/assets/openpurr-savings.webp" alt="Der Ersparnisrechner: Steigt der Monatsumsatz auf 250.000 $, wachsen die monatlichen Kosten bei RevenueCat, während sie bei openpurr Lite nahe null bleiben">
  </picture>
</a>

| Monatlicher Umsatz | RevenueCat, monatlich | openpurr Lite, monatlich | Ersparnis pro Jahr |
|---|--:|--:|--:|
| 2.000 $ | 0 $ | 0 $ | **0 $** |
| 5.000 $ | 50 $ | 0 $ | **600 $** |
| 10.000 $ | 100 $ | 0 $ | **1.200 $** |
| 25.000 $ | 250 $ | 5 $ | **2.940 $** |
| 50.000 $ | 500 $ | 5 $ | **5.939 $** |
| 100.000 $ | 1.000 $ | 9 $ | **11.896 $** |
| 250.000 $ | 2.500 $ | 20 $ | **29.764 $** |

Schätzungen, Preise geprüft am 21. November 2026. Angenommen sind etwa 1,50 $ Monatsumsatz und 10 SDK-Anfragen am Tag pro täglich aktivem Nutzer. Damit lohnt sich Workers Paid ab etwa 11.250 $ im Monat. [Mit eigenen Zahlen rechnen](https://openpurr.org/de/#savings).

## SDK-Kompatibilität

Von Anfang an werden die offiziellen, unveränderten SDKs genutzt (alle unter MIT-Lizenz):

| SDK | So richtest du es auf openpurr |
|---|---|
| iOS | `Purchases.proxyURL = URL(string: "https://purchases.example.com")` |
| Android | `Purchases.proxyURL = URL("https://purchases.example.com")` |
| Flutter, React Native | `Purchases.setProxyURL("https://purchases.example.com")` |

Setze die Proxy-URL, bevor du `configure` aufrufst. Lass die Entitlement-Verifizierung auf der Standardeinstellung (deaktiviert), denn signierte Antworten beruhen auf dem eigenen Schlüssel von RevenueCat.

**Bekannte Lücke unter Android:** Das SDK sendet Diagnose-, Paywall- und Werbe-Traffic direkt an drei Hosts von RevenueCat, auch wenn eine Proxy-URL gesetzt ist. openpurr schaltet die Diagnose per Remote Config ab. Nutze unter Android mit openpurr keine RevenueCatUI-Paywalls und keine Werbung.

## Geplante Repo-Struktur

```
spec/       language-neutral contract: OpenAPI, JSON schemas, fixtures, conformance suite
lite/       Lite edition: lightweight, for indie apps on Cloudflare Workers (TypeScript)
standard/   Standard edition: for larger app portfolios on GCP, AWS or DigitalOcean (Go)
cli/        `npx @openpurr/cli` (works with either edition)
skills/     Claude Code plugin
examples/   sample apps
infra/      Terraform/OpenTofu modules for GCP, AWS and DigitalOcean
```

## Erste Schritte

openpurr steht bei 0.4.0, rechne also mit Änderungen vor 1.0. Um es in deinem eigenen Cloudflare-Konto auszuprobieren (der kostenlose Tarif reicht), brauchst du Node 22.12 oder neuer:

```sh
git clone https://github.com/openpurr/openpurr && cd openpurr
npx pnpm install
cd lite && npx wrangler login
npx pnpm run setup      # database, both Workers, operator secret and your owner account
```

Du kannst das Setup gefahrlos erneut ausführen, falls es mittendrin abbricht. Am Ende steht ein Link zum Dashboard, das mit dem Anlegen deiner ersten App beginnt: Bundle ID und Package Name, dann Produkte, Entitlements und Offerings. Ein Deployment kann mehrere Apps als getrennte Projekte betreiben, jedes mit eigenen Kunden. Danach:

- **Setup prüfen:** Führe `npx @openpurr/cli login` und dann `npx @openpurr/cli doctor` aus. Es meldet, was fehlt und wie du jeden Punkt behebst.
- **Nutzungswarnungen erhalten:** Lege ein Cloudflare-API-Token mit der Berechtigung Account Analytics: Read als Secret `CLOUDFLARE_ANALYTICS_TOKEN` an, dann warnt dich das Dashboard, bevor die Tageslimits des kostenlosen Tarifs Anfragen blockieren.
- **Daten sichern:** `npx pnpm db:backup` exportiert die Datenbank in eine Datei. D1 bewahrt außerdem im kostenlosen Tarif 7 Tage Verlauf auf (30 mit Workers Paid).
- **Bei jedem Push bereitstellen:** Forke das Repo und hinterlege deine Cloudflare-Daten als Repository-Secrets. [`lite-deploy.yml`](.github/workflows/lite-deploy.yml) führt sie auf.

Du nutzt Claude Code? Das [openpurr-Plugin](plugin/) (Englisch) führt durch dieselben Schritte, dazu durch die Einrichtung in App Store Connect und der Play Console.

Für Standard folgst du der Anleitung für deine Cloud: [GCP](docs/standard-on-gcp.md), [AWS](docs/standard-on-aws.md) oder [DigitalOcean](docs/standard-on-digitalocean.md) (Englisch). Jede setzt eine OpenTofu-Vorlage aus `infra/` ein.

## Mitmachen

Siehe [CONTRIBUTING.md](CONTRIBUTING.md) (Englisch). Am meisten hilft gerade Feedback in Issues: falsche Annahmen über die SDKs oder die Stores und echte Sonderfälle aus der Praxis.

Für alles andere schreib an [hello@openpurr.org](mailto:hello@openpurr.org).

## Star History

<a href="https://www.star-history.com/?repos=openpurr%2Fopenpurr&type=timeline&legend=bottom-right">
 <picture>
   <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/chart?repos=openpurr/openpurr&type=date&theme=dark&legend=bottom-right" />
   <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/chart?repos=openpurr/openpurr&type=date&legend=bottom-right" />
   <img alt="Diagramm der Star History" src="https://api.star-history.com/chart?repos=openpurr/openpurr&type=date&legend=bottom-right" />
 </picture>
</a>

## Lizenz

[Apache License 2.0](LICENSE). Copyright 2026 openpurr-Mitwirkende.
