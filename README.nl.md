<!-- translated-from: README.md sha256:51ff71c4d2f67d7f -->
<h1 align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset=".github/assets/openpurr-logo-dark.png">
    <img src=".github/assets/openpurr-logo.png" alt="openpurr" width="400">
  </picture>
</h1>

<!-- languages -->
<p align="center"><a href="README.md">English</a> · <a href="README.de.md">Deutsch</a> · <a href="README.es.md">Español</a> · <a href="README.fr.md">Français</a> · <a href="README.it.md">Italiano</a> · <b>Nederlands</b> · <a href="README.pl.md">Polski</a> · <a href="README.pt-BR.md">Português (Brasil)</a> · <a href="README.tr.md">Türkçe</a> · <a href="README.id.md">Bahasa Indonesia</a> · <a href="README.vi.md">Tiếng Việt</a> · <a href="README.ar.md">العربية</a> · <a href="README.hi.md">हिन्दी</a> · <a href="README.ja.md">日本語</a> · <a href="README.ko.md">한국어</a> · <a href="README.zh-CN.md">简体中文</a> · <a href="README.zh-TW.md">繁體中文</a></p>
<!-- /languages -->

Een self-hosted, open-source backend als alternatief voor RevenueCat.

Met de open-source Purchases SDK's van RevenueCat richt je `Purchases.proxyURL` van je app op je eigen server. openpurr valideert aankopen uit de App Store en Google Play, houdt entitlements bij, ontvangt store-meldingen, stuurt webhooks naar je backend en toont je belangrijkste abonnementscijfers in grafieken. Het draait op infrastructuur die je zelf beheert.

openpurr is een onafhankelijk project. Het is niet verbonden aan en wordt niet onderschreven door RevenueCat, Inc.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset=".github/assets/openpurr-dashboard-demo-dark.webp">
  <img src=".github/assets/openpurr-dashboard-demo.webp" alt="De grafieken in het dashboard van openpurr Lite, doorgeklikt met tooltips: MRR, MRR-verloop, Omzet, Actieve abonnementen, Churn">
</picture>

## Voor wie

App-ontwikkelaars die:

- **hun eigen aankoopinfrastructuur willen beheren.** Je aankoopgegevens, entitlements en store-inloggegevens staan op servers die je zelf draait, in een database die je kunt bevragen, back-uppen en exporteren. Er zit geen externe dienst tussen je app en je klanten.
- **geen percentage van hun omzet willen afstaan.** openpurr heeft geen omzetaandeel en geen kosten per transactie. De Lite-editie is ontworpen voor het gratis abonnement van Cloudflare, zodat een kleine app hem kosteloos kan draaien.
- **niet afhankelijk willen zijn van een commerciële dienst.** Het is open source: je kunt de code lezen, aanpassen en verhuizen tussen Cloudflare en je eigen cloud.

