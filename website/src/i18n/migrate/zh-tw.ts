// Traditional Chinese (Taiwan) copy of the migration page. Follows en.ts; see the notes there.
import type { MigrateDict } from "./en";

export const migrateZhTw: MigrateDict = {
  meta: {
    title: "從 RevenueCat 遷移到 openpurr：逐步教學",
    description:
      "把你的 App 從 RevenueCat 遷移到開源的 RevenueCat 替代方案 openpurr：繼續使用 Purchases SDK，匯入每一位訂閱者，並保留他們的存取權。",
    ogImageAlt:
      "從 RevenueCat 遷移到 openpurr，不流失任何訂閱者：繼續使用 Purchases SDK，匯入每一位客戶，舊版 App 也能照常運作。",
  },
  hero: {
    crumb: "從 RevenueCat 遷移",
    eyebrow: "遷移指南",
    headline: "從 RevenueCat 遷移到 openpurr，不流失任何訂閱者",
    lede: "繼續使用你的 App 已經內建的 Purchases SDK。從 RevenueCat 的匯出檔匯入現有客戶：openpurr 會自己向 Apple 和 Google 取得每一筆購買。在使用者陸續更新期間，舊版 App 也能照常運作。",
    guide: "閱讀逐步指南（英文）",
    steps: "查看步驟",
    updated: "更新於 {date}",
  },
  summary: {
    title: "重點整理",
    items: [
      "openpurr 是自架、開源的 RevenueCat 替代方案，相容於官方、未經修改的 RevenueCat Purchases SDK。",
      "你的 App 只要加一行程式碼（SDK 的 Proxy URL）和一次性的 <code>syncPurchases</code> 呼叫，其餘購買程式碼都不用改。",
      "<code>openpurr import</code> 會從 RevenueCat 的匯出檔匯入現有客戶。購買紀錄本身是向 Apple 和 Google 取得，而不是複製過來。",
      "App Store 的 App 可以使用 RevenueCat 的 Scheduled Data Export。Google Play 則需要向 RevenueCat Support 申請遷移匯出檔，只有它包含購買權杖（purchase token）。",
      "在大多數使用者更新 App 之前，兩個後端都會保持同步，因此不會有人失去存取權。",
      "使用 Cloudflare 免費方案時，匯入每天可處理約 2,500 位客戶。使用 Workers Paid 時，大量匯入只要幾個小時。",
    ],
  },
  how: {
    eyebrow: "運作方式",
    title: "RevenueCat 遷移如何運作",
    lede: "openpurr 不會從 RevenueCat 複製購買紀錄。它只需要知道誰擁有哪一筆購買，然後向商店查詢，做法和你的 App 回報購買時完全相同。",
    ways: [
      {
        title: "匯入",
        body: "RevenueCat 的匯出檔記錄了哪位 App 使用者擁有哪一筆商店購買。<code>openpurr import</code> 會向 Apple 和 Google 查詢每一筆購買，並把商店回傳的結果記錄到該使用者名下。它一次就把所有人搬過來，包括再也不會開啟 App 的使用者。",
      },
      {
        title: "App 更新",
        body: "新版 App 會把 Purchases SDK 指向 openpurr，並透過 <code>syncPurchases</code> 把每位客戶的購買紀錄傳送一次。這樣就能涵蓋匯出檔遺漏的使用者，以及在匯出之後才購買的使用者。",
      },
      {
        title: "兩個後端並行一段時間",
        body: "在使用者更新之前，舊版 App 會繼續與 RevenueCat 溝通。RevenueCat 會把 Apple 的通知轉送給 openpurr，再加上第二個 Pub/Sub 訂閱為 Google 做同樣的事，兩個後端因此都保持最新。",
      },
    ],
  },
  app: {
    eyebrow: "在你的 App 中",
    title: "你的 App 要改哪些地方",
    lede: "在 configure 之前設定 Proxy URL，並把每位客戶的購買紀錄傳送一次。同樣的兩處修改也適用於 Android、Flutter 和 React Native，指南中有各平台的程式碼。",
    codeLabel: "Swift 範例：Proxy URL 和一次性同步",
    proxyComment: "在 configure() 之前：大多數 App 只要加這一行",
    syncComment: "每次安裝執行一次：把這位客戶的購買紀錄傳送到 openpurr",
  },
  import: {
    eyebrow: "匯入",
    title: "從 RevenueCat 匯入客戶",
    lede: "openpurr CLI 會直接讀取 RevenueCat 匯出的各個欄位：App User ID、App Store 交易 ID、Google Play 購買權杖，以及 <code>$email</code> 等屬性。",
    codeLabel: "終端機：匯入 RevenueCat 的匯出檔",
    dryRunComment: "先檢查前幾列：會查詢 Apple 和 Google，但不寫入任何資料",
    importComment: "匯入所有人。隨時可以停止，再執行一次就會繼續。",
    safeguards: [
      ["不會有人失去存取權", "App 已經為某位客戶傳送過的購買仍屬於該客戶，匯入絕不會移動它。"],
      ["不會重複傳送 Webhook", "匯入的購買不是新購買，因此 openpurr 不會為它們傳送事件。"],
      ["圖表數據真實", "匯入的客戶以首次購買日期計算，不會在匯入當天被算成新客戶。"],
      ["你的 App 照常運作", "使用 Cloudflare 免費方案時，匯入會在達到每日上限的 90% 時停止，並在隔天繼續。"],
      ["可停止、可續傳", "進度會被保存。同一列匯入兩次不會有任何改變，因此可以用較新的匯出檔再執行一次。"],
      ["先試跑", "試跑（dry run）會查詢商店並回報將會發生的結果，但不寫入任何資料。"],
    ] as [string, string][],
  },
  steps: {
    eyebrow: "逐步操作",
    title: "從 RevenueCat 遷移的七個步驟",
    lede: "在你準備好切換之前，兩個後端都會持續執行，因此使用舊版 App 的客戶不會失去存取權。",
    items: [
      {
        title: "架設 openpurr",
        body: "把 openpurr Lite 部署到你的 Cloudflare 帳號，授予它 App Store 和 Google Play 的 API 存取權，並以相同的識別碼重新建立產品、權益和 Offering。你甚至可以繼續使用 RevenueCat 的公開 SDK 金鑰。",
      },
      {
        title: "讓兩個後端都收到通知",
        body: "把 openpurr 設為 RevenueCat 的 Apple Server Notification Forwarding URL，並在你的 Play 通知主題中加入 openpurr 的推送訂閱。",
      },
      {
        title: "取得匯出檔",
        body: "只有 App Store：RevenueCat 的 Scheduled Data Export 就有所需的資料。如果有 Google Play，請向 RevenueCat Support 申請遷移匯出檔，因為只有它包含購買權杖。指南中有一份可以直接複製的申請範本。",
      },
      { title: "匯入", body: "執行 <code>openpurr import</code>，先試跑一次。個別資料列的問題會寫入報告，不會中斷匯入。" },
      { title: "發布 App 更新", body: "加入 Proxy URL 和一次性的 <code>syncPurchases</code> 呼叫。等匯入完成後再發布。" },
      {
        title: "檢查",
        body: "<code>openpurr doctor</code> 會檢查設定。查詢幾位你認識的客戶，並把有效訂閱數和 RevenueCat 的圖表比對。",
      },
      {
        title: "完成切換",
        body: "等大多數客戶都更新之後，把 Apple 和 Google 直接指向 openpurr，啟用 openpurr 的 Webhook，並停用 RevenueCat 的 Webhook。",
      },
    ],
    source: "資料來源：",
    sourceNotifications: "RevenueCat：Apple 伺服器通知（英文）",
    sourceExports: "RevenueCat：匯出資料或遷移離開（英文）",
    more: "所有指令和設定都在完整指南中（英文）→",
  },
  moves: {
    eyebrow: "遷移內容",
    title: "哪些內容會從 RevenueCat 搬過來，哪些不會",
    rows: [
      ["訂閱和購買，包括續訂、退款、寬限期和到期", "會，向 Apple 和 Google 取得"],
      ["誰擁有哪一筆購買", "會，來自 RevenueCat 的匯出檔"],
      ["App User ID，包括匿名 ID", "會，維持不變"],
      ["客戶屬性（$email、$displayName 和你自訂的屬性）", "會，來自 Audience export"],
      ["產品、權益和 Offering", "需要你以相同的識別碼重新建立"],
      ["切換前的圖表歷史", "部分：請保留 RevenueCat 的圖表 CSV 作為紀錄"],
      ["實驗", "需要你重新建立：openpurr 可以針對你的 Offering 執行價格實驗"],
      ["付費牆、整合、Customer Center", "不會：openpurr 沒有這些功能"],
    ] as [string, string][],
  },
  faq: {
    eyebrow: "常見問題",
    title: "RevenueCat 遷移常見問題",
    items: [
      {
        q: "我需要修改購買程式碼嗎？",
        a: "不需要。openpurr 相容於官方、未經修改的 RevenueCat Purchases SDK。App 更新只要在 configure 之前加入 Proxy URL，並呼叫一次 syncPurchases。getOfferings、purchase、restorePurchases、logIn 等其餘程式碼都維持不變。",
      },
      {
        q: "遷移需要 RevenueCat 協助嗎？",
        a: "App Store 的 App 不需要：RevenueCat 的 Scheduled Data Export 就包含 openpurr 所需的交易 ID。Google Play 則需要：根據 RevenueCat 的文件，只有 RevenueCat Support 準備的遷移匯出檔才包含 Google 要求的購買權杖。",
      },
      {
        q: "從不更新 App 的客戶怎麼辦？",
        a: "匯入會涵蓋他們：他們的購買會向 Apple 和 Google 取得，並對應到相同的 App User ID。在他們仍使用舊版 App 期間，舊版會與 RevenueCat 溝通，所以在大多數使用者更新之前，兩個後端都會保持同步。",
      },
      {
        q: "匯入需要多久？",
        a: "每位客戶大約需要寫入 30 列資料庫資料。使用 Cloudflare 免費方案時，每天約可處理 2,500 位客戶，匯入會在達到每日上限時自動暫停，並在隔天繼續。使用 Workers Paid（每月 5 美元）時，大量匯入只要幾個小時。",
      },
      {
        q: "我的資料是從 RevenueCat 複製過來的嗎？",
        a: "只會複製 App 使用者和商店購買之間的對應關係，如果你選擇匯入，也包括客戶屬性。購買紀錄本身直接來自 Apple 和 Google，因此 openpurr 記錄的是商店目前的真實狀態，包括續訂和退款。",
      },
    ],
  },
  cta: {
    title: "準備好切換了嗎？",
    body: "指南會帶你完成每一個步驟。如果你的設定有不適用的地方，請提交 Issue：遷移時遇到的情況會決定我們接下來要做什麼。",
    guide: "閱讀指南（英文）",
    github: "GitHub 上的 openpurr",
    issue: "提交 Issue",
  },
};
