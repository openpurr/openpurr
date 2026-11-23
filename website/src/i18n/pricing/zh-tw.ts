// The RevenueCat pricing page in this language (see en.ts for the notes).
import type { PricingDict } from "./en";

export const pricingZhTw: PricingDict = {
  meta: {
    title: "RevenueCat 定價：你的 1% 去哪了 · openpurr",
    description:
      "RevenueCat 抽走你 1% 的營收，伺服器成本卻幾乎可以忽略。剩下的錢去了哪裡：薪資、業務和創投。",
    ogImageAlt: "RevenueCat 抽走你 1% 的營收，伺服器成本卻微不足道。剩下的錢花在哪裡？",
  },
  hero: {
    crumb: "RevenueCat 定價",
    eyebrow: "你的 1% 去了哪裡",
    headline: "你付的不是伺服器的錢。",
    /** The headline's second, highlighted sentence. {valuation} is "$500 million". */
    headlineAccent: "你在養一家估值 {valuation} 的公司。",
    /** {threshold} is "$2,500". */
    lede: "每月追蹤營收超過 {threshold} 後，RevenueCat 就抽走全部追蹤營收的 1%，而且你每成長一次，帳單就跟著漲一次。支撐你 App 的伺服器成本微不足道。剩下的錢養的是這家公司：它的薪資、它的業務團隊，還有它的投資人的報酬。",
    updated: "更新於 {date} · 根據公開數據估算",
  },
  answer: {
    title: "一句話看懂 RevenueCat 定價",
    /** HTML. {threshold} is "$2,500". */
    text: "每月追蹤營收低於 {threshold} 免費，超過後收取<strong>全部營收的 1%</strong>。一年下來是多少，再對照同一個 App 的伺服器成本：",
    colRevenue: "月營收",
    colFee: "RevenueCat 年費",
    colServers: "伺服器年成本",
  },
  calc: {
    revenue: "你的 App 月營收",
    fee: "RevenueCat 抽走",
    servers: "伺服器實際成本",
    perYear: "/年",
    stackLabel: "你的年費：伺服器與 RevenueCat 各團隊的占比",
    /** HTML. {servers} and {rest} are percentages. */
    stackNote: "伺服器：{servers}。其餘 {rest} 都花在他們的團隊上：",
    /** {people} is a number, {salary} is like "$210K". */
    teamMeta: "約 {people} 人 · 一般薪資 {salary}",
    ownersTitle: "而其中一大半，是在替別人的出場鋪路",
    /** {pct} is like "55%". */
    ownersInvestors: "創投 · 約 {pct}",
    ownersRest: "創辦人和員工",
    ownersBarLabel: "創投持有 RevenueCat 約 {pct} 的股份（我們的估算）",
    /** HTML. {funding} is "$100 million"; {vc} is an amount that moves with the slider. */
    ownersText:
      "創投分五輪向 RevenueCat 投入了約 {funding}，依報導的估值計算，他們擁有公司一半以上的股份。他們不需要從每筆付款裡抽成：你付的每一筆費用都在推高他們所持公司的價值，等公司出售時再一次收回。依持股比例算，你每年支付的費用中約有 {vc} 在替他們累積報酬。",
    investorsLabel: "RevenueCat 的投資人",
    /** HTML. {days} is a number, {infra} an amount; both move with the slider. */
    punch: "你的 1% 每年能買到 RevenueCat 約 {days} 個工程師人日。同樣的工作自己跑，只要 {infra}。",
    /** HTML. {keep} is an amount that moves with the slider. */
    keep: "剩下的 {keep}，留給自己。",
    ctaKeep: "留住你的 1% →",
    ctaGithub: "GitHub 上的 openpurr",
  },
  teams: {
    eng: { name: "工程", basis: "資深 SDK 工程師職缺，21.2 萬美元" },
    product: { name: "產品、設計與數據", basis: "資深產品經理職缺，23 萬美元；資深資料科學家，22 萬美元" },
    sales: { name: "業務", basis: "Head of Sales 職缺，36.3 萬美元；資深銷售工程師，20 萬美元；產品專家，13.3 萬美元" },
    growth: { name: "行銷與成長", basis: "Head of Customer Growth 職缺，25.9 萬美元；CRO 設計師，20.5 萬美元；產品行銷，16.8 萬美元" },
    support: { name: "客戶成功與支援", basis: "開發者支援工程師職缺，11.8 萬美元" },
    community: { name: "開發者關係與社群", basis: "所有職缺的整體中位數（約 21.5 萬美元），依職級組成打了折扣" },
    ops: { name: "營運、財務與人資", basis: "業務與營運專員職缺，16.7 萬美元；Head of People，28 萬美元" },
    exec: { name: "高階主管", basis: "有的高於 Head of Sales 職缺（36.3 萬美元），有的低於它" },
  },
  faq: {
    title: "常見問題",
    /** Each answer is also the page's FAQ structured data. Amounts are filled in by the page. */
    items: {
      cost: {
        q: "RevenueCat 收費多少？",
        /** {threshold} "$2,500"; {at10k} the yearly fee at $10,000 a month, {at100k} at $100,000 a month; {m10k} "$10,000", {m100k} "$100,000". */
        a: "RevenueCat 的 Pro 方案在每月追蹤營收低於 {threshold} 時免費。超過之後，按全部營收的 1% 收費，而不只是超出 {threshold} 的部分：月營收 {m10k} 的 App 每年要付 {at10k}，月營收 {m100k} 則每年要付 {at100k}。大型帳戶可以議定 Enterprise 價格。",
      },
      pays: {
        q: "RevenueCat 的 1% 費用花在哪裡？",
        /** {servers} and {fee} are yearly amounts for an app making {m25k} ("$25,000") a month; {people} is a number. */
        a: "主要花在公司本身。一個典型 App 背後的伺服器每月只要幾美元：月營收 {m25k} 的 App，伺服器每年成本 {servers}，而費用是 {fee}。剩下的錢用來養一支約 {people} 人的團隊，包括工程、業務、行銷和高階主管，並替公司的投資人累積價值。",
      },
      owns: {
        q: "RevenueCat 是誰的？",
        /** {funding} "$100 million"; {investors} the list of firms, already joined; {pct} like "55%". */
        a: "RevenueCat 已分五輪向創投募資約 {funding}，投資方包括 {investors}。依報導的各輪估值逐輪推算，投資人估計持有公司 {pct} 的股份，其餘屬於創辦人和員工。",
      },
      worth: {
        q: "RevenueCat 值多少錢？",
        /** {valuation} "$500 million", {round} "$50 million", {revenue} "$30 million". */
        a: "據報導，RevenueCat 在 2025 年完成 {round} 的 C 輪募資時估值 {valuation}，當時年營收約 {revenue}。這些是媒體和分析師的數據，並非公司揭露。",
      },
      alternative: {
        q: "有沒有不抽營收分潤的 RevenueCat 替代方案？",
        a: "有。openpurr 是免費、開源、自架的後端，相容於官方的 RevenueCat Purchases SDK。你只要把 SDK 的 Proxy URL 指向自己的伺服器，購買程式碼保持不變。小型 App 用 Cloudflare 免費方案就能執行，沒有營收分潤，也沒有按交易計算的費用。",
      },
    },
  },
  more: {
    title: "沒錯，他們做得更多",
    text: "RevenueCat 做的不只是購買後端：付費牆、實驗、整合、客服支援。如果這些你全都用，也許對你來說值得。但如果你需要的只是驗證購買、讓訂閱狀態保持最新，那你就是在為一份每月幾美元伺服器就能搞定的工作，交出你未來所有營收的一部分。",
  },
  method: {
    title: "我們如何估算",
    /** HTML. Each item starts with a bold label. */
    fee: "<b>你的費用：</b>RevenueCat Pro 方案的定價，從 {threshold} 起按每月追蹤營收的 1% 收費。大型帳戶可以議定其他價格。",
    /** HTML. {calculator} becomes a link labelled with `calculatorLink`. */
    servers:
      "<b>伺服器：</b>該營收規模的 App 在 Cloudflare 上執行 openpurr Lite 的成本，與我們的{calculator}採用相同模型。RevenueCat 自己的代管成本並未公開；這是你自己執行同樣工作的成本。",
    calculatorLink: "節省試算工具",
    /** HTML. {used}, {low}, {high} are headcounts; {loaded} is "1.3". */
    teams:
      "<b>團隊：</b>依職能劃分，而不是具體的人。我們假設共 {used} 人（公開估計在 {low} 到 {high} 人之間），並自行分配到各職能。薪資來自 RevenueCat 標明薪酬的公開職缺；每個團隊的成本 = 人數 × 薪資 × {loaded}（稅費、福利和設備），不含股權。你的費用中伺服器以外的部分，依這些成本的比例分攤。",
    /** HTML. {funding} "$100 million", {pct} like "55%", {revenue} "$30 million". */
    investors:
      "<b>投資人：</b>2018 年至 2025 年共五輪，總計約 {funding}。持股比例並未公開，因此我們根據報導的估值逐輪推算：每輪投資人取得的比例為投資金額除以投後估值，先前所有股東按同一比例被稀釋。由此得出約 {pct}。員工認股權池和 Y Combinator 的加速器股份未計入。他們的份額是公司價值的一部分，而不是成本中的一項，所以另外列出。據報導，在 2025 年那輪募資時，公司年營收約 {revenue}，接近損益兩平。",
    colRound: "輪次",
    colRaised: "募資金額",
    colValuation: "估值",
    colLead: "領投方",
    notReported: "未公開",
    /** HTML. */
    affiliation: "<b>無關聯：</b>openpurr 與 RevenueCat 沒有任何關聯。這些是我們的估算，而非 RevenueCat 的數據。",
    assumptions: "各團隊的假設",
    colTeam: "團隊",
    colPeople: "人數",
    colSalary: "薪資",
    colCost: "年成本",
    colBasis: "薪資來源",
  },
  sources: {
    title: "資料來源",
    /** One label per source, in this order. The links themselves are in English. */
    items: [
      "RevenueCat 定價：每月追蹤營收從 2,500 美元起收取 1%",
      "RevenueCat 徵才頁面，含薪資範圍（Ashby）",
      "RevenueCat 過去標明薪資的職缺（Greenhouse）",
      "TechCrunch：RevenueCat 募資 5,000 萬美元，累計募資達 1 億美元（2025 年 5 月）",
      "TechCrunch：Y Combinator Continuity Fund 領投的 4,000 萬美元 B 輪，估值 3 億美元（2021 年）",
      "TechCrunch：Adjacent 領投的 1,200 萬美元 C 輪（2024 年）",
      "SaaStr：2018 年估值 700 萬美元的種子輪，以及之後各輪",
      "Multiples.vc：2025 年那輪募資時營收約 3,000 萬美元、估值 5 億美元（估算）",
      "員工人數估算：TipRanks（185 人）",
      "員工人數估算：TrueUp（130 人）",
    ],
    /** HTML. {date} is the date; {issue} becomes a link labelled with `issueLink`. */
    checked: "查核於 {date}。發現資訊過時了？{issue}。",
    issueLink: "開一個 Issue",
  },
};
