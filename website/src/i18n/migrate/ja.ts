// Japanese copy of the migration page. Follows en.ts; see the notes there.
import type { MigrateDict } from "./en";

export const migrateJa: MigrateDict = {
  meta: {
    title: "RevenueCat から openpurr への移行方法と手順",
    description:
      "オープンソースの RevenueCat 代替 openpurr へ、RevenueCat から移行する方法を解説します。Purchases SDK はそのままに、すべての購読者をインポートし、アクセスも維持できます。",
    ogImageAlt:
      "購読者を 1 人も失わずに RevenueCat から openpurr へ移行：Purchases SDK はそのまま、すべての顧客をインポートし、古いバージョンのアプリも動き続けます。",
  },
  hero: {
    crumb: "RevenueCat からの移行",
    eyebrow: "移行ガイド",
    headline: "購読者を 1 人も失わずに RevenueCat から openpurr へ移行する",
    lede: "アプリですでに使っている Purchases SDK はそのままです。既存の顧客は RevenueCat のエクスポートからインポートし、購入そのものは openpurr が Apple と Google から取得します。ユーザーがアップデートするあいだも、古いバージョンのアプリは動き続けます。",
    guide: "詳しい手順ガイドを読む（英語）",
    steps: "手順を見る",
    updated: "{date} 更新",
  },
  summary: {
    title: "要点",
    items: [
      "openpurr は、セルフホスト型でオープンソースの RevenueCat 代替です。公式の RevenueCat Purchases SDK を改変せずにそのまま使えます。",
      "アプリに加えるのは 1 行（SDK のプロキシ URL）と、1 回だけの <code>syncPurchases</code> 呼び出しです。それ以外の購入処理のコードは変わりません。",
      "<code>openpurr import</code> は、RevenueCat のエクスポートから既存の顧客を移行します。購入そのものはコピーせず、Apple と Google から取得します。",
      "App Store のアプリは RevenueCat の Scheduled Data Export を使えます。Google Play では、購入トークンを含む唯一のエクスポートである、RevenueCat Support が用意する移行用エクスポートが必要です。",
      "ほとんどのユーザーがアプリをアップデートするまで両方のバックエンドが最新の状態に保たれるので、誰もアクセスを失いません。",
      "Cloudflare の無料プランでは、インポートできるのは 1 日あたり約 2,500 人の顧客です。Workers Paid なら、大規模なインポートも数時間で終わります。",
    ],
  },
  how: {
    eyebrow: "仕組み",
    title: "RevenueCat からの移行の仕組み",
    lede: "openpurr は RevenueCat から購入記録をコピーしません。必要なのは、どの購入を誰が持っているかという情報だけです。あとは、アプリが購入を送信したときと同じようにストアに問い合わせます。",
    ways: [
      {
        title: "インポート",
        body: "RevenueCat のエクスポートには、どのアプリユーザーがどのストアの購入を持っているかが記載されています。<code>openpurr import</code> は購入ごとに Apple と Google に問い合わせ、ストアの回答をそのユーザーの記録として保存します。二度とアプリを開かない人も含め、全員を一度に移行できます。",
      },
      {
        title: "アプリのアップデート",
        body: "新しいバージョンでは Purchases SDK の接続先を openpurr に向け、<code>syncPurchases</code> で各顧客の購入を一度だけ送信します。これで、エクスポートから漏れた人や、エクスポートの作成後に購入した人も拾えます。",
      },
      {
        title: "しばらくは両方のバックエンドで",
        body: "古いバージョンのアプリは、ユーザーがアップデートするまで RevenueCat と通信し続けます。RevenueCat が Apple の通知を openpurr に転送し、2 つ目の Pub/Sub サブスクリプションが Google の通知を同じように届けるので、両方が最新の状態に保たれます。",
      },
    ],
  },
  app: {
    eyebrow: "アプリ側の変更",
    title: "アプリで変わること",
    lede: "configure の前にプロキシ URL を設定し、各顧客の購入を一度だけ送信します。Android、Flutter、React Native でも同じ 2 つの変更で済みます。それぞれのコードはガイドに載っています。",
    codeLabel: "Swift の例：プロキシ URL と 1 回だけの同期",
    proxyComment: "configure() の前に：ほとんどのアプリはこの 1 行だけ",
    syncComment: "インストールごとに 1 回：この顧客の購入を openpurr に送信",
  },
  import: {
    eyebrow: "インポート",
    title: "RevenueCat から顧客をインポートする",
    lede: "openpurr の CLI は RevenueCat の列をそのまま読み込みます。アプリユーザー ID、App Store のトランザクション ID、Google Play の購入トークン、そして <code>$email</code> などの属性です。",
    codeLabel: "ターミナル：RevenueCat のエクスポートをインポート",
    dryRunComment: "最初の数行を確認：Apple と Google に問い合わせ、何も書き込まない",
    importComment: "全員をインポート。いつでも中断でき、再実行で続きから再開",
    safeguards: [
      ["誰もアクセスを失わない", "アプリからすでに送信された購入は、その顧客のものとして残ります。インポートがそれを移すことはありません。"],
      ["Webhook の重複なし", "インポートした購入は新しい購入ではないため、openpurr はイベントを送信しません。"],
      ["正確なグラフ", "インポートした顧客は最初の購入日で記録され、インポートした日の新規顧客としては数えられません。"],
      ["アプリは動き続ける", "Cloudflare の無料プランでは、インポートは 1 日の上限の 90% で止まり、翌日に続きから再開します。"],
      ["中断と再開", "進捗は保存されます。同じ行を 2 回インポートしても何も変わらないので、新しいエクスポートを再度実行できます。"],
      ["まず試す", "ドライランではストアに問い合わせて何が起こるかを報告し、何も書き込みません。"],
    ] as [string, string][],
  },
  steps: {
    eyebrow: "手順",
    title: "RevenueCat から移行する 7 つの手順",
    lede: "切り替える準備ができるまで両方のバックエンドが動き続けるので、古いバージョンのアプリを使っている顧客もアクセスを失いません。",
    items: [
      {
        title: "openpurr をセットアップする",
        body: "openpurr Lite を自分の Cloudflare アカウントにデプロイし、App Store と Google Play の API へのアクセスを与え、商品、エンタイトルメント、オファリングを同じ識別子で作り直します。RevenueCat の公開 SDK キーをそのまま使い続けることもできます。",
      },
      {
        title: "両方のバックエンドに通知が届くようにする",
        body: "openpurr を RevenueCat の Apple Server Notification Forwarding URL に設定し、Play の通知トピックに openpurr のプッシュサブスクリプションを追加します。",
      },
      {
        title: "エクスポートを入手する",
        body: "App Store だけなら、RevenueCat の Scheduled Data Export に必要な情報がそろっています。Google Play の場合は、購入トークンを含むのは移行用エクスポートだけなので、RevenueCat Support に依頼してください。ガイドにはそのままコピーできる依頼文があります。",
      },
      { title: "インポートする", body: "まずドライランをしてから、<code>openpurr import</code> を実行します。個々の行の問題はレポートに記録され、インポートは止まりません。" },
      { title: "アプリのアップデートをリリースする", body: "プロキシ URL と 1 回だけの <code>syncPurchases</code> を追加します。インポートが終わってからリリースしてください。" },
      {
        title: "確認する",
        body: "<code>openpurr doctor</code> でセットアップを確認します。知っている顧客を検索し、アクティブなサブスクリプションの数を RevenueCat のグラフと比べてください。",
      },
      {
        title: "切り替えを完了する",
        body: "ほとんどの顧客がアップデートしたら、Apple と Google の通知先を直接 openpurr に向け、openpurr の Webhook をオンにして、RevenueCat の Webhook をオフにします。",
      },
    ],
    source: "出典：",
    sourceNotifications: "RevenueCat：Apple のサーバー通知（英語）",
    sourceExports: "RevenueCat：データのエクスポートと移行（英語）",
    more: "すべてのコマンドと設定は詳しいガイドに載っています（英語）→",
  },
  moves: {
    eyebrow: "移行できるもの",
    title: "RevenueCat から移行できるもの、できないもの",
    rows: [
      ["サブスクリプションと購入（更新、返金、猶予期間、有効期限を含む）", "はい。Apple と Google から取得します"],
      ["どの購入を誰が持っているか", "はい。RevenueCat のエクスポートから移行します"],
      ["アプリユーザー ID（匿名のものも含む）", "はい。そのまま引き継ぎます"],
      ["顧客の属性（$email、$displayName、独自の属性）", "はい。Audience export から移行します"],
      ["商品、エンタイトルメント、オファリング", "同じ識別子で作り直します"],
      ["切り替え前のグラフの履歴", "一部のみ。記録用に RevenueCat のグラフの CSV を保存しておいてください"],
      ["ペイウォール、実験、連携機能、Customer Center", "いいえ。openpurr にはありません"],
    ] as [string, string][],
  },
  faq: {
    eyebrow: "FAQ",
    title: "RevenueCat からの移行に関するよくある質問",
    items: [
      {
        q: "購入処理のコードを変更する必要はありますか？",
        a: "いいえ、必要ありません。openpurr は公式の RevenueCat Purchases SDK を改変せずにそのまま使えます。アプリのアップデートで加えるのは、configure の前のプロキシ URL と、1 回だけの syncPurchases 呼び出しです。getOfferings、purchase、restorePurchases、logIn などはそのままです。",
      },
      {
        q: "移行に RevenueCat の協力は必要ですか？",
        a: "App Store のアプリなら必要ありません。RevenueCat の Scheduled Data Export に、openpurr が必要とするトランザクション ID が含まれています。Google Play の場合は必要です。RevenueCat のドキュメントによると、Google が求める購入トークンを含むのは、RevenueCat Support が用意する移行用エクスポートだけです。",
      },
      {
        q: "アプリをアップデートしない顧客はどうなりますか？",
        a: "インポートで対応できます。その顧客の購入は Apple と Google から取得され、同じアプリユーザー ID に割り当てられます。古いバージョンのアプリは RevenueCat と通信し続けるため、ほとんどのユーザーがアップデートするまで両方のバックエンドに通知が届くようにしておきます。",
      },
      {
        q: "インポートにはどのくらい時間がかかりますか？",
        a: "顧客 1 人あたり、データベースの行の書き込みが約 30 回発生します。Cloudflare の無料プランでは 1 日あたり約 2,500 人で、インポートは 1 日の上限に達すると自動的に一時停止し、翌日に再開します。Workers Paid（月額 $5）なら、大規模なインポートも数時間で終わります。",
      },
      {
        q: "データは RevenueCat からコピーされるのですか？",
        a: "コピーされるのは、アプリユーザーとストアの購入の対応関係と、インポートする場合の属性だけです。購入そのものは Apple と Google から直接取得するので、openpurr には更新や返金も含めたストアの最新の状態が記録されます。",
      },
    ],
  },
  cta: {
    title: "乗り換える準備はできましたか？",
    body: "ガイドではすべての手順を順に説明しています。セットアップに合わない部分があれば、Issue を作成してください。移行で見えた課題が、次に作るものを決めます。",
    guide: "ガイドを読む（英語）",
    github: "GitHub の openpurr",
    issue: "Issue を作成する",
  },
};
