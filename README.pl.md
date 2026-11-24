<!-- translated-from: README.md sha256:576cb367384b5532 -->
<h1 align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset=".github/assets/openpurr-logo-dark.png">
    <img src=".github/assets/openpurr-logo.png" alt="openpurr" width="400">
  </picture>
</h1>

<!-- languages -->
<p align="center"><a href="README.md">English</a> · <a href="README.de.md">Deutsch</a> · <a href="README.es.md">Español</a> · <a href="README.fr.md">Français</a> · <a href="README.it.md">Italiano</a> · <a href="README.nl.md">Nederlands</a> · <b>Polski</b> · <a href="README.pt-BR.md">Português (Brasil)</a> · <a href="README.tr.md">Türkçe</a> · <a href="README.id.md">Bahasa Indonesia</a> · <a href="README.vi.md">Tiếng Việt</a> · <a href="README.ar.md">العربية</a> · <a href="README.hi.md">हिन्दी</a> · <a href="README.ja.md">日本語</a> · <a href="README.ko.md">한국어</a> · <a href="README.zh-CN.md">简体中文</a> · <a href="README.zh-TW.md">繁體中文</a></p>
<!-- /languages -->

Otwartoźródłowy backend, alternatywa dla RevenueCat, którą hostujesz samodzielnie.

Korzystając z otwartoźródłowych Purchases SDK od RevenueCat, kierujesz `Purchases.proxyURL` swojej aplikacji na własny serwer. openpurr weryfikuje zakupy z App Store i Google Play, śledzi entitlementy, odbiera powiadomienia ze sklepów, wysyła webhooki do twojego backendu i pokazuje na wykresach najważniejsze wskaźniki subskrypcji. Działa na infrastrukturze, którą kontrolujesz.

openpurr to niezależny projekt. Nie jest powiązany z RevenueCat, Inc. ani przez nią wspierany.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset=".github/assets/openpurr-dashboard-demo-dark.webp">
  <img src=".github/assets/openpurr-dashboard-demo.webp" alt="Wykresy w panelu openpurr Lite, przeklikane z podpowiedziami: MRR, Zmiany MRR, Przychody, Aktywne subskrypcje, Churn">
</picture>

## Dla kogo

Dla twórców aplikacji, którzy:

- **Chcą mieć kontrolę nad własną infrastrukturą zakupów.** Historia zakupów, entitlementy i dane dostępowe do sklepów są na serwerach, które sam utrzymujesz, w bazie danych, którą możesz odpytywać, backupować i eksportować. Między twoją aplikacją a klientami nie stoi żadna zewnętrzna usługa.
- **Nie chcą oddawać części przychodów.** openpurr nie pobiera prowizji od przychodów ani opłat za transakcję. Edycja Lite została zaprojektowana tak, by mieścić się w darmowym planie Cloudflare, więc mała aplikacja może z niej korzystać za darmo.
- **Nie chcą uzależniać się od komercyjnej usługi.** To open source: możesz czytać kod, zmieniać go i przenosić między Cloudflare a własną chmurą.

