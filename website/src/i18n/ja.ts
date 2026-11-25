// Japanese copy. Follows en.ts; see the notes there. Polite です/ます style, half-width spaces around Latin words, and エンタイトルメント for "entitlement".
import type { Dict } from "./en";

export const ja: Dict = {
  meta: {
    title: "openpurr：セルフホスト型・オープンソースの RevenueCat 代替",
    description:
      "openpurr は、セルフホスト型でオープンソースの RevenueCat 代替です。いま使っている Purchases SDK はそのままに、接続先を自分のサーバーに向けるだけ。売上に応じた手数料はかかりません。",
    ogImageAlt: "openpurr：セルフホスト型・オープンソースの RevenueCat 代替と、サブスクリプションのグラフを表示するダッシュボード",
  },
  header: {
    home: "openpurr ホーム",
    nav: { features: "機能", editions: "エディション", roadmap: "ロードマップ", faq: "FAQ", migrate: "移行" },
    language: "言語",
  },
  footer: {
    tagline: "自分で運用する、オープンソースの課金基盤。",
    roadmap: "ロードマップ",
    contributing: "コントリビュート",
    sponsor: "スポンサー",
    contact: "お問い合わせ",
    privacy: "プライバシー（英語）",
    disclaimer:
      "openpurr は独立したプロジェクトであり、RevenueCat, Inc. とは提携しておらず、同社の承認も受けていません。App Store は Apple Inc. の商標です。Google Play は Google LLC の商標です。",
    copyright: "Copyright {year} openpurr contributors.",
    cookieSettings: "Cookie 設定",
  },
  consent: {
    label: "Cookie の同意",
    text: "訪問数を数え、どのページが役に立っているかを知るために、Google Analytics の Cookie を使わせてください。同意いただかない限り何も設定されません。また、選択は「Cookie 設定」からいつでも変更できます。",
    privacy: "プライバシー（英語）",
    decline: "拒否する",
    accept: "同意する",
  },
  snippet: {
    tabs: "SDK のプラットフォーム",
    note: "変更は 1 行だけ。SDK も購入処理のコードもそのままです。",
  },
  home: {
    hero: {
      title: '<span class="nowrap">セルフホスト型</span>・オープンソースの<span class="accent">RevenueCat 代替</span>',
      lede: "課金基盤を自分の手で管理し、売上を誰とも分け合わず、商用サービスに依存しない。いま使っている Purchases SDK はそのままです。変えるのは URL 1 つだけで、購入処理のコードは変わりません。",
      star: "GitHub でスターする",
      how: "仕組みを見る",
      runsOn: "対応クラウド",
      shotAlt:
        "openpurr Lite のダッシュボード。12 か月分の MRR の推移、アクティブなサブスクリプション、解約率、新規顧客、新規トライアル、アクティブなトライアルを表示しています",
    },
    why: {
      eyebrow: "こんな方に",
      title: "自分で運用したいアプリ開発者のために",
      lede: "openpurr は公式の SDK を改変せずにそのまま使えます。乗り換えは購入処理のコードを書き直すことではなく、URL を 1 つ変えることから始まります。",
      reasons: [
        {
          title: "データもサーバーも自分のもの",
          body: "購入記録、エンタイトルメント、ストアの認証情報は、自分で運用するデータベースに保存されます。クエリもバックアップもエクスポートも自由です。アプリと顧客のあいだに外部サービスは入りません。",
        },
        {
          title: "売上の手数料はゼロ",
          body: "売上に応じた手数料も、取引ごとの手数料もありません。Lite エディションは Cloudflare の無料プランに収まるよう設計されているので、小規模なアプリなら費用をかけずに運用できます。",
        },
        {
          title: "特定のベンダーに依存しない",
          body: "Apache 2.0 ライセンスのオープンソースです。コードを読み、変更し、Cloudflare と自社のクラウドのあいだで自由に移せます。",
        },
      ],
    },
    how: {
      eyebrow: "仕組み",
      title: "これまでベンダーがいた場所に、自分のサーバーを置く",
      lede: "アプリには、すでに組み込んでいるオープンソースの Purchases SDK をそのまま使います。SDK は openpurr と通信し、openpurr はストアと通信してサブスクリプションの状態を管理し、変化があればバックエンドに知らせます。",
      flowLabel: "リクエストの流れ",
      app: "あなたのアプリ",
      sdkLicense: "公式・無改変・MIT ライセンス",
      sdkPlatforms: "iOS、Android、Flutter、React Native",
      coreWhere: "Cloudflare Workers または自社のクラウド上で",
      appStoreApi: "Server API と通知",
      playApi: "Developer API と RTDN",
      backend: "あなたのバックエンド",
      backendHooks: "署名付き Webhook",
      steps: [
        {
          title: "デプロイする",
          body: "openpurr Lite を自分の Cloudflare アカウントで動かします。ガイド付きのセットアップ <code>pnpm run setup</code> が、データベースの作成、2 つの Worker のデプロイ、オーナーアカウントの作成まで行います。",
        },
        {
          title: "SDK の接続先を変える",
          body: "<code>configure</code> の前にプロキシ URL を設定します。あとで移行できるよう、自分が所有するカスタムドメインを使いましょう。",
        },
        {
          title: "ストアと接続する",
          body: "ストアの認証情報と通知用 URL を登録します。セットアップチェック <code>openpurr doctor</code> がそれらを検証し、足りないものがあれば直し方を示します。",
        },
      ],
    },
    features: {
      eyebrow: "できること",
      title: "使わない機能を省いた、サブスクリプションのバックエンド",
      items: [
        {
          title: "購入とストア通知",
          body: "StoreKit 2 のトランザクションと Google Play の購入を検証し、SDK が期待する CustomerInfo とエンタイトルメントを返します。App Store と Google Play の通知をもとに、更新、返金、猶予期間を常に最新の状態に保ちます。",
        },
        {
          title: "Webhook",
          body: "RevenueCat と同じ形式のイベントをバックエンドに送信します。HMAC-SHA256 で署名し、約 72 時間にわたって再試行します。",
        },
        {
          title: "グラフ",
          body: "16 種類のグラフ：売上、MRR と ARR、MRR とサブスクリプションの推移、アクティブ・有料のサブスクリプション、サブスクリプションのステータス、解約率、トライアルとトライアルからの転換、新規顧客、返金と返金率、買い切り購入。アプリ、ストア、商品、環境で絞り込めて、売上は USD に換算して表示します。",
        },
        {
          title: "価格の実験",
          body: "アプリを初めて使う顧客に異なるオファリングを表示し、転換率と顧客あたりの売上を比較できます。各バリアントが対照群を上回る確率もわかります。アプリのアップデートは不要です。",
        },
        {
          title: "認証と監査",
          body: "SDK キーとシークレットキー、認証アプリのコードにも対応したオペレーターのサインイン、ロール、アクセストークン、監査ログを備えています。",
        },
        {
          title: "MCP サーバーと Claude のスキル",
          body: "ある顧客がエンタイトルメントを持っている理由や持っていない理由を AI アシスタントに尋ねたり、購入を調べたり、App Store Connect と Play Console の設定を案内してもらったりできます。",
        },
      ],
    },
    editions: {
      eyebrow: "2 つのエディション",
      title: "小さく始めて、アプリを更新せずにスケールアップ",
      lede: "どちらのエディションも同じ適合性テストスイートに合格しています。アプリの接続先が自分のカスタムドメインなら、Lite から Standard への移行にアプリのリリースは必要ありません。",
      lite: {
        badge: "個人開発のアプリに",
        price: "$0",
        priceNote: "Cloudflare の無料プランで",
        items: ["Cloudflare Workers と D1 上の TypeScript", "軽量で、運用コストも低い", "無料プランの上限に達する前に使用量をお知らせ"],
      },
      standard: {
        badge: "アプリの多いチームに",
        price: "クラウド利用料のみ",
        priceNote: "それ以外の費用はかかりません",
        items: ["コンテナで動く Go と Postgres", "GCP、AWS または DigitalOcean", "それぞれにデプロイ用テンプレートを用意"],
      },
    },
    savings: {
      eyebrow: "コスト",
      title: "RevenueCat と比べて手元に残る金額",
      lede: "RevenueCat の Pro プランは、月間の追跡収益が $2,500 未満なら無料で、それ以上になると収益全体の 1% がかかります。Lite は Cloudflare の無料プランで動き、アプリが無料プランを超えたら月 $5 からの Workers Paid で動きます。",
      revenue: "月間収益",
      rc: "RevenueCat",
      op: "openpurr Lite",
      saved: "年間の節約額",
      perMonth: "月 {amount}",
      free: "Cloudflare 無料プラン",
      paid: "Cloudflare Workers Paid",
      chartLabel: "月間収益ごとの月額コスト: RevenueCat は収益とともに増え、openpurr Lite はほぼゼロのまま",
      gapLegend: "手元に残る金額",
      tableSummary: "ほかの収益規模で比べる",
      colRevenue: "月間収益",
      colRc: "RevenueCat（月額）",
      colOp: "openpurr Lite（月額）",
      colSaved: "年間の節約額",
      methodSummary: "試算の方法",
      pricingLink: "RevenueCat の料金、その内訳 →",
      method: [
        "RevenueCat: Pro プランの定価で、$2,500 以上の月間追跡収益の 1%。追跡収益には年額プランや買い切りの購入が支払った月にまとめて計上されるため、MRR より大きくなることがあります。大規模なアカウントは Enterprise 価格を交渉できます。",
        "openpurr Lite: Cloudflare の Workers と D1 の料金。1 日あたりのアクティブユーザー 1 人につき、月間収益を約 $1.50、SDK リクエストを 1 日約 10 回と仮定しています。この前提だと、無料プランの 1 日 100,000 リクエストで、余裕を持って月間収益約 {paidFrom} までまかなえます。それを超えると Workers Paid で計算します。月 $5 に加え、1,000 万リクエストを超えた分は 100 万リクエストごとに $0.30 です。",
        "含まれないもの: 運用にかかるあなたの時間。ストアの手数料はどちらでも同じです。",
        "料金は {date} に確認しました。openpurr は RevenueCat とは関係ありません。",
      ],
    },
    fit: {
      eyebrow: "正直にお伝えします",
      title: "まだ合わない場合もあります",
      lede: "ペイウォールビルダー、サードパーティの分析ツール連携、サポート契約が必要なら、それらは今のところ商用プラットフォームが提供しています。",
      outTitle: "現時点では対象外",
      tags: ["ペイウォール", "広告イベント", "Customer Center", "アプリ内通貨", "Web 決済", "Amazon", "分析ツール連携"],
    },
    roadmap: {
      eyebrow: "ロードマップ",
      title: "これからの予定",
      lede: "順番は決まっていますが、日付は決めていません。必要なものがあれば Issue で教えてください。",
      status: { done: "完了", wip: "進行中", planned: "予定", later: "皆さん次第" },
      phases: [
        {
          phase: "Lite",
          items: [
            "最新リリース：{version}",
            "Cloudflare の無料プラン向けに設計",
            "App Store と Google Play",
            "Webhook、ダッシュボード、管理画面",
            "1 つのデプロイで複数のアプリに対応",
            "価格の実験",
            "MCP サーバー、CLI、Claude のスキル",
            "次は実機テスト、その後 1.0",
          ],
        },
        {
          phase: "Standard",
          items: ["コンテナで動く Go と Postgres", "GCP、AWS、DigitalOcean", "Lite と同じ適合性テストスイート", "アプリを更新せずに Lite から移行"],
        },
        {
          phase: "コミュニティとともに",
          items: ["エンドユーザーの本人確認", "大規模チーム向けの Standard 拡張機能", "グラフを見られるモバイルアプリ（購入が止まったら通知）", "同じ通知を Slack、Discord、Telegram にも", "Issue でいただいた要望"],
        },
      ],
      more: "ロードマップの全文を読む（英語）→",
    },
    cta: {
      title: "一緒に形にしてください",
      body: "いま最も助かるのはフィードバックです。SDK やストアについての誤った前提や、更新、返金、猶予期間で実際に起こるエッジケースを教えてください。",
      star: "GitHub でスターする",
      issue: "Issue を作成する",
      coffee: "コーヒーをおごる",
    },
  },
  faq: {
    eyebrow: "FAQ",
    title: "RevenueCat の代替としての openpurr",
    lede: "自分でサブスクリプションのバックエンドを運用すると何が変わり、何が変わらないのか。",
    items: [
      {
        q: "openpurr とは何ですか？",
        a: "openpurr は、オープンソースでセルフホスト型の RevenueCat の代替です。公式の RevenueCat Purchases SDK で動作する、アプリ内課金とサブスクリプションのためのバックエンドです。App Store と Google Play の購入を検証し、エンタイトルメントを管理し、ストア通知を受信し、バックエンドに Webhook を送信し、主要なサブスクリプション指標をグラフにします。これらはすべて、自分で管理するインフラ上で動きます。",
      },
      {
        q: "openpurr は RevenueCat と何が違いますか？",
        a: "RevenueCat はホスト型の商用サービスで、無料枠を超えると売上の一部を手数料として支払います。openpurr は自分で運用するソフトウェアです。購入記録、エンタイトルメント、ストアの認証情報は自分のデータベースに保存され、売上に応じた手数料も取引ごとの手数料もかかりません。現時点では、ペイウォールや分析ツール連携など、RevenueCat のほうが多くの機能を備えています。openpurr はサブスクリプションのバックエンドの中核に絞っています。",
      },
      {
        q: "RevenueCat から乗り換えるには、購入処理のコードを書き直す必要がありますか？",
        a: "いいえ、必要ありません。openpurr は公式の Purchases SDK を改変せずにそのまま使えます。configure を呼ぶ前に SDK のプロキシ URL を openpurr のサーバーに設定すれば、それ以外の購入処理のコードはそのままです。自分が所有するカスタムドメインを接続先にしておけば、あとでアプリを更新せずにサーバーを移せます。",
      },
      {
        q: "既存の顧客を RevenueCat から移行するにはどうすればよいですか？",
        a: "インポートします。RevenueCat に移行用のエクスポートを依頼すると、openpurr import が各顧客の購入を Apple と Google から取得し、同じアプリユーザー ID に割り当てます。新しいバージョンのアプリも各顧客の購入を一度送信し、ユーザーがアップデートするあいだは両方のバックエンドが最新の状態に保たれるので、誰もアクセスを失いません。",
        link: "移行の手順",
      },
      {
        q: "Adapty から乗り換えられますか？",
        a: "はい、アプリのアップデートが必要です。Adapty の SDK は接続先を別のサーバーに変更できないため、アップデートで openpurr が対応する Purchases SDK に置き換えます。ストアの商品はそのままです。openpurr は App Store の顧客を Adapty のイベントエクスポートからインポートし、それ以外の顧客は新しいバージョンのアプリを初めて起動したときに移行されます。ユーザーがアップデートするあいだは両方のバックエンドが最新の状態に保たれます。",
        link: "Adapty のガイドを読む",
        linkTo: "adapty",
      },
      {
        q: "新しいアプリを作っています。最初から openpurr を使えますか？",
        a: "はい、むしろ今がいちばん簡単なタイミングです。公式の Purchases SDK を追加して接続先を openpurr のサーバーに向ければ、売上に応じた手数料を払い始めることはありません。あとで移行する必要もありません。",
        link: "新しいアプリにアプリ内課金を導入する",
        linkTo: "new",
      },
      {
        q: "openpurr はどのプラットフォームとストアに対応していますか？",
        a: "iOS、Android、Flutter、React Native 向けの Purchases SDK に対応し、App Store と Google Play での購入を扱います。Amazon と Web 決済は現時点では対象外です。",
      },
      {
        q: "openpurr の費用はいくらですか？",
        a: "openpurr は Apache 2.0 ライセンスの無料のオープンソースソフトウェアです。支払うのは、動かすインフラの費用だけです。Lite エディションは Cloudflare の無料プランで動くよう設計されているので、小規模なアプリなら費用をかけずに運用できます。Standard エディションは自社のクラウド上のコンテナで動くため、費用はクラウドの利用料になります。",
      },
      {
        q: "データはどこに保存されますか？",
        a: "自分のデータベースに保存されます。Lite エディションは自分の Cloudflare アカウントの Cloudflare D1 を、Standard エディションは GCP、AWS または DigitalOcean 上の Postgres を使います。データはクエリ、バックアップ、エクスポートが自由にでき、アプリと顧客のあいだに外部サービスは入りません。",
      },
      {
        q: "openpurr は RevenueCat のように Webhook を送信しますか？",
        a: "はい、送信します。openpurr は RevenueCat と同じ形式のイベントをバックエンドに送信し、HMAC-SHA256 で署名して約 72 時間にわたって再試行します。そのため、既存の Webhook ハンドラーはほとんど、あるいはまったく変更する必要がありません。",
      },
      {
        q: "RevenueCat にできて openpurr にできないことは何ですか？",
        a: "ペイウォール、サードパーティの分析ツール連携、Customer Center、アプリ内通貨、Web 決済、Amazon、広告イベント、商用のサポート契約は、現時点では対象外です。価格の実験は標準で搭載しています。それ以外の機能が今すぐ必要なら、商用プラットフォームのほうが適しています。",
      },
      {
        q: "openpurr は本番環境で使えますか？",
        a: "まだ使えません。openpurr は初期段階にあり、どちらのエディションも動作し、同じ適合性テストスイートに合格していますが、実機での購入を含むエンドツーエンドのテストはまだ行っていません。GitHub でロードマップをフォローし、必要なものがあれば Issue を作成してください。",
      },
      {
        q: "openpurr は RevenueCat と提携していますか？",
        a: "いいえ、提携していません。openpurr は独立したオープンソースプロジェクトであり、RevenueCat, Inc. とは提携しておらず、同社の承認も受けていません。openpurr は、MIT ライセンスで公開されている RevenueCat 公式の Purchases SDK で動作します。",
      },
    ],
  },
  structured: {
    description:
      "セルフホスト型でオープンソースの RevenueCat の代替です。App Store と Google Play のアプリ内課金とサブスクリプションのためのバックエンドで、公式の Purchases SDK を改変せずにそのまま使えます。購入の検証、エンタイトルメントの管理、ストア通知の受信、Webhook の送信、サブスクリプション指標のグラフ化を行います。",
    subCategory: "アプリ内課金とサブスクリプションのバックエンド",
    features: [
      "iOS、Android、Flutter、React Native 向けの公式 RevenueCat Purchases SDK で動作",
      "StoreKit 2 と Google Play の購入検証",
      "App Store Server Notifications V2 と Google Play の Real-time Developer Notifications",
      "HMAC-SHA256 で署名された、RevenueCat と同じ形式の Webhook",
      "MRR、解約率、トライアルからの転換を含む 16 種類のサブスクリプションのグラフ",
      "オファリングを対象にした価格の実験と、バリアントごとの結果",
      "MCP サーバー、CLI、Claude のスキル",
    ],
  },
};
