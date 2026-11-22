<!-- translated-from: README.md sha256:51ff71c4d2f67d7f -->
<h1 align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset=".github/assets/openpurr-logo-dark.png">
    <img src=".github/assets/openpurr-logo.png" alt="openpurr" width="400">
  </picture>
</h1>

<!-- languages -->
<p align="center"><a href="README.md">English</a> · <a href="README.de.md">Deutsch</a> · <a href="README.es.md">Español</a> · <a href="README.fr.md">Français</a> · <a href="README.it.md">Italiano</a> · <a href="README.nl.md">Nederlands</a> · <a href="README.pl.md">Polski</a> · <a href="README.pt-BR.md">Português (Brasil)</a> · <a href="README.tr.md">Türkçe</a> · <a href="README.id.md">Bahasa Indonesia</a> · <a href="README.vi.md">Tiếng Việt</a> · <a href="README.ar.md">العربية</a> · <a href="README.hi.md">हिन्दी</a> · <b>日本語</b> · <a href="README.ko.md">한국어</a> · <a href="README.zh-CN.md">简体中文</a> · <a href="README.zh-TW.md">繁體中文</a></p>
<!-- /languages -->

セルフホスト型・オープンソースの RevenueCat 代替バックエンドです。

RevenueCat のオープンソースの Purchases SDK を使い、アプリの `Purchases.proxyURL` を自分のサーバーに向けます。openpurr は App Store と Google Play の購入を検証し、エンタイトルメントを管理し、ストア通知を受信し、バックエンドに Webhook を送信し、主要なサブスクリプション指標をグラフにします。動作するのは、自分で管理するインフラの上です。

openpurr は独立したプロジェクトであり、RevenueCat, Inc. とは提携しておらず、同社の承認も受けていません。

<picture>
  <source media="(prefers-color-scheme: dark)" srcset=".github/assets/openpurr-dashboard-demo-dark.webp">
  <img src=".github/assets/openpurr-dashboard-demo.webp" alt="openpurr Lite のダッシュボードのグラフをツールチップとともに順に表示：MRR、MRR の推移、売上、アクティブなサブスクリプション、解約">
</picture>

## こんな方に

次のようなアプリ開発者のためのプロジェクトです。

- **課金基盤を自分で管理したい。** 購入記録、エンタイトルメント、ストアの認証情報は、自分で運用するサーバー上の、クエリ、バックアップ、エクスポートが自由にできるデータベースに保存されます。アプリと顧客のあいだに外部サービスは入りません。
- **売上の一部を手数料として払いたくない。** openpurr には売上に応じた手数料も、取引ごとの手数料もありません。Lite エディションは Cloudflare の無料プランに収まるよう設計されているので、小規模なアプリなら費用をかけずに運用できます。
- **商用サービスに依存したくない。** オープンソースなので、コードを読み、変更し、Cloudflare と自社のクラウドのあいだで移すことができます。

