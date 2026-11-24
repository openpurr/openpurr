// The "RevenueCat's CEO on X" page in this language (see en.ts for the notes).
import type { CeoDict } from "./en";

export const ceoZhTw: CeoDict = {
  meta: {
    title: "RevenueCat CEO 每天在 X 上發文 {perDay} 次 - openpurr",
    description:
      "90 天內，RevenueCat 的 CEO 在 X 上發文 {posts} 次，每天分散在 {hours} 個小時，約 {pct} 提到 RevenueCat。你的 1% 正在為他的公司買單。",
    ogImageAlt: "RevenueCat 的 CEO 每天在 X 上發文約 10 次，天天如此。你的 1% 正在為他掌管的公司買單。",
  },
  hero: {
    crumb: "CEO 的 X",
    eyebrow: "你的 1% 去了哪裡",
    headline: "RevenueCat 的 CEO 每天在 X 上發文 {perDay} 次。",
    headlineAccent: "你的 1% 正在為他掌管的公司買單。",
    lede: "過去 {days} 天，RevenueCat 的 CEO Jacob Eiting（{handle}）在 X 上發文 {posts} 次。平均每天約 {perDay} 則，每天分散在 {hours} 個不同的小時，{days} 天中有 {active} 天發了文。",
    updated: "更新於 {date} - 根據公開貼文統計",
  },
  stats: {
    posts: "{days} 天內的貼文",
    perDay: "每天貼文數",
    hours: "每天活躍小時數",
    active: "有發文的天數（共 {days} 天）",
  },
  calendar: {
    title: "{days} 天發文紀錄",
    note: "每個方格代表一天。顏色越深，當天有貼文的小時越多。",
    less: "沒有發文",
    more: "小時更多",
    cell: "{date}：{hours} 個小時內發文 {posts} 則",
  },
  topic: {
    title: "其中有多少跟 RevenueCat 有關？",
    text: "依照下方規則，他的貼文中有 <b>{pct}</b> 提到 RevenueCat 或其業務：{posts} 則中的 {onTopic} 則。同樣的規則在 {base} 自己的貼文裡也只找到 {basePct}，所以會漏掉一些。即便如此，他發的大部分內容都與此無關。",
    ceo: "他的貼文",
    base: "{base} 的貼文",
    about: "與 RevenueCat 有關",
  },
  pays: {
    title: "你的 1% 在為什麼買單",
    text: "月營收超過 {threshold} 後，RevenueCat 就抽走你全部營收的 1%。公司靠這筆錢運轉，從伺服器到經營團隊。",
    link: "看看你 1% 的其餘部分去了哪裡 →",
    ctaKeep: "留住你的 1% →",
    ctaGithub: "GitHub 上的 openpurr",
  },
  method: {
    title: "我們如何統計",
    posts: "<b>貼文：</b>{handle} 從 {start} 到 {end} 的所有公開貼文和回覆，於 {checked} 透過 X 的 API 讀取。轉貼不計入，已刪除的貼文無法計入。",
    hours: "<b>活躍小時：</b>至少有一則貼文的整點小時（例如 9 點到 10 點）。9:05、9:40 和 14:10 發的貼文算 2 個活躍小時。統計的是有貼文的小時數，而不是花費的時間。每天依 UTC 從午夜到午夜計算。",
    rules: "<b>與 RevenueCat 有關：</b>提到 {accounts}、連結到 {sites}，或使用以下任一詞語的貼文：{terms}。",
    limits: "<b>這些數字說明不了什麼：</b>發文可能是 CEO 工作的一部分，這些數字也不顯示他何時工作。它們顯示的是他發文有多頻繁，以及發的是什麼。",
    data: "<b>資料：</b>我們只保存計數，不保存貼文內容。統計所用的腳本放在{script}。",
    scriptLink: "我們的程式碼儲存庫",
    affiliation: "<b>無關聯：</b>openpurr 與 RevenueCat 沒有任何關聯。",
  },
};
