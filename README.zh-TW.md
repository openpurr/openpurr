<!-- translated-from: README.md sha256:2f5fb4fb0a81c338 -->
<h1 align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset=".github/assets/openpurr-logo-dark.png">
    <img src=".github/assets/openpurr-logo.png" alt="openpurr" width="400">
  </picture>
</h1>

<!-- languages -->
<p align="center"><a href="README.md">English</a> · <a href="README.de.md">Deutsch</a> · <a href="README.es.md">Español</a> · <a href="README.fr.md">Français</a> · <a href="README.it.md">Italiano</a> · <a href="README.nl.md">Nederlands</a> · <a href="README.pl.md">Polski</a> · <a href="README.pt-BR.md">Português (Brasil)</a> · <a href="README.tr.md">Türkçe</a> · <a href="README.id.md">Bahasa Indonesia</a> · <a href="README.vi.md">Tiếng Việt</a> · <a href="README.ar.md">العربية</a> · <a href="README.hi.md">हिन्दी</a> · <a href="README.ja.md">日本語</a> · <a href="README.ko.md">한국어</a> · <a href="README.zh-CN.md">简体中文</a> · <b>繁體中文</b></p>
<!-- /languages -->

自架、開源的 RevenueCat 替代方案後端。

繼續使用 RevenueCat 開源的 Purchases SDK，把 App 的 `Purchases.proxyURL` 指向你自己的伺服器。openpurr 會驗證 App Store 和 Google Play 的購買、追蹤權益、接收商店通知、向你的後端傳送 Webhook，並以圖表呈現核心訂閱指標。它在你掌控的基礎架構上執行。

openpurr 是獨立專案，與 RevenueCat, Inc. 沒有任何關聯，也未獲得其認可。

<picture>
  <source media="(prefers-color-scheme: dark)" srcset=".github/assets/openpurr-dashboard-dark.png">
  <img src=".github/assets/openpurr-dashboard.png" alt="openpurr Lite 儀表板，顯示 12 個月的 MRR 變動、有效訂閱、流失、新客戶、新增試用和進行中的試用">
</picture>

## 適合誰

適合這樣的 App 開發者：

- **想自己掌控購買基礎架構。** 你的購買紀錄、權益和商店憑證都存放在你自己執行的伺服器上，存放在你可以查詢、備份和匯出的資料庫中。你的 App 和客戶之間沒有任何外部服務。
- **不想分出一部分營收。** openpurr 沒有營收分潤，也沒有按交易計算的費用。Lite 版專為 Cloudflare 免費方案設計，小型 App 可以零成本執行。
- **不想依賴商業服務。** 它是開源的：你可以閱讀程式碼、修改程式碼，並在 Cloudflare 和你自己的雲端之間搬移。

