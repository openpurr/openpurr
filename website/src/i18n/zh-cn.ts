// Simplified Chinese copy. Follows en.ts; see the notes there. Uses 你, as is usual for developer tools; entitlement is 权益 throughout.
import type { Dict } from "./en";

export const zhCn: Dict = {
  meta: {
    title: "openpurr：自托管、开源的 RevenueCat 替代方案",
    description:
      "openpurr 是自托管、开源的 RevenueCat 替代方案，为 App Store 和 Google Play 的应用内购买与订阅提供后端。继续使用你现有的 Purchases SDK，把它指向你自己的服务器，无需支付收入分成。",
    ogImageAlt: "openpurr：自托管、开源的 RevenueCat 替代方案，旁边是它的订阅图表仪表盘",
  },
  header: {
    home: "openpurr 首页",
    nav: { features: "功能", editions: "版本", roadmap: "路线图", faq: "常见问题", migrate: "迁移" },
    language: "语言",
  },
  footer: {
    tagline: "由你自己运行的开源购买基础设施。",
    roadmap: "路线图",
    contributing: "参与贡献",
    sponsor: "赞助",
    contact: "联系我们",
    privacy: "隐私政策（英文）",
    disclaimer:
      "openpurr 是一个独立项目，与 RevenueCat, Inc. 没有任何关联，也未获得其认可。App Store 是 Apple Inc. 的商标。Google Play 是 Google LLC 的商标。",
    copyright: "版权所有 {year} openpurr 贡献者。",
    cookieSettings: "Cookie 设置",
  },
  consent: {
    label: "Cookie 同意",
    text: "我们希望使用 Google Analytics 的 Cookie 来统计访问量，并了解哪些页面有帮助。在你同意之前不会设置任何 Cookie，你也可以随时在「Cookie 设置」中更改决定。",
    privacy: "隐私政策（英文）",
    decline: "拒绝",
    accept: "接受",
  },
  snippet: {
    tabs: "SDK 平台",
    note: "只需一行。同样的 SDK，同样的购买代码。",
  },
  home: {
    hero: {
      title: '<span class="nowrap">自托管</span>、开源的 <span class="accent">RevenueCat <span class="nowrap">替代方案</span></span>',
      lede: "自己掌控购买基础设施，不分出任何收入，也不依赖任何商业服务。继续使用你现有的 Purchases SDK：只需改一个 URL，不用改购买代码。",
      star: "在 GitHub 上点 Star",
      how: "工作原理",
      shotAlt: "openpurr Lite 仪表盘，展示 12 个月的 MRR 变动、活跃订阅、流失、新客户、新增试用和活跃试用",
    },
    why: {
      eyebrow: "适合谁",
      title: "适合更愿意自己运行后端的 App 开发者",
      lede: "openpurr 兼容官方、未经修改的 SDK。切换只需从改一个 URL 开始，无需重写购买代码。",
      reasons: [
        {
          title: "你的数据，你的服务器",
          body: "购买记录、权益和商店凭据都存放在你自己运行的数据库中，你可以随时查询、备份和导出。你的 App 和客户之间没有任何外部服务。",
        },
        {
          title: "没有收入分成",
          body: "不抽取收入百分比，也没有按交易收取的费用。Lite 版专为 Cloudflare 免费套餐设计，小型 App 可以零成本运行。",
        },
        {
          title: "不依赖任何供应商",
          body: "代码基于 Apache 2.0 许可开源。你可以阅读、修改代码，并在 Cloudflare 和你自己的云之间迁移。",
        },
      ],
    },
    how: {
      eyebrow: "工作原理",
      title: "你的服务器取代了原来供应商的位置",
      lede: "你的 App 继续使用已集成的开源 Purchases SDK。SDK 与 openpurr 通信，openpurr 与各商店通信，维护订阅状态，并把变化通知你的后端。",
      flowLabel: "请求流程",
      app: "你的 App",
      sdkLicense: "官方、未经修改、MIT 许可",
      sdkPlatforms: "iOS、Android、Flutter 或 React Native",
      coreWhere: "运行在 Cloudflare Workers 或你自己的云上",
      appStoreApi: "Server API 和通知",
      playApi: "Developer API 和 RTDN",
      backend: "你的后端",
      backendHooks: "签名的 Webhook",
      steps: [
        {
          title: "部署",
          body: "在你自己的 Cloudflare 账号上运行 openpurr Lite。引导式安装命令 <code>pnpm run setup</code> 会创建数据库，部署两个 Worker，并创建你的所有者账号。",
        },
        {
          title: "配置 SDK",
          body: "在调用 <code>configure</code> 之前设置代理 URL。请使用你自己拥有的自定义域名，方便以后迁移。",
        },
        {
          title: "连接商店",
          body: "添加你的商店凭据和通知 URL。安装检查命令 <code>openpurr doctor</code> 会验证这些配置，并告诉你如何补全缺失的部分。",
        },
      ],
    },
    features: {
      eyebrow: "功能",
      title: "订阅后端，不带你用不上的附加功能",
      items: [
        {
          title: "购买与商店通知",
          body: "验证 StoreKit 2 交易和 Google Play 购买，返回 SDK 所需的 CustomerInfo 和权益，并根据 App Store 和 Google Play 的通知让续订、退款和宽限期状态保持最新。",
        },
        {
          title: "Webhook",
          body: "向你的后端发送与 RevenueCat 格式相同的事件，使用 HMAC-SHA256 签名，失败时会在约 72 小时内重试。",
        },
        {
          title: "图表",
          body: "16 张图表：收入、MRR 和 ARR、MRR 与订阅变动、活跃订阅和付费订阅、订阅状态、流失、试用与试用转化、新客户、退款与退款率，以及一次性购买。可按 App、商店、产品和环境筛选，收入统一换算为美元。",
        },
        {
          title: "价格实验",
          body: "向首次使用你 App 的客户展示不同的 Offering，再比较转化率和每位客户的收入，并给出每个变体优于对照组的概率。无需更新 App。",
        },
        {
          title: "认证与审计",
          body: "SDK 密钥和秘密密钥、支持可选验证器动态码的管理员登录、角色、访问令牌，以及审计日志。",
        },
        {
          title: "MCP 服务器和 Claude Skills",
          body: "让 AI 助手解释某个客户为什么拥有或没有某项权益，查询购买记录，或一步步引导你完成 App Store Connect 和 Play Console 的配置。",
        },
      ],
    },
    editions: {
      eyebrow: "两个版本",
      title: "从小规模起步，升级无需更新 App",
      lede: "两个版本通过同一套一致性测试。只要你的 App 指向你自己拥有的自定义域名，从 Lite 升级到 Standard 就不需要发布新版 App。",
      lite: {
        badge: "适合独立开发者",
        price: "$0",
        priceNote: "使用 Cloudflare 免费套餐",
        items: ["基于 Cloudflare Workers 和 D1 的 TypeScript 实现", "轻量，运行成本低", "在达到免费套餐限额前发出用量提醒"],
      },
      standard: {
        badge: "即将推出",
        price: "你的云账单",
        priceNote: "没有其他费用",
        items: ["容器中运行的 Go 和 Postgres", "GCP 或 AWS", "适合拥有更多 App 的团队"],
      },
    },
    savings: {
      eyebrow: "成本",
      title: "与 RevenueCat 相比，你能留下多少",
      lede: "RevenueCat 的 Pro 方案在每月跟踪收入低于 2,500 美元时免费，超过后按全部收入的 1% 收费。Lite 运行在 Cloudflare 免费套餐上；当应用超出免费额度后，可使用每月 5 美元起的 Workers Paid。",
      revenue: "月收入",
      rc: "RevenueCat",
      op: "openpurr Lite",
      saved: "每年节省",
      perMonth: "每月 {amount}",
      free: "Cloudflare 免费套餐",
      paid: "Cloudflare Workers Paid",
      chartLabel: "按月收入计算的每月费用：RevenueCat 的费用随收入上升，openpurr Lite 的费用接近于零",
      gapLegend: "你留下的部分",
      tableSummary: "在其他收入水平下比较",
      colRevenue: "月收入",
      colRc: "RevenueCat（每月）",
      colOp: "openpurr Lite（每月）",
      colSaved: "每年节省",
      methodSummary: "我们如何估算",
      pricingLink: "RevenueCat 的 1% 花在了哪里？→",
      method: [
        "RevenueCat：Pro 方案的标价，即从 2,500 美元起按每月跟踪收入的 1% 收费。跟踪收入会把年度订阅和一次性购买计入付款当月，因此可能高于 MRR。大客户可以协商 Enterprise 价格。",
        "openpurr Lite：Cloudflare 的 Workers 和 D1 价格。我们假设每位日活跃用户每月带来约 1.50 美元收入，每天发出约 10 个 SDK 请求。照此计算，免费套餐每天 100,000 个请求可覆盖约 {paidFrom} 的月收入，并留有余量。超过后按 Workers Paid 计算：每月 5 美元，超出 1,000 万个请求的部分每百万个请求 0.30 美元。",
        "未计入：你运维它所花的时间。两种方式的应用商店费用相同。",
        "价格核对于 {date}。openpurr 与 RevenueCat 没有关联。",
      ],
    },
    fit: {
      eyebrow: "坦白说",
      title: "它现在可能还不适合你",
      lede: "如果你需要付费墙构建器、第三方分析集成或支持合同，目前商业平台已经能提供这些。",
      outTitle: "暂不支持",
      tags: ["付费墙", "广告事件", "Customer Center", "虚拟货币", "Web 计费", "Amazon", "分析集成"],
    },
    roadmap: {
      eyebrow: "路线图",
      title: "未来方向",
      lede: "顺序已经确定，但没有时间表。如果某项功能对你很重要，请在 Issue 中告诉我们。",
      status: { done: "已完成", wip: "进行中", planned: "已计划", later: "由你决定" },
      phases: [
        {
          phase: "Lite",
          items: [
            "最新版本：{version}",
            "专为 Cloudflare 免费套餐设计",
            "App Store 和 Google Play",
            "Webhook、仪表盘和管理后台",
            "一次部署支持多个 App",
            "价格实验",
            "MCP 服务器、CLI 和 Claude Skills",
            "下一步：真机测试，然后发布 1.0",
          ],
        },
        {
          phase: "Standard",
          items: ["容器中运行的 Go 和 Postgres", "先支持 GCP，再支持 AWS", "与 Lite 使用同一套一致性测试", "从 Lite 迁移无需更新 App"],
        },
        {
          phase: "由社区塑造",
          items: ["经过验证的终端用户身份", "面向大型团队的 Standard 扩展功能", "查看图表的移动 App，购买停止时推送提醒", "同样的提醒发到 Slack、Discord 和 Telegram", "你在 Issue 中提出的任何需求"],
        },
      ],
      more: "查看完整路线图（英文）→",
    },
    cta: {
      title: "一起完善它",
      body: "目前最有用的帮助是反馈：指出我们对 SDK 或商店的错误理解，以及续订、退款和宽限期中真实遇到的边界情况。",
      star: "在 GitHub 上点 Star",
      issue: "提交 Issue",
      coffee: "请我们喝杯咖啡",
    },
  },
  faq: {
    eyebrow: "常见问题",
    title: "openpurr：RevenueCat 替代方案",
    lede: "自己运行订阅后端后，哪些会改变，哪些不会。",
    items: [
      {
        q: "openpurr 是什么？",
        a: "openpurr 是一个开源、自托管的 RevenueCat 替代方案。它是一个应用内购买和订阅后端，兼容官方的 RevenueCat Purchases SDK。它验证 App Store 和 Google Play 的购买，跟踪权益，接收商店通知，向你的后端发送 Webhook，并以图表展示核心订阅指标，所有这些都运行在你掌控的基础设施上。",
      },
      {
        q: "openpurr 和 RevenueCat 有什么不同？",
        a: "RevenueCat 是一项托管的商业服务，超出免费额度后按收入比例收费。openpurr 是你自己运行的软件：你的购买记录、权益和商店凭据都存放在你自己的数据库中，没有收入分成，也没有按交易收取的费用。RevenueCat 目前提供更多功能，例如付费墙和分析集成。openpurr 专注于核心的订阅后端。",
      },
      {
        q: "从 RevenueCat 切换过来，需要重写购买代码吗？",
        a: "不需要。openpurr 兼容官方、未经修改的 Purchases SDK。你只需在调用 configure 之前，把 SDK 的代理 URL 设置为你的 openpurr 服务器，其余购买代码保持不变。请指向你自己拥有的自定义域名，这样以后更换服务器时无需更新 App。",
      },
      {
        q: "如何把现有客户从 RevenueCat 迁移过来？",
        a: "通过导入完成。向 RevenueCat 申请迁移导出文件，然后 openpurr import 命令会从 Apple 和 Google 获取每位客户的购买记录，并关联到相同的 App User ID。新版 App 也会把每位客户的购买记录发送一次，在用户陆续更新期间，两个后端都会保持同步，因此不会有人失去访问权限。",
        link: "迁移指南",
      },
      {
        q: "可以从 Adapty 迁移过来吗？",
        a: "可以，但需要更新 App。Adapty 的 SDK 无法指向其他服务器，因此需要通过更新把它替换为 openpurr 兼容的 Purchases SDK。你在商店中的产品保持不变。openpurr 会从 Adapty 的事件导出文件中导入你的 App Store 客户，其他客户会在新版 App 首次运行时迁移过来，在用户陆续更新期间，两个后端都会保持同步。",
        link: "阅读 Adapty 指南",
        linkTo: "adapty",
      },
      {
        q: "openpurr 支持哪些平台和商店？",
        a: "openpurr 支持 iOS、Android、Flutter 和 React Native 的 Purchases SDK，以及来自 App Store 和 Google Play 的购买。Amazon 和 Web 计费目前暂不支持。",
      },
      {
        q: "openpurr 需要多少钱？",
        a: "openpurr 免费且开源，采用 Apache 2.0 许可。你只需为它运行所在的基础设施付费。Lite 版专为 Cloudflare 免费套餐设计，小型 App 可以零成本运行。Standard 版在你自己的云上以容器方式运行，成本就是你的云账单。",
      },
      {
        q: "我的数据存储在哪里？",
        a: "存储在你自己的数据库中。Lite 版使用你 Cloudflare 账号中的 Cloudflare D1，Standard 版使用 GCP 或 AWS 上的 Postgres。你可以查询、备份和导出数据，你的 App 和客户之间没有任何外部服务。",
      },
      {
        q: "openpurr 会像 RevenueCat 一样发送 Webhook 吗？",
        a: "会。openpurr 向你的后端发送与 RevenueCat 格式相同的事件，使用 HMAC-SHA256 签名，失败时会在约 72 小时内重试，因此现有的 Webhook 处理程序几乎不需要修改。",
      },
      {
        q: "RevenueCat 有哪些功能是 openpurr 没有的？",
        a: "付费墙、第三方分析集成、Customer Center、虚拟货币、Web 计费、Amazon、广告事件和商业支持合同目前暂不支持。价格实验已内置。如果你现在就需要其他功能，商业平台会更适合你。",
      },
      {
        q: "openpurr 可以用于生产环境了吗？",
        a: "还不行。openpurr 尚处于早期阶段：Lite 版正在开发中，Standard 版稍后推出。你可以在 GitHub 上关注路线图，如果某项功能对你很重要，欢迎提交 Issue。",
      },
      {
        q: "openpurr 和 RevenueCat 有关联吗？",
        a: "没有。openpurr 是一个独立的开源项目，与 RevenueCat, Inc. 没有任何关联，也未获得其认可。它兼容 RevenueCat 官方的 Purchases SDK，该 SDK 采用 MIT 许可。",
      },
    ],
  },
  structured: {
    description:
      "自托管、开源的 RevenueCat 替代方案：一个面向 App Store 和 Google Play 应用内购买与订阅的后端，兼容官方、未经修改的 Purchases SDK。它验证购买，跟踪权益，接收商店通知，发送 Webhook，并以图表展示订阅指标。",
    subCategory: "应用内购买与订阅后端",
    features: [
      "兼容官方 RevenueCat Purchases SDK，支持 iOS、Android、Flutter 和 React Native",
      "StoreKit 2 和 Google Play 购买验证",
      "App Store Server Notifications V2 和 Google Play Real-time Developer Notifications",
      "与 RevenueCat 格式相同的 Webhook，使用 HMAC-SHA256 签名",
      "16 张订阅图表，包括 MRR、流失和试用转化",
      "基于 Offering 的价格实验，按变体查看结果",
      "MCP 服务器、CLI 和 Claude Skills",
    ],
  },
};