Het past ook goed als je de RevenueCat SDK's al gebruikt en wilt houden. openpurr werkt met de officiële, ongewijzigde SDK's, dus overstappen begint met het wijzigen van één URL, niet met het herschrijven van je aankoopcode. Hoe je je bestaande klanten meeneemt, lees je in [Overstappen van RevenueCat](https://openpurr.org/nl/migrate-from-revenuecat/).

**Misschien is het (nog) niets voor jou** als je paywall-builders, analytics-integraties van derden of een supportcontract nodig hebt. Commerciële platforms bieden dat vandaag al. Wat eraan komt, staat in de [roadmap](ROADMAP.md) (Engels).

## Wat het doet

- **Aankopen:** valideert StoreKit 2-transacties en Google Play-aankopen, en geeft de `CustomerInfo` en entitlements terug die de SDK verwacht.
- **Store-meldingen:** ontvangt App Store Server Notifications V2 en Google Play Real-time Developer Notifications.
- **Webhooks:** stuurt events in het formaat van RevenueCat naar je backend, ondertekend met HMAC-SHA256 en ongeveer 72 uur lang opnieuw verstuurd.
- **Grafieken:** 16 grafieken in het dashboard, te filteren op project, app, store, product en omgeving, en te downloaden als CSV:
  - **Omzet:** omzet, terugbetalingen, terugbetalingspercentage en aankopen zonder abonnement.
  - **Terugkerende omzet:** MRR, ARR en MRR-verloop.
  - **Abonnementen:** actieve abonnementen, betaalde abonnementen, abonnementsverloop, abonnementsstatus en churn.
  - **Proefperiodes:** actieve proefperiodes, nieuwe proefperiodes en proefperiodeverloop.
  - **Klanten:** nieuwe klanten.
- **Toegang:** SDK-sleutels en geheime sleutels, aanmelden voor beheerders (wachtwoord met optionele authenticatorcodes; Cloudflare Access is gepland), rollen en een auditlog.
- **MCP-server en Claude-skills:** een AI-assistent kan klanten opzoeken, uitleggen waarom iemand wel of geen entitlement heeft, en je door de inrichting van de App Store en de Play Console leiden.

**Voorlopig buiten scope:** paywalls, advertentie-events, Customer Center, virtuele valuta, webbetalingen, Amazon en analytics-integraties van derden. Prijsexperimenten zijn ingebouwd: zie de [handleiding](docs/price-experiments.md) (Engels).

## Twee edities

| | Lite | Standard |
|---|---|---|
| Taal | TypeScript | Go |
| Draait op | Cloudflare Workers + D1 | Containers + Postgres op GCP of AWS |
| Kosten | Ontworpen voor het gratis abonnement van Cloudflare | Je cloudrekening |
| Voor | Indie-apps: lichtgewicht en goedkoop in gebruik | Grotere portfolio's van apps (binnenkort) |

Beide edities doorstaan dezelfde conformiteitstests in `spec/`. Je kunt zonder app-update overstappen van Lite naar Standard, zolang je app naar een eigen domein wijst dat van jou is.

## Wat je overhoudt ten opzichte van RevenueCat

Het Pro-abonnement van RevenueCat is gratis onder $ 2.500 bijgehouden omzet per maand en rekent daarna 1% van alles. Lite draait op het gratis abonnement van Cloudflare, en op Workers Paid, vanaf $ 5 per maand, zodra je app daar overheen groeit.

<a href="https://openpurr.org/nl/#savings">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset=".github/assets/openpurr-savings-dark.webp">
    <img src=".github/assets/openpurr-savings.webp" alt="De besparingscalculator: als de maandomzet stijgt tot $ 250.000, lopen de maandkosten bij RevenueCat op terwijl die van openpurr Lite bijna nul blijven">
  </picture>
</a>

| Maandelijkse omzet | RevenueCat, per maand | openpurr Lite, per maand | Bespaard per jaar |
|---|--:|--:|--:|
| US$ 2.000 | US$ 0 | US$ 0 | **US$ 0** |
| US$ 5.000 | US$ 50 | US$ 0 | **US$ 600** |
| US$ 10.000 | US$ 100 | US$ 0 | **US$ 1.200** |
| US$ 25.000 | US$ 250 | US$ 5 | **US$ 2.940** |
| US$ 50.000 | US$ 500 | US$ 5 | **US$ 5.939** |
| US$ 100.000 | US$ 1.000 | US$ 9 | **US$ 11.896** |
| US$ 250.000 | US$ 2.500 | US$ 20 | **US$ 29.764** |

Schattingen, met prijzen gecontroleerd op 21 november 2026. Ze gaan uit van ongeveer $ 1,50 maandomzet en 10 SDK-verzoeken per dag per dagelijks actieve gebruiker, waardoor de overstap naar Workers Paid rond US$ 11.250 per maand ligt. [Reken met je eigen cijfers](https://openpurr.org/nl/#savings).

## SDK-compatibiliteit

Vanaf dag één worden de officiële, ongewijzigde SDK's gebruikt (allemaal met MIT-licentie):

| SDK | Zo richt je hem op openpurr |
|---|---|
| iOS | `Purchases.proxyURL = URL(string: "https://purchases.example.com")` |
| Android | `Purchases.proxyURL = URL("https://purchases.example.com")` |
| Flutter, React Native | `Purchases.setProxyURL("https://purchases.example.com")` |

Stel de proxy-URL in voordat je `configure` aanroept. Laat de verificatie van entitlements op de standaardinstelling staan (uitgeschakeld), want ondertekende antwoorden zijn afhankelijk van de eigen sleutel van RevenueCat.

**Bekend gat op Android:** de SDK stuurt diagnostiek-, paywall- en advertentieverkeer rechtstreeks naar drie hosts van RevenueCat, ook als er een proxy-URL is ingesteld. openpurr zet diagnostiek uit via remote config. Gebruik op Android met openpurr geen RevenueCatUI-paywalls of advertenties.

## Geplande indeling van de repo

```
spec/       language-neutral contract: OpenAPI, JSON schemas, fixtures, conformance suite
lite/       Lite edition: lightweight, for indie apps on Cloudflare Workers (TypeScript)
standard/   Standard edition: for larger app portfolios on AWS or GCP (Go, coming soon)
cli/        `npx @openpurr/cli` (works with either edition)
skills/     Claude Code plugin
examples/   sample apps
infra/      Terraform/OpenTofu modules for GCP, AWS and DigitalOcean
```

## Aan de slag

Lite staat op 0.1.0, de eerste release, dus verwacht wijzigingen vóór 1.0. Om het uit te proberen in je eigen Cloudflare-account (het gratis abonnement is genoeg) heb je Node 22.12 of nieuwer nodig:

```sh
git clone https://github.com/openpurr/openpurr && cd openpurr
npx pnpm install
cd lite && npx wrangler login
npx pnpm run setup      # database, both Workers, operator secret and your owner account
```

Je kunt de setup veilig opnieuw draaien als hij halverwege stopt. Hij eindigt met een link naar het dashboard, dat opent bij het toevoegen van je eerste app: de bundle ID en package name, daarna producten, entitlements en offerings. Eén deployment kan meerdere apps draaien als aparte projecten, elk met eigen klanten. Daarna:

- **Controleer je setup:** voer `npx @openpurr/cli login` uit en daarna `npx @openpurr/cli doctor`. Het meldt wat er ontbreekt en hoe je elk punt oplost.
- **Ontvang gebruikswaarschuwingen:** voeg een Cloudflare API-token met Account Analytics: Read toe als het secret `CLOUDFLARE_ANALYTICS_TOKEN`, dan waarschuwt het dashboard je voordat de daglimieten van het gratis abonnement verzoeken tegenhouden.
- **Maak back-ups van je data:** `npx pnpm db:backup` exporteert de database naar een bestand. D1 bewaart op het gratis abonnement ook 7 dagen geschiedenis (30 met Workers Paid).
- **Rol uit bij elke push:** fork de repo en voeg je Cloudflare-gegevens toe als repository secrets. [`lite-deploy.yml`](.github/workflows/lite-deploy.yml) somt ze op.

Gebruik je Claude Code? De [openpurr-plugin](plugin/) (Engels) loopt dezelfde stappen met je door, plus de inrichting van App Store Connect en de Play Console.

## Bijdragen

Zie [CONTRIBUTING.md](CONTRIBUTING.md) (Engels). Waar we nu het meest aan hebben is feedback in issues: verkeerde aannames over de SDK's of de stores, en randgevallen uit de praktijk.

Voor al het andere kun je mailen naar [hello@openpurr.org](mailto:hello@openpurr.org).

## Star History

<a href="https://www.star-history.com/?repos=openpurr%2Fopenpurr&type=timeline&legend=bottom-right">
 <picture>
   <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/chart?repos=openpurr/openpurr&type=date&theme=dark&legend=bottom-right" />
   <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/chart?repos=openpurr/openpurr&type=date&legend=bottom-right" />
   <img alt="Grafiek van de Star History" src="https://api.star-history.com/chart?repos=openpurr/openpurr&type=date&legend=bottom-right" />
 </picture>
</a>

## Licentie

[Apache License 2.0](LICENSE). Copyright 2026 openpurr-bijdragers.