すでに RevenueCat の SDK を使っていて、それを使い続けたい場合にも向いています。openpurr は公式の SDK を改変せずにそのまま使えるので、乗り換えは購入処理のコードを書き直すことではなく、URL を 1 つ変えることから始まります。既存の顧客を移行するには、[RevenueCat からの移行](https://openpurr.org/ja/migrate-from-revenuecat/)を参照してください。

**（まだ）合わない場合もあります。** ペイウォールビルダー、サードパーティの分析ツール連携、サポート契約が必要な場合です。それらは今のところ商用プラットフォームが提供しています。今後の予定は[ロードマップ](ROADMAP.md)（英語）を参照してください。

## できること

- **購入：** StoreKit 2 のトランザクションと Google Play の購入を検証し、SDK が期待する `CustomerInfo` とエンタイトルメントを返します。
- **ストア通知：** App Store Server Notifications V2 と Google Play の Real-time Developer Notifications を受信します。
- **Webhook：** RevenueCat と同じ形式のイベントをバックエンドに送信します。HMAC-SHA256 で署名し、約 72 時間にわたって再試行します。
- **グラフ：** ダッシュボードに 16 種類のグラフがあり、プロジェクト、アプリ、ストア、商品、環境で絞り込んで CSV でダウンロードできます。
  - **売上：** 売上、返金、返金率、サブスクリプション以外の購入。
  - **継続収益：** MRR、ARR、MRR の推移。
  - **サブスクリプション：** アクティブなサブスクリプション、有料サブスクリプション、サブスクリプションの増減、サブスクリプションのステータス、解約率。
  - **トライアル：** アクティブなトライアル、新規トライアル、トライアルの増減。
  - **顧客：** 新規顧客。
- **認証：** SDK キーとシークレットキー、オペレーターのログイン（パスワードと、任意で認証アプリのコード。Cloudflare Access は予定）、ロール、監査ログ。
- **MCP サーバーと Claude のスキル：** AI アシスタントが顧客を検索し、ある人がエンタイトルメントを持っている理由や持っていない理由を説明し、App Store と Play Console の設定を案内します。

**現時点では対象外：** ペイウォール、広告イベント、Customer Center、アプリ内通貨、Web 決済、Amazon、サードパーティの分析ツール連携。価格の実験は標準で使えます。[ガイド](docs/price-experiments.md)（英語）をご覧ください。

## 2 つのエディション

| | Lite | Standard |
|---|---|---|
| 言語 | TypeScript | Go |
| 実行環境 | Cloudflare Workers + D1 | GCP または AWS 上のコンテナ + Postgres |
| 費用 | Cloudflare の無料プランに収まるよう設計 | クラウドの利用料 |
| 対象 | 個人開発のアプリ：軽量で運用コストが低い | 多数のアプリを抱えるポートフォリオ（近日公開） |

どちらのエディションも、`spec/` にある同じ適合性テストスイートに合格しています。アプリの接続先が自分の所有するカスタムドメインであれば、アプリのアップデートをリリースせずに Lite から Standard へ移行できます。

## RevenueCat と比べて手元に残る金額

RevenueCat の Pro プランは、月間の追跡収益が $2,500 未満なら無料で、それ以上になると収益全体の 1% がかかります。Lite は Cloudflare の無料プランで動き、アプリが無料プランを超えたら月 $5 からの Workers Paid で動きます。

<a href="https://openpurr.org/ja/#savings">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset=".github/assets/openpurr-savings-dark.webp">
    <img src=".github/assets/openpurr-savings.webp" alt="節約額の計算ツール: 月間収益が $250,000 まで増えると RevenueCat の月額コストは上がり、openpurr Lite はほぼゼロのまま">
  </picture>
</a>

| 月間収益 | RevenueCat（月額） | openpurr Lite（月額） | 年間の節約額 |
|---|--:|--:|--:|
| $2,000 | $0 | $0 | **$0** |
| $5,000 | $50 | $0 | **$600** |
| $10,000 | $100 | $0 | **$1,200** |
| $25,000 | $250 | $5 | **$2,940** |
| $50,000 | $500 | $5 | **$5,939** |
| $100,000 | $1,000 | $9 | **$11,896** |
| $250,000 | $2,500 | $20 | **$29,764** |

試算です。料金は 2026年11月21日 に確認しました。1 日あたりのアクティブユーザー 1 人につき月間収益約 $1.50、SDK リクエスト 1 日 10 回を仮定しており、Workers Paid への移行は月間収益約 $11,250 からです。 [自分の数字で試す](https://openpurr.org/ja/#savings).

## SDK の互換性

最初から、公式の SDK を改変せずにそのまま使います（すべて MIT ライセンス）：

| SDK | openpurr に接続する方法 |
|---|---|
| iOS | `Purchases.proxyURL = URL(string: "https://purchases.example.com")` |
| Android | `Purchases.proxyURL = URL("https://purchases.example.com")` |
| Flutter、React Native | `Purchases.setProxyURL("https://purchases.example.com")` |

プロキシ URL は `configure` を呼ぶ前に設定してください。エンタイトルメントの検証はデフォルト（無効）のままにしておきます。署名付きレスポンスは RevenueCat 自身の鍵に依存しているためです。

**Android での既知の制約：** SDK は、プロキシ URL を設定していても、診断、ペイウォール、広告の通信を 3 つの RevenueCat のホストに直接送信します。openpurr はリモート設定で診断をオフにします。openpurr を使う場合、Android では RevenueCatUI のペイウォールや広告を使わないでください。

## 予定しているリポジトリ構成

```
spec/       language-neutral contract: OpenAPI, JSON schemas, fixtures, conformance suite
lite/       Lite edition: lightweight, for indie apps on Cloudflare Workers (TypeScript)
standard/   Standard edition: for larger app portfolios on AWS or GCP (Go, coming soon)
cli/        `npx @openpurr/cli` (works with either edition)
skills/     Claude Code plugin
examples/   sample apps
infra/      Terraform/OpenTofu modules for GCP, AWS and DigitalOcean
```

## はじめに

Lite は最初のリリースである 0.1.0 なので、1.0 までに変更が入る可能性があります。自分の Cloudflare アカウント（無料プランで十分です）で試すには、Node 22.12 以降で次を実行します。

```sh
git clone https://github.com/openpurr/openpurr && cd openpurr
npx pnpm install
cd lite && npx wrangler login
npx pnpm run setup      # database, both Workers, operator secret and your owner account
```

セットアップは途中で止まっても、安全にもう一度実行できます。最後にダッシュボードへのリンクが表示され、最初のアプリの追加画面が開きます。バンドル ID とパッケージ名を入力し、続いて商品、エンタイトルメント、オファリングを設定します。1 つのデプロイで複数のアプリを別々のプロジェクトとして運用でき、それぞれが独自の顧客を持ちます。その後は次のことができます。

- **セットアップを確認する：** `npx @openpurr/cli login` を実行してから `npx @openpurr/cli doctor` を実行します。足りないものと、それぞれの直し方を報告します。
- **使用量のアラートを受け取る：** Account Analytics: Read の権限を持つ Cloudflare API トークンを `CLOUDFLARE_ANALYTICS_TOKEN` シークレットとして追加すると、無料プランの 1 日の上限でリクエストが止まる前にダッシュボードが警告します。
- **データをバックアップする：** `npx pnpm db:backup` でデータベースをファイルにエクスポートします。D1 は無料プランでも 7 日分の履歴を保持します（Workers Paid では 30 日分）。
- **push のたびにデプロイする：** リポジトリをフォークし、Cloudflare の情報をリポジトリのシークレットとして追加します。必要な項目は [`lite-deploy.yml`](.github/workflows/lite-deploy.yml) に記載されています。

Claude Code を使っていますか？ [openpurr プラグイン](plugin/)（英語）が同じ手順に加えて、App Store Connect と Play Console の設定も案内します。

## コントリビュート

[CONTRIBUTING.md](CONTRIBUTING.md)（英語）を参照してください。いま最も助かるのは、Issue でのフィードバックです。SDK やストアについての誤った前提や、実際に起こるエッジケースを教えてください。

その他のお問い合わせは [hello@openpurr.org](mailto:hello@openpurr.org) までメールでどうぞ。

## Star History

<a href="https://www.star-history.com/?repos=openpurr%2Fopenpurr&type=timeline&legend=bottom-right">
 <picture>
   <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/chart?repos=openpurr/openpurr&type=date&theme=dark&legend=bottom-right" />
   <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/chart?repos=openpurr/openpurr&type=date&legend=bottom-right" />
   <img alt="Star History のグラフ" src="https://api.star-history.com/chart?repos=openpurr/openpurr&type=date&legend=bottom-right" />
 </picture>
</a>

## ライセンス

[Apache License 2.0](LICENSE)。Copyright 2026 openpurr contributors.