To dobry wybór także wtedy, gdy już używasz SDK od RevenueCat i chcesz przy nich zostać. openpurr działa z oficjalnymi, niezmodyfikowanymi SDK, więc przejście zaczyna się od zmiany jednego URL-a, a nie od przepisywania kodu zakupów. Jak przenieść obecnych klientów, opisuje strona [Przejście z RevenueCat](https://openpurr.org/pl/migrate-from-revenuecat/).

**Może jeszcze nie być dla ciebie**, jeśli potrzebujesz kreatora paywalli, integracji z zewnętrzną analityką albo umowy wsparcia. Komercyjne platformy oferują to już dziś. Co się pojawi, znajdziesz na [roadmapie](ROADMAP.md) (po angielsku).

## Co potrafi

- **Zakupy:** weryfikuje transakcje StoreKit 2 i zakupy w Google Play oraz zwraca `CustomerInfo` i entitlementy, których oczekuje SDK.
- **Powiadomienia ze sklepów:** odbiera App Store Server Notifications V2 i Google Play Real-time Developer Notifications.
- **Webhooki:** wysyła do twojego backendu zdarzenia w formacie RevenueCat, podpisane HMAC-SHA256 i ponawiane przez około 72 godziny.
- **Wykresy:** 16 wykresów w panelu, z filtrami według projektu, aplikacji, sklepu, produktu i środowiska oraz eksportem do CSV:
  - **Przychody:** przychody, zwroty, wskaźnik zwrotów i zakupy poza subskrypcjami.
  - **Przychody cykliczne:** MRR, ARR i zmiany MRR.
  - **Subskrypcje:** aktywne subskrypcje, płatne subskrypcje, zmiany subskrypcji, status subskrypcji i churn.
  - **Okresy próbne:** aktywne okresy próbne, nowe okresy próbne i zmiany okresów próbnych.
  - **Klienci:** nowi klienci.
- **Uwierzytelnianie:** klucze SDK i klucze tajne, logowanie operatorów (hasło z opcjonalnymi kodami z aplikacji uwierzytelniającej; Cloudflare Access jest w planach), role i dziennik audytu.
- **Serwer MCP i skille Claude:** asystent AI może wyszukiwać klientów, wyjaśniać, dlaczego ktoś ma lub nie ma danego entitlementu, i przeprowadzić cię przez konfigurację App Store i Play Console.

**Na razie poza zakresem:** paywalle, zdarzenia reklamowe, Customer Center, waluty wirtualne, płatności webowe, Amazon i integracje z zewnętrzną analityką. Eksperymenty cenowe są wbudowane: zobacz [przewodnik](docs/price-experiments.md) (po angielsku).

## Dwie edycje

| | Lite | Standard |
|---|---|---|
| Język | TypeScript | Go |
| Działa na | Cloudflare Workers + D1 | Kontenery + Postgres na GCP, AWS lub DigitalOcean |
| Koszt | Zaprojektowana pod darmowy plan Cloudflare | Twój rachunek za chmurę |
| Dla kogo | Aplikacje indie: lekka i tania w utrzymaniu | Większe portfele aplikacji |

Obie edycje przechodzą ten sam zestaw testów zgodności w `spec/`. Możesz przejść z Lite na Standard bez wydawania aktualizacji aplikacji, o ile twoja aplikacja łączy się z własną domeną: zobacz [Przejście z Lite na Standard](docs/migrating-from-lite-to-standard.md) (po angielsku).

## Ile zatrzymujesz w porównaniu z RevenueCat

Plan Pro w RevenueCat jest darmowy poniżej 2500 USD śledzonych przychodów miesięcznie, a potem kosztuje 1% całości. Lite działa w darmowym planie Cloudflare, a gdy aplikacja z niego wyrośnie, w planie Workers Paid od 5 USD miesięcznie.

<a href="https://openpurr.org/pl/#savings">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset=".github/assets/openpurr-savings-dark.webp">
    <img src=".github/assets/openpurr-savings.webp" alt="Kalkulator oszczędności: gdy przychód miesięczny rośnie do 250 000 USD, miesięczny koszt RevenueCat rośnie, a koszt openpurr Lite pozostaje bliski zera">
  </picture>
</a>

| Przychód miesięczny | RevenueCat, miesięcznie | openpurr Lite, miesięcznie | Oszczędność rocznie |
|---|--:|--:|--:|
| 2000 USD | 0 USD | 0 USD | **0 USD** |
| 5000 USD | 50 USD | 0 USD | **600 USD** |
| 10 000 USD | 100 USD | 0 USD | **1200 USD** |
| 25 000 USD | 250 USD | 5 USD | **2940 USD** |
| 50 000 USD | 500 USD | 5 USD | **5939 USD** |
| 100 000 USD | 1000 USD | 9 USD | **11 896 USD** |
| 250 000 USD | 2500 USD | 20 USD | **29 764 USD** |

Szacunki, ceny sprawdzone 21 listopada 2026. Zakładają około 1,50 USD przychodu miesięcznego i 10 zapytań SDK dziennie na dziennie aktywnego użytkownika, więc przejście na Workers Paid następuje przy około 11 250 USD miesięcznie. [Policz dla swoich liczb](https://openpurr.org/pl/#savings).

## Zgodność z SDK

Od pierwszego dnia używasz oficjalnych, niezmodyfikowanych SDK (wszystkie na licencji MIT):

| SDK | Jak skierować je na openpurr |
|---|---|
| iOS | `Purchases.proxyURL = URL(string: "https://purchases.example.com")` |
| Android | `Purchases.proxyURL = URL("https://purchases.example.com")` |
| Flutter, React Native | `Purchases.setProxyURL("https://purchases.example.com")` |

Ustaw URL proxy przed wywołaniem `configure`. Weryfikację entitlementów zostaw w domyślnym ustawieniu (wyłączona), bo podpisane odpowiedzi opierają się na własnym kluczu RevenueCat.

**Znana luka na Androidzie:** SDK wysyła ruch diagnostyczny, paywalli i reklam bezpośrednio do trzech hostów RevenueCat, nawet gdy URL proxy jest ustawiony. openpurr wyłącza diagnostykę przez zdalną konfigurację. Nie używaj paywalli RevenueCatUI ani reklam na Androidzie z openpurr.

## Planowana struktura repozytorium

```
spec/       language-neutral contract: OpenAPI, JSON schemas, fixtures, conformance suite
lite/       Lite edition: lightweight, for indie apps on Cloudflare Workers (TypeScript)
standard/   Standard edition: for larger app portfolios on GCP, AWS or DigitalOcean (Go)
cli/        `npx @openpurr/cli` (works with either edition)
skills/     Claude Code plugin
examples/   sample apps
infra/      Terraform/OpenTofu modules for GCP, AWS and DigitalOcean
```

## Pierwsze kroki

openpurr ma wersję 0.4.0, więc przed 1.0 spodziewaj się zmian. Żeby wypróbować go na własnym koncie Cloudflare (darmowy plan wystarczy), z Node 22.12 lub nowszym:

```sh
git clone https://github.com/openpurr/openpurr && cd openpurr
npx pnpm install
cd lite && npx wrangler login
npx pnpm run setup      # database, both Workers, operator secret and your owner account
```

Konfigurację można bezpiecznie uruchomić ponownie, jeśli przerwie się w połowie. Kończy się linkiem do panelu, który otwiera się na dodawaniu pierwszej aplikacji: jej bundle ID i nazwy pakietu, a potem produktów, entitlementów i ofert. Jedno wdrożenie może obsługiwać kilka aplikacji jako osobne projekty, każdy z własnymi klientami. Potem:

- **Sprawdź konfigurację:** uruchom `npx @openpurr/cli login`, a potem `npx @openpurr/cli doctor`. Pokazuje, czego brakuje i jak naprawić każdy element.
- **Włącz alerty o zużyciu:** dodaj token API Cloudflare z uprawnieniem Account Analytics: Read jako sekret `CLOUDFLARE_ANALYTICS_TOKEN`, a panel ostrzeże cię, zanim dzienne limity darmowego planu zaczną blokować żądania.
- **Rób backup danych:** `npx pnpm db:backup` eksportuje bazę danych do pliku. D1 przechowuje też 7 dni historii w darmowym planie (30 w Workers Paid).
- **Wdrażaj przy każdym pushu:** zrób fork repozytorium i dodaj dane Cloudflare jako sekrety repozytorium. Ich listę znajdziesz w [`lite-deploy.yml`](.github/workflows/lite-deploy.yml).

Używasz Claude Code? [Plugin openpurr](plugin/) (po angielsku) przeprowadzi cię przez te same kroki, a także przez konfigurację App Store Connect i Play Console.

W przypadku Standard skorzystaj z przewodnika dla swojej chmury: [GCP](docs/standard-on-gcp.md), [AWS](docs/standard-on-aws.md) lub [DigitalOcean](docs/standard-on-digitalocean.md) (po angielsku). Każdy wdraża za pomocą szablonu OpenTofu z `infra/`.

## Współtworzenie

Zobacz [CONTRIBUTING.md](CONTRIBUTING.md) (po angielsku). Najbardziej przyda się teraz feedback w issues: błędne założenia dotyczące SDK lub sklepów oraz prawdziwe przypadki brzegowe.

W innych sprawach napisz na [hello@openpurr.org](mailto:hello@openpurr.org).

## Historia gwiazdek

<a href="https://www.star-history.com/?repos=openpurr%2Fopenpurr&type=timeline&legend=bottom-right">
 <picture>
   <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/chart?repos=openpurr/openpurr&type=date&theme=dark&legend=bottom-right" />
   <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/chart?repos=openpurr/openpurr&type=date&legend=bottom-right" />
   <img alt="Wykres historii gwiazdek" src="https://api.star-history.com/chart?repos=openpurr/openpurr&type=date&legend=bottom-right" />
 </picture>
</a>

## Licencja

[Apache License 2.0](LICENSE). Copyright 2026 współtwórcy openpurr.
