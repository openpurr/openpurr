<!-- translated-from: README.md sha256:8dbb0e93d652582d -->
<h1 align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset=".github/assets/openpurr-logo-dark.png">
    <img src=".github/assets/openpurr-logo.png" alt="openpurr" width="400">
  </picture>
</h1>

<!-- languages -->
<p align="center"><a href="README.md">English</a> · <a href="README.de.md">Deutsch</a> · <a href="README.es.md">Español</a> · <a href="README.fr.md">Français</a> · <b>Italiano</b> · <a href="README.nl.md">Nederlands</a> · <a href="README.pl.md">Polski</a> · <a href="README.pt-BR.md">Português (Brasil)</a> · <a href="README.tr.md">Türkçe</a> · <a href="README.id.md">Bahasa Indonesia</a> · <a href="README.vi.md">Tiếng Việt</a> · <a href="README.ar.md">العربية</a> · <a href="README.hi.md">हिन्दी</a> · <a href="README.ja.md">日本語</a> · <a href="README.ko.md">한국어</a> · <a href="README.zh-CN.md">简体中文</a> · <a href="README.zh-TW.md">繁體中文</a></p>
<!-- /languages -->

Un backend open source e self-hosted, alternativo a RevenueCat.

Con i Purchases SDK open source di RevenueCat, punta il `Purchases.proxyURL` della tua app al tuo server. openpurr convalida gli acquisti dell'App Store e di Google Play, tiene traccia degli entitlement, riceve le notifiche degli store, invia webhook al tuo backend e mostra in grafici le principali metriche degli abbonamenti. Gira su un'infrastruttura che controlli tu.

openpurr è un progetto indipendente, non affiliato né approvato da RevenueCat, Inc.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset=".github/assets/openpurr-dashboard-demo-dark.webp">
  <img src=".github/assets/openpurr-dashboard-demo.webp" alt="I grafici della dashboard di openpurr Lite, sfogliati con i tooltip: MRR, Andamento dell'MRR, Ricavi, Abbonamenti attivi, Churn">
</picture>

## Per chi è

Per chi sviluppa app e:

- **Vuole controllare la propria infrastruttura per gli acquisti.** I record degli acquisti, gli entitlement e le credenziali degli store stanno su server che gestisci tu, in un database che puoi interrogare, salvare ed esportare. Nessun servizio esterno si mette tra la tua app e i tuoi clienti.
- **Non vuole cedere una percentuale dei ricavi.** openpurr non trattiene quote dei ricavi e non applica commissioni per transazione. L'edizione Lite è pensata per stare nel piano gratuito di Cloudflare, quindi una piccola app può usarla senza spendere nulla.
- **Non vuole dipendere da un servizio commerciale.** È open source: puoi leggere il codice, modificarlo e spostarlo tra Cloudflare e il tuo cloud.