如果你已經在使用 RevenueCat SDK，而且想繼續使用，它也很適合。openpurr 相容於官方、未經修改的 SDK，因此切換只要從改一個 URL 開始，不必重寫購買程式碼。要把現有客戶搬過來，請參閱[從 RevenueCat 遷移](https://openpurr.org/zh-tw/migrate-from-revenuecat/)。

如果你需要付費牆建構工具、A/B 實驗、第三方分析整合或支援合約，**它（目前）可能還不適合你**。目前商業平台已經能提供這些。即將推出的功能請參閱[路線圖](ROADMAP.md)（英文）。

## 功能

- **購買：** 驗證 StoreKit 2 交易和 Google Play 購買，並回傳 SDK 所需的 `CustomerInfo` 和權益。
- **商店通知：** 接收 App Store Server Notifications V2 和 Google Play Real-time Developer Notifications。
- **Webhook：** 向你的後端傳送與 RevenueCat 格式相同的事件，以 HMAC-SHA256 簽章，失敗時會在約 72 小時內重試。
- **圖表：** 儀表板提供 16 張圖表，可依專案、應用程式、商店、商品和環境篩選，並可匯出為 CSV：
  - **營收：** 營收、退款、退款率和非訂閱購買。
  - **經常性營收：** MRR、ARR 和 MRR 變動。
  - **訂閱：** 有效訂閱、付費訂閱、訂閱變動、訂閱狀態和流失。
  - **試用：** 進行中的試用、新增試用和試用變動。
  - **客戶：** 新客戶。
- **驗證：** SDK 金鑰和私密金鑰、管理員登入（密碼，可選用驗證器 App 動態密碼；Cloudflare Access 已在規劃中）、角色，以及稽核記錄。
- **MCP 伺服器和 Claude Skills：** AI 助理可以查詢客戶、說明某人為什麼有或沒有某項權益，並帶你完成 App Store 和 Play Console 的設定。

**目前暫不支援：** 付費牆、廣告事件、Customer Center、虛擬貨幣、Web 計費、Amazon 和第三方分析整合。價格實驗已列入[路線圖](ROADMAP.md#later-)（英文）。

## 兩個版本

| | Lite | Standard |
|---|---|---|
| 語言 | TypeScript | Go |
| 執行環境 | Cloudflare Workers + D1 | GCP 或 AWS 上的容器 + Postgres |
| 成本 | 專為 Cloudflare 免費方案設計 | 你的雲端帳單 |
| 適用於 | 獨立開發的 App：輕量，執行成本低 | 擁有較多 App 的團隊（即將推出） |

兩個版本都通過 `spec/` 中的同一套一致性測試。只要你的 App 指向你自己擁有的自訂網域，從 Lite 搬移到 Standard 就不必發布 App 更新。

## SDK 相容性

從第一天起就使用官方、未經修改的 SDK（全部採用 MIT 授權）：

| SDK | 如何指向 openpurr |
|---|---|
| iOS | `Purchases.proxyURL = URL(string: "https://openpurr.your-server.dev")` |
| Android | `Purchases.proxyURL = URL("https://openpurr.your-server.dev")` |
| Flutter、React Native | `Purchases.setProxyURL("https://openpurr.your-server.dev")` |

在呼叫 `configure` 之前設定 Proxy URL。權益驗證請維持預設值（停用），因為經過簽章的回應仰賴 RevenueCat 自己的金鑰。

**Android 上的已知限制：** 即使設定了 Proxy URL，SDK 仍會把診斷、付費牆和廣告流量直接傳送到三個 RevenueCat 主機。openpurr 會透過遠端設定關閉診斷。在 Android 上搭配 openpurr 時，請不要使用 RevenueCatUI 付費牆或廣告。

## 規劃中的儲存庫結構

```
spec/       language-neutral contract: OpenAPI, JSON schemas, fixtures, conformance suite
lite/       Lite edition: lightweight, for indie apps on Cloudflare Workers (TypeScript)
standard/   Standard edition: for larger app portfolios on AWS or GCP (Go, coming soon)
cli/        `npx @openpurr/cli` (works with either edition)
skills/     Claude Code plugin
examples/   sample apps
infra/      Terraform/OpenTofu modules for GCP, AWS and DigitalOcean
```

## 開始使用

Lite 目前是 0.1.0，也就是第一個版本，因此在 1.0 之前可能還會有變動。要在你自己的 Cloudflare 帳號上試用（免費方案就夠了），需要 Node 22.12 或更新版本：

```sh
git clone https://github.com/openpurr/openpurr && cd openpurr
npx pnpm install
cd lite && npx wrangler login
npx pnpm run setup      # database, both Workers, operator secret and your owner account
```

如果安裝中途停止，可以放心再執行一次。安裝結束時會提供儀表板的連結，開啟後第一步是新增你的第一個 App：填入它的 Bundle ID 和套件名稱，接著是產品、權益和 Offering。一次部署可以把多個 App 當作獨立專案執行，每個專案都有自己的客戶。之後：

- **檢查設定：** 執行 `npx @openpurr/cli login`，再執行 `npx @openpurr/cli doctor`。它會回報缺少哪些項目，以及每一項的修正方式。
- **接收用量提醒：** 新增一個具有 Account Analytics: Read 權限的 Cloudflare API 權杖，設為 `CLOUDFLARE_ANALYTICS_TOKEN` 密鑰，儀表板就會在免費方案的每日上限擋下請求之前提醒你。
- **備份資料：** `npx pnpm db:backup` 會把資料庫匯出成檔案。D1 在免費方案中也會保留 7 天的歷史紀錄（Workers Paid 為 30 天）。
- **每次推送時自動部署：** Fork 這個儲存庫，並把你的 Cloudflare 資訊加入為儲存庫 Secret。[`lite-deploy.yml`](.github/workflows/lite-deploy.yml) 列出了需要的項目。

正在使用 Claude Code？[openpurr 外掛程式](plugin/)（英文）會帶你完成同樣的步驟，還包括 App Store Connect 和 Play Console 的設定。

## 參與貢獻

請參閱 [CONTRIBUTING.md](CONTRIBUTING.md)（英文）。目前最有幫助的是在 Issue 中提供意見回饋：指出我們對 SDK 或商店的錯誤假設，以及實際遇到的邊界情況。

其他事項請寄信至 [hello@openpurr.org](mailto:hello@openpurr.org)。

## Star 歷史

<a href="https://www.star-history.com/?repos=openpurr%2Fopenpurr&type=timeline&legend=bottom-right">
 <picture>
   <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/chart?repos=openpurr/openpurr&type=date&theme=dark&legend=bottom-right" />
   <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/chart?repos=openpurr/openpurr&type=date&legend=bottom-right" />
   <img alt="Star 歷史圖表" src="https://api.star-history.com/chart?repos=openpurr/openpurr&type=date&legend=bottom-right" />
 </picture>
</a>

## 授權

[Apache License 2.0](LICENSE)。版權所有 2026 openpurr 貢獻者。
