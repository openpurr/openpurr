// The "Add in-app purchases" page in this language (see en.ts for the notes).
import type { StartDict } from "./en";

export const startJa: StartDict = {
  meta: {
    title: "アプリ内課金とサブスクリプションを無料で導入 - openpurr",
    description:
      "新しいアプリを作るなら、公式の Purchases SDK と自分で運用するオープンソースのバックエンドで課金を導入。売上に応じた手数料は一切かかりません。",
    ogImageAlt: "新しいアプリを作るなら、売上に応じた手数料なしで始めよう。1% を手元に残して、ビジネスに投資しましょう。",
  },
  hero: {
    crumb: "アプリ内課金を導入する",
    eyebrow: "新しいアプリのために",
    headline: "新しいアプリを作るなら",
    headlineAccent: "売上に応じた手数料なしで始めよう。",
    /** {threshold} is "$2,500". */
    lede: "多くの課金バックエンドは、月 {threshold} を超えると売上の 1% を取り、売上が伸びるたびに請求額も増えます。避けるなら、最初の売上の前がいちばん簡単です。openpurr は、自分で運用する無料・オープンソースのアプリ内課金とサブスクリプションのバックエンドです。大手のプラットフォームと同じ公式 SDK を使います。",
    ctaStart: "GitHub で始める",
    ctaHow: "仕組みを見る",
  },
  growth: {
    title: "あなたの 1%、初日から",
    text: "3 年後にアプリがどのくらいになっていそうかを選んでください。ゼロから順調に成長したと仮定して、そこまでに 1% の手数料がいくらになるかを示します。",
    target: "3 年後の月間収益",
    /** Labels for the totals. */
    fee: "1% の手数料、3 年間の合計",
    servers: "自分で運用した場合、3 年間の合計",
    after: "その後は毎年",
    /** The chart's accessible description. */
    chartLabel: "3 年間で月ごとに積み上がる売上に応じた手数料",
    /** HTML. {fee} and {servers} are amounts that move with the slider. */
    summary: "4 年目を迎えるまでに手放す額は <b>{fee}</b>。自分のサーバーなら <b>{servers}</b> です。手元に残して、ビジネスに回しましょう。",
  },
  invest: {
    title: "ビジネスに、そして自分に投資する",
    text: "1% を手元に残したら、1 年分で買えるもの：",
  },
  how: {
    title: "仕組み",
    lede: "4 つのステップで完了。書くコードは、RevenueCat のどのチュートリアルとも同じです。",
    steps: [
      {
        title: "openpurr をデプロイする",
        /** HTML. */
        text: "自分の Cloudflare アカウントでセットアップを実行します。小規模なアプリなら Lite は<b>無料プラン</b>に収まり、途中で止まってもセットアップは安全にやり直せます。",
      },
      {
        title: "アプリと商品を追加する",
        text: "ダッシュボードは最初のアプリの追加から始まります。バンドル ID とパッケージ名を入れたら、商品、エンタイトルメント、オファリングを設定します。",
      },
      {
        title: "Purchases SDK を追加する",
        /** HTML. */
        text: "MIT ライセンスのオープンソースである公式の RevenueCat Purchases SDK をインストールし、configure の前に<b>プロキシ URL を 1 つ</b>設定します。",
      },
      {
        title: "リリースする",
        text: "購入は Apple と Google で検証され、更新や返金はストア通知で届き、バックエンドには Webhook が送られます。Claude Code を使っているなら、openpurr のプラグインが App Store Connect と Play Console の設定を案内します。",
      },
    ],
    /** Above the setup commands. */
    setupLabel: "セットアップ（手元のマシンで）",
  },
  includes: {
    title: "できること",
    yes: [
      "App Store と Google Play の購入とサブスクリプション",
      "エンタイトルメントとオファリング",
      "バックエンドへの署名付き Webhook（再試行つき）",
      "16 種類のグラフ：売上、MRR、解約率、トライアルなど",
      "価格の実験",
      "データは自分のデータベースに",
    ],
    notYetTitle: "まだできないこと",
    notYet: "ペイウォールビルダー、外部の分析ツールとの連携、広告イベント、Web 課金、Amazon。最初からこれらが必要なら、商用のプラットフォームがすでに提供しています。",
  },
  lockin: {
    title: "どちらに進んでも、ロックインなし",
    text: "openpurr は標準の Purchases SDK を使うので、購入処理のコードはどちらのバックエンドでも動きます。openpurr では足りなくなったときや、商用プラットフォームの機能が欲しくなったときも、乗り換えは設定の変更と顧客のインポートだけ。書き直しは要りません。",
  },
  pricingLink: {
    text: "1% を払うと、そのお金はどこへ行くのでしょう？",
    link: "RevenueCat の料金の内訳を見る →",
  },
  faq: {
    title: "よくある質問",
    /** Each answer is also the page's FAQ structured data. */
    items: {
      backend: {
        q: "アプリ内課金にバックエンドは必要ですか？",
        a: "必須ではありません。StoreKit と Google Play Billing はデバイス上で動きます。ただ、バックエンドがあればサブスクリプションを正しく管理できます。Apple と Google で購入を検証し、ストア通知で更新、解約、返金を追い、誰がアクセスできるかをアプリとサーバーに伝えます。openpurr はそのバックエンドで、自分で運用できます。",
      },
      cheapest: {
        q: "iOS や Android のアプリにサブスクリプションを導入する、いちばん安い方法は？",
        /** {servers} a yearly amount, {m25k} "$25,000". */
        a: "バックエンドを自分で運用することです。openpurr Lite は小規模なアプリなら Cloudflare の無料プランに収まり、無料でオープンソースの Purchases SDK で動くので、かかるのはサーバー代だけ。私たちのモデルでは、月 {m25k} を稼ぐアプリで年 {servers} ほどで、売上に応じた手数料はかかりません。",
      },
      free: {
        q: "openpurr は本当に無料ですか？",
        a: "はい。Apache 2.0 ライセンスのオープンソースで、売上に応じた手数料も取引ごとの手数料もありません。払うのは自分のサーバー代だけで、小規模なアプリなら Cloudflare の無料プランに収まります。",
      },
      switch: {
        q: "あとから RevenueCat に乗り換えられますか？",
        a: "はい。openpurr は公式の RevenueCat Purchases SDK を使うので、アプリの購入処理のコードはどちらのバックエンドでも動き、ストアの商品もそのままです。乗り換えは設定の変更と顧客データの移行だけです。",
      },
      missing: {
        q: "openpurr にまだできないことは？",
        a: "ペイウォールビルダー、外部の分析ツールとの連携、広告イベント、Web 課金、Amazon です。価格の実験は組み込まれています。それ以外が最初から必要なら、商用のプラットフォームがすでに提供しています。",
      },
    },
  },
};
