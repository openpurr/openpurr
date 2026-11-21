// Simplified Chinese copy of the migration page. Follows en.ts; see the notes there.
import type { MigrateDict } from "./en";

export const migrateZhCn: MigrateDict = {
  meta: {
    title: "从 RevenueCat 迁移到 openpurr：分步指南",
    description:
      "把你的 App 从 RevenueCat 迁移到开源的 RevenueCat 替代方案 openpurr：继续使用 Purchases SDK，导入每一位订阅用户，并保留他们的访问权限。",
    ogImageAlt:
      "从 RevenueCat 迁移到 openpurr，不流失任何订阅用户：继续使用 Purchases SDK，导入每一位客户，旧版 App 也能继续正常使用。",
  },
  hero: {
    crumb: "从 RevenueCat 迁移",
    eyebrow: "迁移指南",
    headline: "从 RevenueCat 迁移到 openpurr，不流失任何订阅用户",
    lede: "继续使用你的 App 已集成的 Purchases SDK。从 RevenueCat 的导出文件导入现有客户：openpurr 会自己从 Apple 和 Google 获取每一笔购买。在用户陆续更新期间，旧版 App 也能继续正常使用。",
    guide: "阅读分步指南（英文）",
    steps: "查看步骤",
    updated: "更新于 {date}",
  },
  summary: {
    title: "简而言之",
    items: [
      "openpurr 是自托管、开源的 RevenueCat 替代方案，兼容官方、未经修改的 RevenueCat Purchases SDK。",
      "你的 App 只需添加一行代码（SDK 的代理 URL）和一次性的 <code>syncPurchases</code> 调用，其余购买代码保持不变。",
      "<code>openpurr import</code> 从 RevenueCat 的导出文件导入现有客户。购买记录本身从 Apple 和 Google 获取，而不是复制过来。",
      "App Store 的 App 可以使用 RevenueCat 的 Scheduled Data Export。Google Play 需要向 RevenueCat Support 申请迁移导出文件，只有它包含购买令牌（purchase token）。",
      "在大多数用户更新 App 之前，两个后端都会保持同步，因此不会有人失去访问权限。",
      "使用 Cloudflare 免费套餐时，导入每天可处理约 2,500 位客户。使用 Workers Paid 时，大规模导入只需几个小时。",
    ],
  },
  how: {
    eyebrow: "工作原理",
    title: "RevenueCat 迁移是如何进行的",
    lede: "openpurr 不会从 RevenueCat 复制购买记录。它只需要知道谁拥有哪一笔购买，然后向商店查询，和你的 App 上报购买时的做法完全一样。",
    ways: [
      {
        title: "导入",
        body: "RevenueCat 的导出文件记录了哪位 App 用户拥有哪一笔商店购买。<code>openpurr import</code> 会向 Apple 和 Google 查询每一笔购买，并把商店返回的结果记录到该用户名下。它一次性迁移所有人，包括再也不会打开 App 的用户。",
      },
      {
        title: "App 更新",
        body: "新版 App 把 Purchases SDK 指向 openpurr，并通过 <code>syncPurchases</code> 把每位客户的购买记录发送一次。这样可以覆盖导出文件遗漏的用户，以及在导出之后才购买的用户。",
      },
      {
        title: "两个后端并行一段时间",
        body: "在用户更新之前，旧版 App 会继续与 RevenueCat 通信。RevenueCat 会把 Apple 的通知转发给 openpurr，再加一个 Pub/Sub 订阅为 Google 做同样的事，两个后端因此都保持最新。",
      },
    ],
  },
  app: {
    eyebrow: "在你的 App 中",
    title: "你的 App 需要改什么",
    lede: "在 configure 之前设置代理 URL，并把每位客户的购买记录发送一次。同样的两处改动也适用于 Android、Flutter 和 React Native，指南中有各平台的代码。",
    codeLabel: "Swift 示例：代理 URL 和一次性同步",
    proxyComment: "在 configure() 之前：大多数 App 只需加这一行",
    syncComment: "每次安装执行一次：把该客户的购买记录发送到 openpurr",
  },
  import: {
    eyebrow: "导入",
    title: "从 RevenueCat 导入客户",
    lede: "openpurr CLI 直接读取 RevenueCat 导出的各列：App User ID、App Store 交易 ID、Google Play 购买令牌，以及 <code>$email</code> 等属性。",
    codeLabel: "终端：导入 RevenueCat 的导出文件",
    dryRunComment: "先检查前几行：会查询 Apple 和 Google，但不写入任何数据",
    importComment: "导入所有人。可随时停止，再次运行即可继续。",
    safeguards: [
      ["不会有人失去访问权限", "App 已经为某位客户发送过的购买仍归该客户所有，导入永远不会移动它。"],
      ["不会重复发送 Webhook", "导入的购买不是新购买，因此 openpurr 不会为它们发送事件。"],
      ["图表数据真实", "导入的客户按首次购买日期计算，不会在导入当天被算作新客户。"],
      ["你的 App 照常运行", "使用 Cloudflare 免费套餐时，导入会在达到每日限额的 90% 时停止，并在第二天继续。"],
      ["可停止、可恢复", "进度会被保存。同一行导入两次不会产生任何变化，因此可以用更新的导出文件再运行一次。"],
      ["先试运行", "试运行（dry run）会查询商店并报告将会发生什么，但不写入任何数据。"],
    ] as [string, string][],
  },
  steps: {
    eyebrow: "分步操作",
    title: "从 RevenueCat 迁移的七个步骤",
    lede: "在你准备好切换之前，两个后端都会持续运行，因此使用旧版 App 的客户不会失去访问权限。",
    items: [
      {
        title: "部署 openpurr",
        body: "把 openpurr Lite 部署到你的 Cloudflare 账号，为它开通 App Store 和 Google Play 的 API 访问权限，并用相同的标识符重新创建产品、权益和 Offering。你甚至可以继续使用 RevenueCat 的公开 SDK 密钥。",
      },
      {
        title: "让两个后端都收到通知",
        body: "把 openpurr 设为 RevenueCat 的 Apple Server Notification Forwarding URL，并在你的 Play 通知主题中添加 openpurr 的推送订阅。",
      },
      {
        title: "获取导出文件",
        body: "只有 App Store：RevenueCat 的 Scheduled Data Export 就包含所需数据。如果有 Google Play，请向 RevenueCat Support 申请迁移导出文件，因为只有它包含购买令牌。指南中有一份可以直接复制的申请模板。",
      },
      { title: "导入", body: "运行 <code>openpurr import</code>，先进行一次试运行。单行出现的问题会写入报告，不会中断导入。" },
      { title: "发布 App 更新", body: "添加代理 URL 和一次性的 <code>syncPurchases</code> 调用。等导入完成后再发布。" },
      {
        title: "检查",
        body: "<code>openpurr doctor</code> 会检查配置。查一查你认识的客户，并把活跃订阅数与 RevenueCat 的图表进行对比。",
      },
      {
        title: "完成切换",
        body: "等大多数客户更新之后，把 Apple 和 Google 直接指向 openpurr，开启 openpurr 的 Webhook，并关闭 RevenueCat 的 Webhook。",
      },
    ],
    source: "来源：",
    sourceNotifications: "RevenueCat：Apple 服务器通知（英文）",
    sourceExports: "RevenueCat：导出数据或迁移离开（英文）",
    more: "所有命令和设置都在完整指南中（英文）→",
  },
  moves: {
    eyebrow: "迁移内容",
    title: "哪些内容会从 RevenueCat 迁移过来，哪些不会",
    rows: [
      ["订阅和购买，包括续订、退款、宽限期和到期", "会，从 Apple 和 Google 获取"],
      ["谁拥有哪一笔购买", "会，来自 RevenueCat 的导出文件"],
      ["App User ID，包括匿名 ID", "会，保持不变"],
      ["客户属性（$email、$displayName 和你自定义的属性）", "会，来自 Audience export"],
      ["产品、权益和 Offering", "需要你用相同的标识符重新创建"],
      ["切换前的图表历史", "部分迁移：请保留 RevenueCat 的图表 CSV 作为存档"],
      ["付费墙、实验、集成、Customer Center", "不会：openpurr 没有这些功能"],
    ] as [string, string][],
  },
  faq: {
    eyebrow: "常见问题",
    title: "RevenueCat 迁移常见问题",
    items: [
      {
        q: "我需要修改购买代码吗？",
        a: "不需要。openpurr 兼容官方、未经修改的 RevenueCat Purchases SDK。App 更新只需在 configure 之前添加代理 URL，并调用一次 syncPurchases。getOfferings、purchase、restorePurchases、logIn 等其余代码都保持不变。",
      },
      {
        q: "迁移需要 RevenueCat 的协助吗？",
        a: "App Store 的 App 不需要：RevenueCat 的 Scheduled Data Export 包含 openpurr 所需的交易 ID。Google Play 则需要：根据 RevenueCat 的文档，只有 RevenueCat Support 准备的迁移导出文件才包含 Google 要求的购买令牌。",
      },
      {
        q: "从不更新 App 的客户怎么办？",
        a: "导入会覆盖他们：他们的购买会从 Apple 和 Google 获取，并关联到相同的 App User ID。在他们仍使用旧版 App 期间，旧版会与 RevenueCat 通信，所以在大多数用户更新之前，两个后端都会保持同步。",
      },
      {
        q: "导入需要多长时间？",
        a: "每位客户大约需要写入 30 行数据库记录。使用 Cloudflare 免费套餐时，每天约可处理 2,500 位客户，导入会在达到每日限额时自动暂停，并在第二天继续。使用 Workers Paid（每月 5 美元）时，大规模导入只需几个小时。",
      },
      {
        q: "我的数据是从 RevenueCat 复制过来的吗？",
        a: "只复制 App 用户与商店购买之间的对应关系，如果你选择导入，还包括客户属性。购买记录本身直接来自 Apple 和 Google，因此 openpurr 记录的是商店当前的真实状态，包括续订和退款。",
      },
    ],
  },
  cta: {
    title: "准备好切换了吗？",
    body: "指南会带你走完每一步。如果你的配置有不适用的地方，请提交 Issue：迁移中遇到的情况会决定我们接下来做什么。",
    guide: "阅读指南（英文）",
    github: "GitHub 上的 openpurr",
    issue: "提交 Issue",
  },
};
