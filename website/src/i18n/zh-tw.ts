// Traditional Chinese (Taiwan) copy. Follows en.ts; see the notes there. Uses 你 and Taiwan terms (自架, 軟體, 伺服器, 資料庫, 程式碼, 帳號); entitlement is 權益 throughout.
import type { Dict } from "./en";

export const zhTw: Dict = {
  meta: {
    title: "openpurr：自架、開源的 RevenueCat 替代方案",
    description:
      "openpurr 是自架、開源的 RevenueCat 替代方案，為 App Store 和 Google Play 的 App 內購買與訂閱提供後端。繼續使用你現有的 Purchases SDK，把它指向你自己的伺服器，不必支付營收分潤。",
    ogImageAlt: "openpurr：自架、開源的 RevenueCat 替代方案，旁邊是它的訂閱圖表儀表板",
  },
  header: {
    home: "openpurr 首頁",
    nav: { features: "功能", editions: "版本", roadmap: "路線圖", faq: "常見問題", migrate: "遷移" },
    language: "語言",
  },
  footer: {
    tagline: "由你自己執行的開源購買基礎架構。",
    roadmap: "路線圖",
    contributing: "參與貢獻",
    sponsor: "贊助",
    contact: "聯絡我們",
    privacy: "隱私權政策（英文）",
    disclaimer:
      "openpurr 是獨立專案，與 RevenueCat, Inc. 沒有任何關聯，也未獲得其認可。App Store 是 Apple Inc. 的商標。Google Play 是 Google LLC 的商標。",
    copyright: "版權所有 {year} openpurr 貢獻者。",
    cookieSettings: "Cookie 設定",
  },
  consent: {
    label: "Cookie 同意",
    text: "我們想使用 Google Analytics 的 Cookie 來計算造訪次數，並了解哪些頁面有幫助。在你同意之前不會設定任何 Cookie，你也可以隨時在「Cookie 設定」中改變決定。",
    privacy: "隱私權政策（英文）",
    decline: "拒絕",
    accept: "接受",
  },
  snippet: {
    tabs: "SDK 平台",
    note: "只要一行。同樣的 SDK，同樣的購買程式碼。",
  },
  home: {
    hero: {
      title: '<span class="nowrap">自架</span>、開源的 <span class="accent">RevenueCat <span class="nowrap">替代方案</span></span>',
      lede: "自己掌控購買基礎架構，不分出任何營收，也不依賴任何商業服務。繼續使用你現有的 Purchases SDK：只要改一個 URL，不用改購買程式碼。",
      star: "在 GitHub 上給個 Star",
      how: "運作方式",
      shotAlt: "openpurr Lite 儀表板，顯示 12 個月的 MRR 變動、有效訂閱、流失、新客戶、新增試用和進行中的試用",
    },
    why: {
      eyebrow: "適合誰",
      title: "適合想自己掌握後端的 App 開發者",
      lede: "openpurr 相容於官方、未經修改的 SDK。切換只要從改一個 URL 開始，不必重寫購買程式碼。",
      reasons: [
        {
          title: "你的資料，你的伺服器",
          body: "購買紀錄、權益和商店憑證都存放在你自己執行的資料庫中，你可以隨時查詢、備份和匯出。你的 App 和客戶之間沒有任何外部服務。",
        },
        {
          title: "沒有營收分潤",
          body: "不抽營收百分比，也沒有按交易計算的費用。Lite 版專為 Cloudflare 免費方案設計，小型 App 可以零成本執行。",
        },
        {
          title: "不必依賴任何廠商",
          body: "程式碼以 Apache 2.0 授權開源。你可以閱讀、修改程式碼，並在 Cloudflare 和你自己的雲端之間搬移。",
        },
      ],
    },
    how: {
      eyebrow: "運作方式",
      title: "你的伺服器取代了原本廠商的位置",
      lede: "你的 App 繼續使用已經內建的開源 Purchases SDK。SDK 與 openpurr 溝通，openpurr 與各商店溝通、保存訂閱狀態，並把變化通知你的後端。",
      flowLabel: "請求流程",
      app: "你的 App",
      sdkLicense: "官方、未經修改、MIT 授權",
      sdkPlatforms: "iOS、Android、Flutter 或 React Native",
      coreWhere: "執行於 Cloudflare Workers 或你自己的雲端",
      appStoreApi: "Server API 和通知",
      playApi: "Developer API 和 RTDN",
      backend: "你的後端",
      backendHooks: "經過簽章的 Webhook",
      steps: [
        {
          title: "部署",
          body: "在你自己的 Cloudflare 帳號上執行 openpurr Lite。引導式安裝指令 <code>pnpm run setup</code> 會建立資料庫、部署兩個 Worker，並建立你的擁有者帳號。",
        },
        {
          title: "設定 SDK",
          body: "在呼叫 <code>configure</code> 之前設定 Proxy URL。請使用你自己擁有的自訂網域，方便日後搬移。",
        },
        {
          title: "連接商店",
          body: "加入你的商店憑證和通知 URL。安裝檢查指令 <code>openpurr doctor</code> 會驗證這些設定，並告訴你如何補上缺少的部分。",
        },
      ],
    },
    features: {
      eyebrow: "功能",
      title: "訂閱後端，不含你用不到的額外功能",
      items: [
        {
          title: "購買",
          body: "驗證 StoreKit 2 交易和 Google Play 購買，並回傳 SDK 所需的 CustomerInfo 和權益。",
        },
        {
          title: "商店通知",
          body: "接收 App Store Server Notifications V2 和 Google Play Real-time Developer Notifications，讓續訂、退款和寬限期的狀態保持最新。",
        },
        {
          title: "Webhook",
          body: "向你的後端傳送與 RevenueCat 格式相同的事件，以 HMAC-SHA256 簽章，失敗時會在約 72 小時內重試。",
        },
        {
          title: "圖表",
          body: "16 張圖表：營收、MRR 和 ARR、MRR 與訂閱變動、有效訂閱和付費訂閱、訂閱狀態、流失、試用與試用轉換、新客戶、退款與退款率，以及一次性購買。可依 App、商店、產品和環境篩選，營收統一換算為美元。",
        },
        {
          title: "驗證與稽核",
          body: "SDK 金鑰和私密金鑰、可選用驗證器 App 動態密碼的管理員登入、角色、存取權杖，以及稽核記錄。",
        },
        {
          title: "MCP 伺服器和 Claude Skills",
          body: "請 AI 助理說明某位客戶為什麼有或沒有某項權益、查詢購買紀錄，或一步步帶你完成 App Store Connect 和 Play Console 的設定。",
        },
      ],
    },
    editions: {
      eyebrow: "兩個版本",
      title: "從小規模開始，升級不必更新 App",
      lede: "兩個版本都通過同一套一致性測試。只要你的 App 指向你自己擁有的自訂網域，從 Lite 升級到 Standard 就不需要發布新版 App。",
      lite: {
        badge: "適合獨立開發者",
        price: "$0",
        priceNote: "使用 Cloudflare 免費方案",
        items: ["以 TypeScript 實作，執行於 Cloudflare Workers 和 D1", "輕量，執行成本低", "在達到免費方案上限前發出用量提醒"],
      },
      standard: {
        badge: "即將推出",
        price: "你的雲端帳單",
        priceNote: "沒有其他費用",
        items: ["在容器中執行的 Go 和 Postgres", "GCP 或 AWS", "適合擁有較多 App 的團隊"],
      },
    },
    savings: {
      title: "和 RevenueCat 相比，你能留下多少",
      lede: "RevenueCat 的 Pro 方案在每月追蹤營收低於 2,500 美元時免費，超過後按全部營收的 1% 收費。Lite 在 Cloudflare 免費方案上執行；當 App 超出免費額度後，可改用每月 5 美元起的 Workers Paid。",
      revenue: "月營收",
      rc: "RevenueCat",
      op: "openpurr Lite",
      saved: "每年省下",
      perMonth: "每月 {amount}",
      free: "Cloudflare 免費方案",
      paid: "Cloudflare Workers Paid",
      chartLabel: "依月營收計算的每月費用：RevenueCat 的費用隨營收上升，openpurr Lite 的費用接近於零",
      gapLegend: "你留下的部分",
      tableSummary: "在其他營收規模下比較",
      colRevenue: "月營收",
      colRc: "RevenueCat（每月）",
      colOp: "openpurr Lite（每月）",
      colSaved: "每年省下",
      methodSummary: "我們如何估算",
      method: [
        "RevenueCat：Pro 方案的定價，即從 2,500 美元起按每月追蹤營收的 1% 收費。追蹤營收會把年訂閱和一次性購買計入付款當月，因此可能高於 MRR。大型帳戶可以議定 Enterprise 價格。",
        "openpurr Lite：Cloudflare 的 Workers 和 D1 價格。我們假設每位每日活躍使用者每月帶來約 1.50 美元營收，每天發出約 10 個 SDK 請求。照此計算，免費方案每天 100,000 個請求可涵蓋約 {paidFrom} 的月營收，並保留餘裕。超過後以 Workers Paid 計算：每月 5 美元，超出 1,000 萬個請求的部分每百萬個請求 0.30 美元。",
        "未計入：你維運它所花的時間。兩種方式的商店費用都一樣。",
        "價格查核於 {date}。openpurr 與 RevenueCat 沒有關聯。",
      ],
    },
    fit: {
      eyebrow: "老實說",
      title: "它現在可能還不適合你",
      lede: "如果你需要付費牆建構工具、A/B 實驗、第三方分析整合或支援合約，目前商業平台已經能提供這些。",
      outTitle: "目前暫不支援",
      tags: ["付費牆", "廣告事件", "Customer Center", "虛擬貨幣", "Web 計費", "Amazon", "分析整合"],
    },
    roadmap: {
      eyebrow: "路線圖",
      title: "未來方向",
      lede: "順序已經確定，但沒有時程。如果某項功能對你很重要，請在 Issue 中告訴我們。",
      status: { done: "已完成", wip: "進行中", planned: "已規劃", later: "由你決定" },
      phases: [
        {
          phase: "Lite",
          items: [
            "最新版本：{version}",
            "專為 Cloudflare 免費方案設計",
            "App Store 和 Google Play",
            "Webhook、儀表板和管理後台",
            "一次部署支援多個 App",
            "MCP 伺服器、CLI 和 Claude Skills",
            "下一步：實機測試，然後發布 1.0",
          ],
        },
        {
          phase: "Standard",
          items: ["在容器中執行的 Go 和 Postgres", "先支援 GCP，再支援 AWS", "與 Lite 使用同一套一致性測試", "從 Lite 搬移不必更新 App"],
        },
        {
          phase: "由社群決定",
          items: ["經過驗證的終端使用者身分", "為大型團隊提供的 Standard 進階功能", "你在 Issue 中提出的任何需求"],
        },
      ],
      more: "查看完整路線圖（英文）→",
    },
    cta: {
      title: "一起讓它更好",
      body: "目前最有幫助的是意見回饋：指出我們對 SDK 或商店的錯誤假設，以及續訂、退款和寬限期中實際遇到的邊界情況。",
      star: "在 GitHub 上給個 Star",
      issue: "提交 Issue",
      coffee: "請我們喝杯咖啡",
    },
  },
  faq: {
    eyebrow: "常見問題",
    title: "openpurr：RevenueCat 替代方案",
    lede: "自己執行訂閱後端之後，哪些會改變，哪些不會。",
    items: [
      {
        q: "openpurr 是什麼？",
        a: "openpurr 是開源、自架的 RevenueCat 替代方案。它是 App 內購買和訂閱的後端，相容於官方的 RevenueCat Purchases SDK。它會驗證 App Store 和 Google Play 的購買、追蹤權益、接收商店通知、向你的後端傳送 Webhook，並以圖表呈現核心訂閱指標，而且全部都在你掌控的基礎架構上執行。",
      },
      {
        q: "openpurr 和 RevenueCat 有什麼不同？",
        a: "RevenueCat 是代管的商業服務，超過免費額度後會依營收比例收費。openpurr 是你自己執行的軟體：你的購買紀錄、權益和商店憑證都存放在你自己的資料庫中，沒有營收分潤，也沒有按交易計算的費用。RevenueCat 目前提供更多功能，例如付費牆、實驗和分析整合。openpurr 則專注於核心的訂閱後端。",
      },
      {
        q: "從 RevenueCat 切換過來，需要重寫購買程式碼嗎？",
        a: "不需要。openpurr 相容於官方、未經修改的 Purchases SDK。你只要在呼叫 configure 之前，把 SDK 的 Proxy URL 設為你的 openpurr 伺服器，其餘購買程式碼都不用改。請指向你自己擁有的自訂網域，這樣日後更換伺服器時就不必更新 App。",
      },
      {
        q: "要怎麼把現有客戶從 RevenueCat 搬過來？",
        a: "用匯入的方式。向 RevenueCat 申請遷移匯出檔，接著 openpurr import 指令會從 Apple 和 Google 取得每位客戶的購買紀錄，並對應到相同的 App User ID。新版 App 也會把每位客戶的購買紀錄傳送一次，在使用者陸續更新期間，兩個後端都會保持同步，因此不會有人失去存取權。",
        link: "遷移指南",
      },
      {
        q: "openpurr 支援哪些平台和商店？",
        a: "openpurr 支援 iOS、Android、Flutter 和 React Native 的 Purchases SDK，以及來自 App Store 和 Google Play 的購買。Amazon 和 Web 計費目前暫不支援。",
      },
      {
        q: "openpurr 要多少錢？",
        a: "openpurr 免費且開源，採用 Apache 2.0 授權。你只需要支付它所執行的基礎架構費用。Lite 版專為 Cloudflare 免費方案設計，小型 App 可以零成本執行。Standard 版以容器方式在你自己的雲端上執行，成本就是你的雲端帳單。",
      },
      {
        q: "我的資料存放在哪裡？",
        a: "存放在你自己的資料庫中。Lite 版使用你 Cloudflare 帳號中的 Cloudflare D1，Standard 版使用 GCP 或 AWS 上的 Postgres。你可以查詢、備份和匯出資料，你的 App 和客戶之間沒有任何外部服務。",
      },
      {
        q: "openpurr 會像 RevenueCat 一樣傳送 Webhook 嗎？",
        a: "會。openpurr 會向你的後端傳送與 RevenueCat 格式相同的事件，以 HMAC-SHA256 簽章，失敗時會在約 72 小時內重試，因此現有的 Webhook 處理程式幾乎不需要修改。",
      },
      {
        q: "RevenueCat 有哪些功能是 openpurr 沒有的？",
        a: "付費牆、第三方分析整合、Customer Center、虛擬貨幣、Web 計費、Amazon、廣告事件和商業支援合約目前都暫不支援。價格實驗已列入路線圖。如果你現在就需要這些功能，商業平台會比較適合你。",
      },
      {
        q: "openpurr 可以用在正式環境了嗎？",
        a: "還不行。openpurr 仍在早期階段：Lite 版正在開發中，Standard 版之後才會推出。你可以在 GitHub 上追蹤路線圖，如果某項功能對你很重要，歡迎提交 Issue。",
      },
      {
        q: "openpurr 和 RevenueCat 有關聯嗎？",
        a: "沒有。openpurr 是獨立的開源專案，與 RevenueCat, Inc. 沒有任何關聯，也未獲得其認可。它相容於 RevenueCat 官方的 Purchases SDK，而該 SDK 採用 MIT 授權。",
      },
    ],
  },
  structured: {
    description:
      "自架、開源的 RevenueCat 替代方案：為 App Store 和 Google Play 的 App 內購買與訂閱提供後端，相容於官方、未經修改的 Purchases SDK。它會驗證購買、追蹤權益、接收商店通知、傳送 Webhook，並以圖表呈現訂閱指標。",
    subCategory: "App 內購買與訂閱後端",
    features: [
      "相容於官方 RevenueCat Purchases SDK，支援 iOS、Android、Flutter 和 React Native",
      "StoreKit 2 和 Google Play 購買驗證",
      "App Store Server Notifications V2 和 Google Play Real-time Developer Notifications",
      "與 RevenueCat 格式相同的 Webhook，以 HMAC-SHA256 簽章",
      "16 張訂閱圖表，包括 MRR、流失和試用轉換",
      "MCP 伺服器、CLI 和 Claude Skills",
    ],
  },
};
