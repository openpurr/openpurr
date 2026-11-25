// The "Add in-app purchases" page in this language (see en.ts for the notes).
import type { StartDict } from "./en";

export const startZhCn: StartDict = {
  meta: {
    title: "免费为你的 App 添加应用内购买和订阅 - openpurr",
    description:
      "要做新 App？用官方 Purchases SDK 和你自己运行的开源后端添加应用内购买与订阅，永远没有收入分成。",
    ogImageAlt: "要做新 App？从一开始就不交收入分成。留住你的 1%，投入你的业务。",
  },
  hero: {
    crumb: "添加应用内购买",
    eyebrow: "为新 App 准备",
    headline: "要做新 App？",
    headlineAccent: "从一开始就不交收入分成。",
    /** {threshold} is "$2,500". */
    lede: "大多数购买后端在你的月收入超过 {threshold} 后抽走 1%，而且你每增长一次，账单就跟着涨一次。在第一笔销售之前避开它最容易。openpurr 是一个免费、开源、由你自己运行的应用内购买与订阅后端，使用的是大平台同款的官方 SDK。",
    ctaStart: "在 GitHub 上开始",
    ctaHow: "工作原理",
    ctaAi: "复制给 AI 助手的提示词",
  },
  growth: {
    title: "你的 1%，从第一天算起",
    text: "选一个你预计 App 三年后能达到的水平。假设从零开始稳步增长，看看这一路上 1% 的收入分成会累计多少。",
    target: "三年后的月收入",
    /** Labels for the totals. */
    fee: "1% 收入分成，三年合计",
    servers: "自己运行，三年合计",
    after: "此后每年",
    /** The chart's accessible description. */
    chartLabel: "三年内逐月累计的收入分成",
    /** HTML. {fee} and {servers} are amounts that move with the slider. */
    summary: "到第四年之前，你要交出 <b>{fee}</b>，而自己的服务器只要 <b>{servers}</b>。把钱留下，投入你的业务。",
  },
  invest: {
    title: "投资你的业务，也投资你自己",
    text: "留住一年的 1%，能买些什么：",
  },
  how: {
    title: "工作原理",
    lede: "四个步骤，你写的代码和任何 RevenueCat 教程里的一样。",
    steps: [
      {
        title: "部署 openpurr",
        /** HTML. */
        text: "在你的 Cloudflare 账号上运行安装程序。小型 App 用 Lite 就能放进<b>免费套餐</b>，安装中途停了也可以放心重新运行。",
      },
      {
        title: "添加 App 和产品",
        text: "仪表盘一打开就引导你添加第一个 App：先填 Bundle ID 和包名，再设置产品、权益和 Offering。",
      },
      {
        title: "添加 Purchases SDK",
        /** HTML. */
        text: "安装官方的 RevenueCat Purchases SDK（MIT 许可开源），在 configure 之前设置<b>一个代理 URL</b>。",
      },
      {
        title: "发布",
        text: "购买通过 Apple 和 Google 验证，续订和退款通过商店通知送达，你的后端会收到 Webhook。在用 Claude Code？openpurr 插件会一步步带你完成 App Store Connect 和 Play Console 的设置。",
      },
    ],
    /** Above the setup commands. */
    setupLabel: "在你的电脑上安装",
  },
  ai: {
    title: "用 AI 编程助手完成设置",
    text: "在 Claude Code、Codex、Cursor、Grok 或任何编程智能体中打开你的应用项目，粘贴这段提示词。它会部署 openpurr、连接应用商店并添加 SDK，遇到需要你登录的步骤会先问你。",
    copy: "复制提示词",
    copied: "已复制",
    claudeTip: "用 Claude Code？先添加 openpurr 插件，它会一步步带你完成：",
  },
  includes: {
    title: "你能得到什么",
    yes: [
      "App Store 和 Google Play 上的购买与订阅",
      "权益和 Offering",
      "发往你后端的 Webhook，带签名并自动重试",
      "16 种图表：收入、MRR、流失、试用等",
      "价格实验",
      "数据存放在你自己的数据库中",
    ],
    notYetTitle: "暂不支持",
    notYet: "付费墙构建器、第三方分析集成、广告事件、网页支付和 Amazon。如果你一开始就需要这些，商业平台现在就能提供。",
  },
  lockin: {
    title: "无论怎么选，都不被锁定",
    text: "openpurr 使用标准的 Purchases SDK，所以你的购买代码在两种后端上都能运行。如果 openpurr 不够用了，或者你想要商业平台的额外功能，切换只需改一下配置、导入客户，不用重写代码。",
  },
  pricingLink: {
    text: "好奇真交了 1%，钱都去了哪里？",
    link: "查看 RevenueCat 定价拆解 →",
  },
  faq: {
    title: "常见问题",
    /** Each answer is also the page's FAQ structured data. */
    items: {
      backend: {
        q: "应用内购买需要后端吗？",
        a: "严格来说不需要：StoreKit 和 Google Play Billing 运行在设备上。但有了后端，订阅状态才可靠。它通过 Apple 和 Google 验证购买，借助商店通知跟踪续订、取消和退款，并告诉你的 App 和服务器谁有访问权限。openpurr 就是这样的后端，由你自己运行。",
      },
      cheapest: {
        q: "给 iOS 或 Android App 添加订阅，最便宜的方式是什么？",
        /** {servers} a yearly amount, {m25k} "$25,000". */
        a: "自己运行后端。小型 App 用 openpurr Lite 就能放进 Cloudflare 免费套餐，并配合免费开源的 Purchases SDK 使用，所以你只需支付服务器费用：按我们的模型，月收入 {m25k} 的 App 每年约 {servers}，没有收入分成。",
      },
      free: {
        q: "openpurr 真的免费吗？",
        a: "是的。它以 Apache 2.0 许可开源，没有收入分成，也没有按交易收取的费用。你只需支付自己的服务器费用，小型 App 用 Cloudflare 免费套餐就够了。",
      },
      switch: {
        q: "以后可以换成 RevenueCat 吗？",
        a: "可以。openpurr 使用官方的 RevenueCat Purchases SDK，所以 App 的购买代码在两种后端上都能运行，你在商店中的产品也保持不变。切换只需改一下配置，再迁移客户记录。",
      },
      missing: {
        q: "openpurr 目前还不支持什么？",
        a: "付费墙构建器、第三方分析集成、广告事件、网页支付和 Amazon。价格实验已内置。如果你一开始就需要其余功能，商业平台现在就能提供。",
      },
    },
  },
};
