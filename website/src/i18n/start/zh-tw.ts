// The "Add in-app purchases" page in this language (see en.ts for the notes).
import type { StartDict } from "./en";

export const startZhTw: StartDict = {
  meta: {
    title: "免費為你的 App 加入 App 內購買和訂閱 - openpurr",
    description:
      "要做新 App？用官方 Purchases SDK 和你自己架設的開源後端加入 App 內購買與訂閱，永遠沒有營收分潤。",
    ogImageAlt: "要做新 App？從一開始就不付營收分潤。留住你的 1%，投資你的事業。",
  },
  hero: {
    crumb: "加入 App 內購買",
    eyebrow: "給新 App",
    headline: "要做新 App？",
    headlineAccent: "從一開始就不付營收分潤。",
    /** {threshold} is "$2,500". */
    lede: "大多數購買後端在你的月營收超過 {threshold} 後抽走 1%，而且你每成長一次，帳單就跟著漲一次。在第一筆銷售之前避開它最容易。openpurr 是免費、開源、由你自己架設的 App 內購買與訂閱後端，使用的是大平台同款的官方 SDK。",
    ctaStart: "在 GitHub 上開始",
    ctaHow: "運作方式",
  },
  growth: {
    title: "你的 1%，從第一天算起",
    text: "選一個你預計 App 三年後能達到的規模。假設從零開始穩定成長，看看這一路上 1% 的營收分潤會累積多少。",
    target: "三年後的月營收",
    /** Labels for the totals. */
    fee: "1% 營收分潤，三年合計",
    servers: "自己架設，三年合計",
    after: "之後每年",
    /** The chart's accessible description. */
    chartLabel: "三年內逐月累積的營收分潤",
    /** HTML. {fee} and {servers} are amounts that move with the slider. */
    summary: "到第四年之前，你要交出 <b>{fee}</b>，而自己的伺服器只要 <b>{servers}</b>。把錢留下來，投入你的事業。",
  },
  invest: {
    title: "投資你的事業，也投資你自己",
    text: "留住一年的 1%，能買些什麼：",
  },
  how: {
    title: "運作方式",
    lede: "四個步驟，你寫的程式碼和任何 RevenueCat 教學裡的一樣。",
    steps: [
      {
        title: "部署 openpurr",
        /** HTML. */
        text: "在你的 Cloudflare 帳號上執行安裝程式。小型 App 用 Lite 就能放進<b>免費方案</b>，安裝中途停下也可以放心重新執行。",
      },
      {
        title: "加入 App 和產品",
        text: "儀表板一打開就引導你加入第一個 App：先填 Bundle ID 和套件名稱，再設定產品、權益和 Offering。",
      },
      {
        title: "加入 Purchases SDK",
        /** HTML. */
        text: "安裝官方的 RevenueCat Purchases SDK（以 MIT 授權開源），並在 configure 之前設定<b>一個 Proxy URL</b>。",
      },
      {
        title: "上架",
        text: "購買會透過 Apple 和 Google 驗證，續訂和退款會經由商店通知送達，你的後端會收到 Webhook。在用 Claude Code 嗎？openpurr 外掛會一步步帶你完成 App Store Connect 和 Play Console 的設定。",
      },
    ],
    /** Above the setup commands. */
    setupLabel: "在你的電腦上安裝",
  },
  includes: {
    title: "你能得到什麼",
    yes: [
      "App Store 和 Google Play 上的購買與訂閱",
      "權益和 Offering",
      "傳送到你後端的 Webhook，經過簽章並自動重試",
      "16 種圖表：營收、MRR、流失、試用等",
      "價格實驗",
      "資料存放在你自己的資料庫中",
    ],
    notYetTitle: "尚未支援",
    notYet: "付費牆建構工具、第三方分析整合、廣告事件、網頁付款和 Amazon。如果你一開始就需要這些，商業平台現在就能提供。",
  },
  lockin: {
    title: "不管怎麼選，都不會被綁住",
    text: "openpurr 使用標準的 Purchases SDK，所以你的購買程式碼在兩種後端上都能執行。如果 openpurr 不夠用了，或是你想要商業平台額外的功能，切換只需要改設定、匯入客戶，不必重寫程式碼。",
  },
  pricingLink: {
    text: "好奇真的付了 1%，錢都去了哪裡？",
    link: "查看 RevenueCat 定價拆解 →",
  },
  faq: {
    title: "常見問題",
    /** Each answer is also the page's FAQ structured data. */
    items: {
      backend: {
        q: "App 內購買需要後端嗎？",
        a: "嚴格來說不需要：StoreKit 和 Google Play Billing 在裝置上執行。但有了後端，訂閱狀態才可靠。它會透過 Apple 和 Google 驗證購買，藉由商店通知追蹤續訂、取消和退款，並告訴你的 App 和伺服器誰有存取權。openpurr 就是這樣的後端，由你自己架設。",
      },
      cheapest: {
        q: "為 iOS 或 Android App 加入訂閱，最便宜的方式是什麼？",
        /** {servers} a yearly amount, {m25k} "$25,000". */
        a: "自己架設後端。小型 App 用 openpurr Lite 就能放進 Cloudflare 免費方案，並搭配免費開源的 Purchases SDK，所以你只需要支付伺服器費用：依我們的模型，月營收 {m25k} 的 App 每年約 {servers}，沒有營收分潤。",
      },
      free: {
        q: "openpurr 真的免費嗎？",
        a: "是的。它以 Apache 2.0 授權開源，沒有營收分潤，也沒有按交易計算的費用。你只需要支付自己的伺服器費用，小型 App 用 Cloudflare 免費方案就夠了。",
      },
      switch: {
        q: "以後可以換成 RevenueCat 嗎？",
        a: "可以。openpurr 使用官方的 RevenueCat Purchases SDK，所以 App 的購買程式碼在兩種後端上都能執行，你在商店中的產品也維持不變。切換只需要改設定，再搬移客戶紀錄。",
      },
      missing: {
        q: "openpurr 目前還不支援什麼？",
        a: "付費牆建構工具、第三方分析整合、廣告事件、網頁付款和 Amazon。價格實驗已內建。如果你一開始就需要其餘功能，商業平台現在就能提供。",
      },
    },
  },
};
