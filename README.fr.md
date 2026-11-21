<!-- translated-from: README.md sha256:2f5fb4fb0a81c338 -->
<h1 align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset=".github/assets/openpurr-logo-dark.png">
    <img src=".github/assets/openpurr-logo.png" alt="openpurr" width="400">
  </picture>
</h1>

<!-- languages -->
<p align="center"><a href="README.md">English</a> · <a href="README.de.md">Deutsch</a> · <a href="README.es.md">Español</a> · <b>Français</b> · <a href="README.it.md">Italiano</a> · <a href="README.nl.md">Nederlands</a> · <a href="README.pl.md">Polski</a> · <a href="README.pt-BR.md">Português (Brasil)</a> · <a href="README.tr.md">Türkçe</a> · <a href="README.id.md">Bahasa Indonesia</a> · <a href="README.vi.md">Tiếng Việt</a> · <a href="README.ar.md">العربية</a> · <a href="README.hi.md">हिन्दी</a> · <a href="README.ja.md">日本語</a> · <a href="README.ko.md">한국어</a> · <a href="README.zh-CN.md">简体中文</a> · <a href="README.zh-TW.md">繁體中文</a></p>
<!-- /languages -->

Un backend open source et auto-hébergé, alternative à RevenueCat.

Avec les SDK Purchases open source de RevenueCat, faites pointer le `Purchases.proxyURL` de votre application vers votre propre serveur. openpurr valide les achats App Store et Google Play, suit les entitlements, reçoit les notifications des stores, envoie des webhooks à votre backend et trace vos principaux indicateurs d'abonnement. Il tourne sur une infrastructure que vous contrôlez.

openpurr est un projet indépendant, sans lien avec RevenueCat, Inc. et non soutenu par cette société.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset=".github/assets/openpurr-dashboard-dark.png">
  <img src=".github/assets/openpurr-dashboard.png" alt="Le tableau de bord d'openpurr Lite, avec 12 mois d'évolution du MRR, les abonnements actifs, le churn, les nouveaux clients, les nouveaux essais et les essais en cours">
</picture>

## Pour qui

Les développeurs d'applications qui :

- **Veulent garder la main sur leur infrastructure d'achats.** Vos enregistrements d'achat, vos entitlements et les identifiants de vos stores sont sur des serveurs que vous gérez, dans une base de données que vous pouvez interroger, sauvegarder et exporter. Aucun service externe ne s'interpose entre votre application et vos clients.
- **Ne veulent pas reverser un pourcentage de leurs revenus.** openpurr ne prend aucune part des revenus et ne facture aucuns frais par transaction. L'édition Lite est conçue pour tenir dans l'offre gratuite de Cloudflare : une petite application peut la faire tourner sans rien payer.
- **Ne veulent pas dépendre d'un service commercial.** Le code est open source : vous pouvez le lire, le modifier et le déplacer entre Cloudflare et votre propre cloud.

openpurr convient aussi si vous utilisez déjà les SDK de RevenueCat et voulez les garder. Il fonctionne avec les SDK officiels, sans modification : pour migrer, vous commencez par changer une URL, pas par réécrire votre code d'achat. Pour transférer vos clients existants, consultez [Migrer depuis RevenueCat](https://openpurr.org/fr/migrate-from-revenuecat/).

**Ce n'est peut-être pas (encore) pour vous** si vous avez besoin d'un éditeur de paywalls, de tests A/B, d'intégrations analytiques tierces ou d'un contrat de support. Les plateformes commerciales les proposent dès aujourd'hui. Consultez la [feuille de route](ROADMAP.md) (en anglais) pour savoir ce qui arrive.

## Ce qu'il fait

