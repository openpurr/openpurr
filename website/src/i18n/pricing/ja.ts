// The RevenueCat pricing page in this language (see en.ts for the notes).
import type { PricingDict } from "./en";

export const pricingJa: PricingDict = {
  meta: {
    title: "RevenueCat の料金：1% の行き先 · openpurr",
    description:
      "RevenueCat は売上の 1% を取ります。サーバー代は誤差程度。残りは給与、営業、ベンチャー投資家に消えています。",
    ogImageAlt: "RevenueCat は売上の 1% を取り、サーバー代は誤差程度。残りは何に使われているのか。",
  },
  hero: {
    crumb: "RevenueCat の料金",
    headline: "払っているのは、サーバー代ではない。",
    /** The headline's second, highlighted sentence. {valuation} is "$500 million". */
    headlineAccent: "評価額 {valuation} の会社に払っている。",
    /** {threshold} is "$2,500". */
    lede: "RevenueCat は、月 {threshold} を超えると追跡収益の全体から 1% を取ります。売上が伸びるたびに、請求額も増えます。アプリを支えるサーバー代は誤差程度。残りは会社そのもの、つまり給与、営業チーム、そして投資家のリターンに使われます。",
    updated: "{date} 更新 · 公開情報からの推計",
  },
  answer: {
    title: "RevenueCat の料金をひとことで",
    /** HTML. {threshold} is "$2,500". */
    text: "月間の追跡収益が {threshold} 未満なら無料、それを超えると<strong>全体の 1%</strong>。年間でいくらになるかを、同じアプリのサーバー代と並べました。",
    colRevenue: "月間収益",
    colFee: "RevenueCat（年間）",
    colServers: "サーバー（年間）",
  },
  calc: {
    revenue: "アプリの月間収益",
    fee: "RevenueCat の取り分",
    servers: "実際のサーバー代",
    perYear: "／年",
    stackLabel: "年間の手数料の内訳：サーバーと RevenueCat の各チーム",
    /** HTML. {servers} and {rest} are percentages. */
    stackNote: "サーバーは {servers}。残りの {rest} は各チームの費用です：",
    /** {people} is a number, {salary} is like "$210K". */
    teamMeta: "約 {people} 人 · 標準的な給与 {salary}",
    ownersTitle: "あなたの 1% が、他人のエグジットを作る",
    /** {pct} is like "55%". */
    ownersInvestors: "ベンチャー投資家 · 約 {pct}",
    ownersRest: "創業者と従業員",
    ownersBarLabel: "ベンチャー投資家が保有する RevenueCat の株式は約 {pct}（私たちの推計）",
    /** HTML. {funding} is "$100 million"; {vc} is an amount that moves with the slider. */
    ownersText:
      "ベンチャー投資家は 5 回のラウンドで約 {funding} を RevenueCat に投じ、報じられた評価額から見て会社の半分以上を保有しています。支払いのたびに取り分をもらう必要はありません。あなたが払う手数料のひとつひとつが、彼らの持つ会社の価値を押し上げ、売却時に回収されるからです。持ち分で換算すると、あなたが毎年払う額のうち約 {vc} が彼らのリターンになっています。",
    investorsLabel: "RevenueCat の投資家",
    /** HTML. {days} is a number, {infra} an amount; both move with the slider. */
    punch: "あなたの 1% で買えるのは、RevenueCat のエンジニアの年間約 {days} 人日分。同じ仕事を自分で動かせば {infra} です。",
    /** HTML. {keep} is an amount that moves with the slider. */
    keep: "残りの {keep} は手元に。",
    ctaKeep: "1% を取り戻す →",
    ctaGithub: "GitHub で openpurr を見る",
  },
  teams: {
    eng: { name: "エンジニアリング", basis: "シニア SDK エンジニアの求人、$21.2万" },
    product: { name: "プロダクト、デザイン、データ", basis: "シニアプロダクトマネージャーの求人、$23万。シニアデータサイエンティスト、$22万" },
    sales: { name: "営業", basis: "Head of Sales の求人、$36.3万。シニアセールスエンジニア、$20万。プロダクトエキスパート、$13.3万" },
    growth: { name: "マーケティングとグロース", basis: "Head of Customer Growth の求人、$25.9万。CRO デザイナー、$20.5万。プロダクトマーケティング、$16.8万" },
    support: { name: "カスタマーサクセスとサポート", basis: "デベロッパーサポートエンジニアの求人、$11.8万" },
    community: { name: "デベロッパーリレーションズとコミュニティ", basis: "求人全体の中央値（約 $21.5万）を、職位の幅を考慮して割り引いたもの" },
    ops: { name: "オペレーション、財務、人事", basis: "セールス・オペレーションスペシャリストの求人、$16.7万。Head of People、$28万" },
    exec: { name: "経営陣", basis: "Head of Sales の求人（$36.3万）より上の人も、下の人も" },
  },
  faq: {
    title: "よくある質問",
    /** Each answer is also the page's FAQ structured data. Amounts are filled in by the page. */
    items: {
      cost: {
        q: "RevenueCat の料金はいくらですか？",
        /** {threshold} "$2,500"; {at10k} the yearly fee at $10,000 a month, {at100k} at $100,000 a month; {m10k} "$10,000", {m100k} "$100,000". */
        a: "RevenueCat の Pro プランは、月間の追跡収益が {threshold} 未満なら無料です。それを超えると、{threshold} を超えた分だけでなく全体の 1% がかかります。月 {m10k} を稼ぐアプリなら年 {at10k}、月 {m100k} なら年 {at100k} です。大規模なアカウントは Enterprise 価格を交渉できます。",
      },
      pays: {
        q: "RevenueCat の 1% の手数料は何に使われていますか？",
        /** {servers} and {fee} are yearly amounts for an app making {m25k} ("$25,000") a month; {people} is a number. */
        a: "ほとんどは会社そのものです。一般的なアプリを支えるサーバー代は月数ドル程度。月 {m25k} を稼ぐアプリなら、手数料 {fee} に対してサーバー代は年 {servers} です。残りは、エンジニアリング、営業、マーケティング、経営陣を含む約 {people} 人のチームに使われ、投資家のための企業価値を積み上げます。",
      },
      owns: {
        q: "RevenueCat を所有しているのは誰ですか？",
        /** {funding} "$100 million"; {investors} the list of firms, already joined; {pct} like "55%". */
        a: "RevenueCat は 5 回のラウンドで、{investors} などのベンチャー投資家から約 {funding} を調達しています。報じられた各ラウンドの評価額から積み上げると、投資家の持ち分は推定 {pct}。残りは創業者と従業員のものです。",
      },
      worth: {
        q: "RevenueCat の企業価値はいくらですか？",
        /** {valuation} "$500 million", {round} "$50 million", {revenue} "$30 million". */
        a: "RevenueCat は 2025 年に {round} のシリーズ C を調達した際、評価額 {valuation}、当時の年間売上は約 {revenue} と報じられました。これらは報道やアナリストの数字で、会社による開示ではありません。",
      },
      alternative: {
        q: "売上に応じた手数料のない RevenueCat の代替はありますか？",
        a: "あります。openpurr は、無料でオープンソースのセルフホスト型バックエンドで、公式の RevenueCat Purchases SDK で動作します。SDK のプロキシ URL を自分のサーバーに向けるだけで、購入処理のコードはそのまま。小規模なアプリなら Cloudflare の無料プランで動き、売上に応じた手数料も取引ごとの手数料もかかりません。",
      },
    },
  },
  more: {
    title: "たしかに、機能はもっとある",
    text: "RevenueCat が作っているのは購入バックエンドだけではありません。ペイウォール、実験、連携、サポート窓口。そのすべてを使うなら、払う価値はあるのかもしれません。でも必要なのが購入の検証とサブスクリプションの最新化だけなら、月数ドルのサーバーで済む仕事のために、これから稼ぐすべての売上の一部を差し出していることになります。",
  },
  method: {
    title: "推計の方法",
    /** HTML. Each item starts with a bold label. */
    fee: "<b>手数料：</b>RevenueCat の Pro プランの定価で、{threshold} 以上の月間追跡収益の 1%。大規模なアカウントは別の価格を交渉できます。",
    /** HTML. {calculator} becomes a link labelled with `calculatorLink`. */
    servers:
      "<b>サーバー：</b>その売上規模のアプリで openpurr Lite を Cloudflare 上で動かす費用で、{calculator}と同じモデルです。RevenueCat 自身のホスティング費用は公開されていません。これは同じ仕事を自分で動かしたときの費用です。",
    calculatorLink: "節約額の計算ツール",
    /** HTML. {used}, {low}, {high} are headcounts; {loaded} is "1.3". */
    teams:
      "<b>チーム：</b>人ではなく職種で分けています。人数は {used} 人と仮定し（公開されている推計は {low}〜{high} 人）、職種への配分は私たちが行いました。給与は、給与額を記載している RevenueCat の公開求人から取っています。各チームの費用は「人数 × 給与 × {loaded}」（税金、福利厚生、機材分）で、株式報酬は含みません。手数料のうちサーバー以外の部分を、これらの費用に比例して配分しています。",
    split:
      "<b>営業・グロースがエンジニアリングより多い理由：</b>{date} 時点で、RevenueCat の求人ページには {open} 件の募集がありました。内訳は営業、マーケティング、グロースが {gtm} 件、コアエンジニアリングが {eng} 件です。この段階の会社は市場開拓（go-to-market）の体制づくりを進めており、新たに出た Head of Sales の求人がページ内で最も給与の高い求人です。",
    /** HTML. {funding} "$100 million", {pct} like "55%", {revenue} "$30 million". */
    investors:
      "<b>投資家：</b>2018 年から 2025 年までの 5 回のラウンドで、合計約 {funding}。持ち分は公開されていないため、報じられた評価額から積み上げて計算しています。各ラウンドの投資家は調達額をポストマネー評価額で割った割合を得て、それ以前の株主は全員同じ割合だけ希薄化します。結果は約 {pct}。ストックオプションプールと Y Combinator のアクセラレーター持ち分は含めていません。投資家の持ち分は会社の価値に対するもので、費用の一項目ではないため、別に示しています。2025 年のラウンド時点で、会社の年間売上は約 {revenue}、ほぼ損益分岐点と報じられました。",
    colRound: "ラウンド",
    colRaised: "調達額",
    colValuation: "評価額",
    colLead: "リード投資家",
    notReported: "非公表",
    /** HTML. */
    affiliation: "<b>提携関係なし：</b>openpurr は RevenueCat とは無関係です。これらは私たちの推計であり、RevenueCat の数字ではありません。",
    assumptions: "チームごとの前提",
    colTeam: "チーム",
    colPeople: "人数",
    colSalary: "給与",
    colCost: "年間費用",
    colBasis: "給与の根拠",
  },
  sources: {
    title: "出典",
    /** One label per source, in this order. The links themselves are in English. */
    items: [
      "RevenueCat の料金：$2,500 から月間追跡収益の 1%",
      "RevenueCat の求人ページ（給与レンジつき、Ashby）",
      "給与が記載された過去の RevenueCat 求人（Greenhouse）",
      "TechCrunch：RevenueCat が $5,000万を調達、累計 $1億に（2025 年 5 月）",
      "TechCrunch：Y Combinator の Continuity Fund がリードした $4,000万のシリーズ B、評価額 $3億（2021 年）",
      "TechCrunch：Adjacent がリードした $1,200万のシリーズ C（2024 年）",
      "SaaStr：評価額 $700万だった 2018 年のシードと、その後のラウンド",
      "Multiples.vc：2025 年のラウンド時点で売上約 $3,000万、評価額 $5億（推計）",
      "従業員数の推計：TipRanks（185 人）",
      "従業員数の推計：TrueUp（130 人）",
    ],
    /** HTML. {date} is the date; {issue} becomes a link labelled with `issueLink`. */
    checked: "{date} に確認。古くなった情報に気づいたら、{issue}。",
    issueLink: "Issue でお知らせください",
  },
};