Fa al caso tuo anche se usi già gli SDK di RevenueCat e vuoi continuare a usarli. openpurr funziona con gli SDK ufficiali, senza modifiche, quindi per passare a openpurr si comincia cambiando un URL, non riscrivendo il codice di acquisto. Per portare i clienti esistenti, leggi [Migrare da RevenueCat](https://openpurr.org/it/migrate-from-revenuecat/).

**Potrebbe non fare (ancora) per te** se ti servono editor di paywall, esperimenti A/B, integrazioni con strumenti di analytics di terze parti o un contratto di assistenza. Le piattaforme commerciali li offrono già oggi. Consulta la [roadmap](ROADMAP.md) (in inglese) per sapere cosa arriverà.

## Cosa fa

- **Acquisti:** convalida le transazioni StoreKit 2 e gli acquisti Google Play, e restituisce il `CustomerInfo` e gli entitlement che l'SDK si aspetta.
- **Notifiche degli store:** riceve le App Store Server Notifications V2 e le Real-time Developer Notifications di Google Play.
- **Webhook:** invia al tuo backend eventi nel formato di RevenueCat, firmati con HMAC-SHA256 e ritentati per circa 72 ore.
- **Grafici:** 16 grafici nella dashboard, filtrabili per progetto, app, store, prodotto e ambiente, ed esportabili in CSV:
  - **Ricavi:** ricavi, rimborsi, tasso di rimborso e acquisti non in abbonamento.
  - **Ricavi ricorrenti:** MRR, ARR e andamento dell'MRR.
  - **Abbonamenti:** abbonamenti attivi, abbonamenti a pagamento, andamento degli abbonamenti, stato degli abbonamenti e churn.
  - **Prove:** prove attive, nuove prove e andamento delle prove.
  - **Clienti:** nuovi clienti.
- **Autenticazione:** chiavi SDK e chiavi segrete, accesso degli operatori (password con codici di autenticazione facoltativi; Cloudflare Access è pianificato), ruoli e un registro di audit.
- **Server MCP e skill per Claude:** un assistente AI può cercare clienti, spiegare perché qualcuno ha o non ha un entitlement e guidarti nella configurazione dell'App Store e della Play Console.

**Per ora fuori ambito:** paywall, eventi pubblicitari, Customer Center, valute virtuali, pagamenti web, Amazon e integrazioni di analytics di terze parti. Gli esperimenti sui prezzi sono inclusi: vedi la [guida](docs/price-experiments.md) (in inglese).

## Due edizioni

| | Lite | Standard |
|---|---|---|
| Linguaggio | TypeScript | Go |
| Gira su | Cloudflare Workers + D1 | Container + Postgres su GCP o AWS |
| Costo | Pensata per stare nel piano gratuito di Cloudflare | La tua bolletta cloud |
| Per | App indipendenti: leggera ed economica da gestire | Portafogli di app più grandi (in arrivo) |

Entrambe le edizioni superano la stessa suite di test di conformità, in `spec/`. Puoi passare da Lite a Standard senza pubblicare un aggiornamento dell'app, purché la tua app punti a un dominio personalizzato di tua proprietà.

## Quanto tieni rispetto a RevenueCat

Il piano Pro di RevenueCat è gratuito sotto i 2.500 $ al mese di ricavi tracciati, poi costa l'1% di tutti i ricavi. Lite funziona sul piano gratuito di Cloudflare e, quando la tua app lo supera, su Workers Paid da 5 $ al mese.

<a href="https://openpurr.org/it/#savings">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset=".github/assets/openpurr-savings-dark.webp">
    <img src=".github/assets/openpurr-savings.webp" alt="Il calcolatore del risparmio: mentre i ricavi mensili salgono fino a 250.000 $, il costo mensile di RevenueCat cresce e quello di openpurr Lite resta vicino a zero">
  </picture>
</a>

| Ricavi mensili | RevenueCat, al mese | openpurr Lite, al mese | Risparmio all'anno |
|---|--:|--:|--:|
| 2000 USD | 0 USD | 0 USD | **0 USD** |
| 5000 USD | 50 USD | 0 USD | **600 USD** |
| 10.000 USD | 100 USD | 0 USD | **1200 USD** |
| 25.000 USD | 250 USD | 5 USD | **2940 USD** |
| 50.000 USD | 500 USD | 5 USD | **5939 USD** |
| 100.000 USD | 1000 USD | 9 USD | **11.896 USD** |
| 250.000 USD | 2500 USD | 20 USD | **29.764 USD** |

Stime, con prezzi verificati il 21 novembre 2026. Ipotizzano circa 1,50 $ di ricavi mensili e 10 richieste SDK al giorno per utente attivo giornaliero, quindi il passaggio a Workers Paid arriva intorno a 11.250 USD al mese. [Prova con i tuoi numeri](https://openpurr.org/it/#savings).

## Compatibilità con gli SDK

Fin dal primo giorno si usano gli SDK ufficiali, senza modifiche (tutti con licenza MIT):

| SDK | Come puntarlo a openpurr |
|---|---|
| iOS | `Purchases.proxyURL = URL(string: "https://purchases.example.com")` |
| Android | `Purchases.proxyURL = URL("https://purchases.example.com")` |
| Flutter, React Native | `Purchases.setProxyURL("https://purchases.example.com")` |

Imposta l'URL del proxy prima di chiamare `configure`. Lascia la verifica degli entitlement al valore predefinito (disattivata), perché le risposte firmate si basano sulla chiave di RevenueCat.

**Limite noto su Android:** l'SDK invia il traffico di diagnostica, dei paywall e degli annunci direttamente a tre host di RevenueCat, anche quando è impostato un URL del proxy. openpurr disattiva la diagnostica tramite la configurazione remota. Non usare i paywall o gli annunci di RevenueCatUI su Android con openpurr.

## Struttura prevista del repository

```
spec/       language-neutral contract: OpenAPI, JSON schemas, fixtures, conformance suite
lite/       Lite edition: lightweight, for indie apps on Cloudflare Workers (TypeScript)
standard/   Standard edition: for larger app portfolios on AWS or GCP (Go, coming soon)
cli/        `npx @openpurr/cli` (works with either edition)
skills/     Claude Code plugin
examples/   sample apps
infra/      Terraform/OpenTofu modules for GCP, AWS and DigitalOcean
```

## Per iniziare

Lite è alla versione 0.1.0, la sua prima release, quindi aspettati dei cambiamenti prima della 1.0. Per provarlo sul tuo account Cloudflare (basta il piano gratuito), con Node 22.12 o successivo:

```sh
git clone https://github.com/openpurr/openpurr && cd openpurr
npx pnpm install
cd lite && npx wrangler login
npx pnpm run setup      # database, both Workers, operator secret and your owner account
```

Puoi rieseguire la configurazione senza problemi se si interrompe a metà. Alla fine ti dà un link alla dashboard, che si apre sull'aggiunta della tua prima app: il suo bundle ID e il nome del pacchetto, poi prodotti, entitlement e offering. Un solo deployment può gestire più app come progetti separati, ognuno con i propri clienti. Dopo:

- **Controlla la configurazione:** esegui `npx @openpurr/cli login`, poi `npx @openpurr/cli doctor`. Il comando segnala cosa manca e come sistemare ogni punto.
- **Ricevi avvisi sull'utilizzo:** aggiungi un token API di Cloudflare con il permesso Account Analytics: Read come secret `CLOUDFLARE_ANALYTICS_TOKEN`, e la dashboard ti avvisa prima che i limiti giornalieri del piano gratuito blocchino le richieste.
- **Fai il backup dei dati:** `npx pnpm db:backup` esporta il database in un file. D1 conserva anche 7 giorni di cronologia con il piano gratuito (30 con Workers Paid).
- **Distribuisci a ogni push:** fai un fork del repository e aggiungi i tuoi dati di Cloudflare come secret del repository. [`lite-deploy.yml`](.github/workflows/lite-deploy.yml) li elenca.

Usi Claude Code? Il [plugin di openpurr](plugin/) (in inglese) ti guida negli stessi passaggi, più la configurazione di App Store Connect e della Play Console.

## Contribuire

Consulta [CONTRIBUTING.md](CONTRIBUTING.md) (in inglese). Al momento l'aiuto più utile è il feedback nelle issue: ipotesi sbagliate sugli SDK o sugli store, e casi limite reali.

Per tutto il resto, scrivi a [hello@openpurr.org](mailto:hello@openpurr.org).

## Cronologia delle stelle

<a href="https://www.star-history.com/?repos=openpurr%2Fopenpurr&type=timeline&legend=bottom-right">
 <picture>
   <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/chart?repos=openpurr/openpurr&type=date&theme=dark&legend=bottom-right" />
   <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/chart?repos=openpurr/openpurr&type=date&legend=bottom-right" />
   <img alt="Grafico della cronologia delle stelle" src="https://api.star-history.com/chart?repos=openpurr/openpurr&type=date&legend=bottom-right" />
 </picture>
</a>

## Licenza

[Licenza Apache 2.0](LICENSE). Copyright 2026 i contributori di openpurr.