- **Achats :** valide les transactions StoreKit 2 et les achats Google Play, et renvoie le `CustomerInfo` et les entitlements attendus par le SDK.
- **Notifications des stores :** reçoit les App Store Server Notifications V2 et les Real-time Developer Notifications de Google Play.
- **Webhooks :** envoie à votre backend des événements au format RevenueCat, signés en HMAC-SHA256 et renvoyés pendant environ 72 heures.
- **Graphiques :** un petit tableau de bord avec les abonnements actifs, le MRR, les essais, les conversions et le churn.
- **Authentification :** clés SDK et clés secrètes, connexion des opérateurs (mot de passe avec codes d'authentification facultatifs ; Cloudflare Access est prévu), rôles et journal d'audit.
- **Serveur MCP et skills Claude :** un assistant IA peut rechercher des clients, expliquer pourquoi quelqu'un a ou n'a pas un entitlement, et vous guider dans la configuration de l'App Store et de la Play Console.

**Hors périmètre pour l'instant :** paywalls, événements publicitaires, Customer Center, monnaies virtuelles, paiement web, Amazon et intégrations analytiques tierces. Les tests de prix figurent sur la [feuille de route](ROADMAP.md#later-) (en anglais).

## Deux éditions

| | Lite | Standard |
|---|---|---|
| Langage | TypeScript | Go |
| Tourne sur | Cloudflare Workers + D1 | Conteneurs + Postgres sur GCP ou AWS |
| Coût | Conçu pour tenir dans l'offre gratuite de Cloudflare | Votre facture cloud |
| Pour | Apps indépendantes : légère et peu coûteuse à faire tourner | Portefeuilles d'applications plus importants (bientôt) |

Les deux éditions passent la même suite de tests de conformité, dans `spec/`. Vous pouvez passer de Lite à Standard sans publier de mise à jour de l'application, à condition que celle-ci pointe vers un domaine personnalisé qui vous appartient.

## Compatibilité des SDK

Dès le premier jour, openpurr utilise les SDK officiels, sans modification (tous sous licence MIT) :

| SDK | Comment le faire pointer vers openpurr |
|---|---|
| iOS | `Purchases.proxyURL = URL(string: "https://purchases.example.com")` |
| Android | `Purchases.proxyURL = URL("https://purchases.example.com")` |
| Flutter, React Native | `Purchases.setProxyURL("https://purchases.example.com")` |

Définissez l'URL de proxy avant d'appeler `configure`. Laissez la vérification des entitlements à sa valeur par défaut (désactivée), car les réponses signées reposent sur la clé propre à RevenueCat.

**Limite connue sur Android :** le SDK envoie le trafic de diagnostic, de paywalls et de publicités directement à trois hôtes de RevenueCat, même quand une URL de proxy est définie. openpurr désactive les diagnostics via la configuration distante. N'utilisez pas les paywalls ou les publicités de RevenueCatUI sur Android avec openpurr.

## Organisation prévue du dépôt

```
spec/       language-neutral contract: OpenAPI, JSON schemas, fixtures, conformance suite
lite/       Lite edition: lightweight, for indie apps on Cloudflare Workers (TypeScript)
standard/   Standard edition: for larger app portfolios on AWS or GCP (Go, coming soon)
cli/        `npx @openpurr/cli` (works with either edition)
skills/     Claude Code plugin
examples/   sample apps
infra/      Terraform/OpenTofu modules for GCP, AWS and DigitalOcean
```

## Premiers pas

Lite en est à la version 0.1.0, sa première version : attendez-vous à des changements avant la 1.0. Pour l'essayer sur votre propre compte Cloudflare (l'offre gratuite suffit), avec Node 22.12 ou une version ultérieure :

```sh
git clone https://github.com/openpurr/openpurr && cd openpurr
npx pnpm install
cd lite && npx wrangler login
npx pnpm run setup      # database, both Workers, operator secret and your owner account
```

Vous pouvez relancer l'installation sans risque si elle s'arrête en cours de route. Elle se termine par un lien vers le tableau de bord, qui s'ouvre sur l'ajout de votre première application : son bundle ID et son nom de package, puis les produits, les entitlements et les offres. Un même déploiement peut faire tourner plusieurs applications sous forme de projets distincts, chacun avec ses propres clients. Ensuite :

- **Vérifiez votre configuration :** lancez `npx @openpurr/cli login`, puis `npx @openpurr/cli doctor`. La commande indique ce qui manque et comment corriger chaque point.
- **Recevez des alertes d'utilisation :** ajoutez un jeton d'API Cloudflare avec la permission Account Analytics: Read comme secret `CLOUDFLARE_ANALYTICS_TOKEN`, et le tableau de bord vous prévient avant que les limites quotidiennes de l'offre gratuite ne bloquent les requêtes.
- **Sauvegardez vos données :** `npx pnpm db:backup` exporte la base de données dans un fichier. D1 conserve aussi 7 jours d'historique avec l'offre gratuite (30 avec Workers Paid).
- **Déployez à chaque push :** forkez le dépôt et ajoutez vos informations Cloudflare comme secrets du dépôt. [`lite-deploy.yml`](.github/workflows/lite-deploy.yml) en donne la liste.

Vous utilisez Claude Code ? Le [plugin openpurr](plugin/) (en anglais) vous guide dans les mêmes étapes, ainsi que dans la configuration d'App Store Connect et de la Play Console.

## Contribuer

Consultez [CONTRIBUTING.md](CONTRIBUTING.md) (en anglais). En ce moment, l'aide la plus utile, ce sont vos retours dans les issues : hypothèses erronées sur les SDK ou les stores, et cas limites rencontrés en conditions réelles.

## Historique des étoiles

<a href="https://www.star-history.com/?repos=openpurr%2Fopenpurr&type=timeline&legend=bottom-right">
 <picture>
   <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/chart?repos=openpurr/openpurr&type=date&theme=dark&legend=bottom-right" />
   <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/chart?repos=openpurr/openpurr&type=date&legend=bottom-right" />
   <img alt="Graphique de l'historique des étoiles" src="https://api.star-history.com/chart?repos=openpurr/openpurr&type=date&legend=bottom-right" />
 </picture>
</a>

## Licence

[Licence Apache 2.0](LICENSE). Copyright 2026 contributeurs d'openpurr.
