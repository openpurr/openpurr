// The RevenueCat pricing page in this language (see en.ts for the notes).
import type { PricingDict } from "./en";

export const pricingZhCn: PricingDict = {
  meta: {
    title: "RevenueCat 定价：你的 1% 去哪了 · openpurr",
    description:
      "RevenueCat 抽走你 1% 的收入，服务器成本却几乎可以忽略。剩下的钱去了哪里：工资、销售和风险投资人。",
    ogImageAlt: "RevenueCat 抽走你 1% 的收入，服务器成本却微不足道。剩下的钱花在了哪里？",
  },
  hero: {
    crumb: "RevenueCat 定价",
    eyebrow: "你的 1% 去了哪里",
    headline: "你付的不是服务器钱。",
    /** The headline's second, highlighted sentence. {valuation} is "$500 million". */
    headlineAccent: "你在供养一家估值 {valuation} 的公司。",
    /** {threshold} is "$2,500". */
    lede: "每月跟踪收入超过 {threshold} 后，RevenueCat 就抽走全部跟踪收入的 1%，而且你每增长一次，账单就跟着涨一次。支撑你 App 的服务器成本微不足道。剩下的钱养的是这家公司：它的工资、它的销售团队，还有它的投资人的回报。",
    updated: "更新于 {date} · 基于公开数据估算",
  },
  answer: {
    title: "一句话看懂 RevenueCat 定价",
    /** HTML. {threshold} is "$2,500". */
    text: "每月跟踪收入低于 {threshold} 免费，超过后收取<strong>全部收入的 1%</strong>。一年下来是多少，再对比同一个 App 的服务器成本：",
    colRevenue: "月收入",
    colFee: "RevenueCat 年费",
    colServers: "服务器年成本",
  },
  calc: {
    revenue: "你的 App 月收入",
    fee: "RevenueCat 抽走",
    servers: "服务器实际成本",
    perYear: "/年",
    stackLabel: "你的年费：服务器与 RevenueCat 各团队的占比",
    /** HTML. {servers} and {rest} are percentages. */
    stackNote: "服务器：{servers}。其余 {rest} 都花在他们的团队上：",
    /** {people} is a number, {salary} is like "$210K". */
    teamMeta: "约 {people} 人 · 典型薪资 {salary}",
    swag: "账单里还有：给团队发的发光 RevenueCat 滑板。这些也由你的 1% 买单。",
    swagPostAlt: "一名 RevenueCat 员工在 X 上的帖子：“我的 RevenueCat 滑板昨天到了！这是领取你自己的免费 RevenueCat 滑板的链接”，链接指向 RevenueCat 的招聘页面",
    swagPhotoAlt: "一块发光的 RevenueCat 滑板",
    swagCaption: "{date} 发布于 X。“领取你自己的”链接指向他们的招聘页面。{link}",
    swagLink: "查看帖子",
    ownersTitle: "你的 1%，在为别人的退出铺路",
    /** {pct} is like "55%". */
    ownersInvestors: "风险投资人 · 约 {pct}",
    ownersRest: "创始人和员工",
    ownersBarLabel: "风险投资人持有 RevenueCat 约 {pct} 的股份（我们的估算）",
    /** HTML. {funding} is "$100 million"; {vc} is an amount that moves with the slider. */
    ownersText:
      "风险投资人分五轮向 RevenueCat 投入了约 {funding}，按报道的估值计算，他们拥有公司一半以上的股份。他们不需要从每笔付款里抽成：你付的每一笔费用都在推高他们所持公司的价值，等公司出售时再一并收回。按持股比例算，你每年支付的费用中约有 {vc} 在为他们的回报添砖加瓦。",
    investorsLabel: "RevenueCat 的投资人",
    /** HTML. {days} is a number, {infra} an amount; both move with the slider. */
    punch: "你的 1% 每年能买到 RevenueCat 约 {days} 个工程师人天。同样的活自己跑，只要 {infra}。",
    /** HTML. {keep} is an amount that moves with the slider. */
    keep: "剩下的 {keep}，留给自己。",
    ctaKeep: "留住你的 1% →",
    ctaGithub: "GitHub 上的 openpurr",
  },
  teams: {
    eng: { name: "工程", basis: "高级 SDK 工程师职位，21.2 万美元" },
    product: { name: "产品、设计与数据", basis: "高级产品经理职位，23 万美元；高级数据科学家，22 万美元" },
    sales: { name: "销售", basis: "Head of Sales 职位，36.3 万美元；高级销售工程师，20 万美元；产品专家，13.3 万美元" },
    growth: { name: "市场与增长", basis: "Head of Customer Growth 职位，25.9 万美元；CRO 设计师，20.5 万美元；产品营销，16.8 万美元" },
    support: { name: "客户成功与支持", basis: "开发者支持工程师职位，11.8 万美元" },
    community: { name: "开发者关系与社区", basis: "全部职位的总体中位数（约 21.5 万美元），按职级构成打了折扣" },
    ops: { name: "运营、财务与人事", basis: "销售与运营专员职位，16.7 万美元；Head of People，28 万美元" },
    exec: { name: "高管", basis: "有的高于 Head of Sales 职位（36.3 万美元），有的低于它" },
  },
  faq: {
    title: "常见问题",
    /** Each answer is also the page's FAQ structured data. Amounts are filled in by the page. */
    items: {
      cost: {
        q: "RevenueCat 收费多少？",
        /** {threshold} "$2,500"; {at10k} the yearly fee at $10,000 a month, {at100k} at $100,000 a month; {m10k} "$10,000", {m100k} "$100,000". */
        a: "RevenueCat 的 Pro 方案在每月跟踪收入低于 {threshold} 时免费。超过之后，按全部收入的 1% 收费，而不只是超出 {threshold} 的部分：月收入 {m10k} 的 App 每年要付 {at10k}，月收入 {m100k} 则每年要付 {at100k}。大客户可以协商 Enterprise 价格。",
      },
      pays: {
        q: "RevenueCat 的 1% 费用花在了哪里？",
        /** {servers} and {fee} are yearly amounts for an app making {m25k} ("$25,000") a month; {people} is a number. */
        a: "主要花在公司本身。一个典型 App 背后的服务器每月只要几美元：月收入 {m25k} 的 App，服务器每年成本 {servers}，而费用是 {fee}。剩下的钱用来供养一支约 {people} 人的团队，包括工程、销售、市场和高管，并为公司的投资人积累价值。",
      },
      owns: {
        q: "RevenueCat 归谁所有？",
        /** {funding} "$100 million"; {investors} the list of firms, already joined; {pct} like "55%". */
        a: "RevenueCat 已分五轮从风险投资人那里融资约 {funding}，投资方包括 {investors}。按报道的各轮估值逐轮推算，投资人估计持有公司 {pct} 的股份，其余归创始人和员工所有。",
      },
      worth: {
        q: "RevenueCat 值多少钱？",
        /** {valuation} "$500 million", {round} "$50 million", {revenue} "$30 million". */
        a: "据报道，RevenueCat 在 2025 年完成 {round} 的 C 轮融资时估值 {valuation}，当时年收入约 {revenue}。这些是媒体和分析师的数据，并非公司披露。",
      },
      alternative: {
        q: "有没有不收收入分成的 RevenueCat 替代方案？",
        a: "有。openpurr 是免费、开源、自托管的后端，兼容官方的 RevenueCat Purchases SDK。你只需把 SDK 的代理 URL 指向自己的服务器，购买代码保持不变。小型 App 用 Cloudflare 免费套餐就能运行，没有收入分成，也没有按交易收取的费用。",
      },
    },
  },
  more: {
    title: "没错，他们做的更多",
    text: "RevenueCat 做的不只是购买后端：付费墙、实验、集成、客服支持。如果这些你全都用，也许对你来说值得。但如果你需要的只是验证购买、让订阅状态保持最新，那你就是在为一份每月几美元服务器就能搞定的活，交出你未来全部收入的一部分。",
  },
  method: {
    title: "我们如何估算",
    /** HTML. Each item starts with a bold label. */
    fee: "<b>你的费用：</b>RevenueCat Pro 方案的标价，从 {threshold} 起按每月跟踪收入的 1% 收费。大客户可以协商其他价格。",
    /** HTML. {calculator} becomes a link labelled with `calculatorLink`. */
    servers:
      "<b>服务器：</b>该收入规模的 App 在 Cloudflare 上运行 openpurr Lite 的成本，与我们的{calculator}采用相同模型。RevenueCat 自己的托管成本并未公开；这是你自己运行同样工作的成本。",
    calculatorLink: "节省计算器",
    /** HTML. {used}, {low}, {high} are headcounts; {loaded} is "1.3". */
    teams:
      "<b>团队：</b>按职能划分，而非具体的人。我们假设共 {used} 人（公开估算在 {low} 到 {high} 人之间），并自行分配到各职能。薪资来自 RevenueCat 标明薪酬的公开招聘职位；每个团队的成本 = 人数 × 薪资 × {loaded}（税费、福利和设备），不含股权。你的费用中服务器以外的部分，按这些成本的比例分摊。",
    split:
      "<b>为什么销售和增长岗位多于工程：</b>{date} 当天，RevenueCat 的招聘页面共列出 {open} 个空缺职位：销售、市场和增长 {gtm} 个，核心工程 {eng} 个。处于这一阶段的公司正在扩建市场推广（go-to-market）团队，新发布的 Head of Sales 职位是页面上薪酬最高的。",
    /** HTML. {funding} "$100 million", {pct} like "55%", {revenue} "$30 million". */
    investors:
      "<b>投资人：</b>2018 年至 2025 年共五轮，总计约 {funding}。持股比例并未公开，因此我们根据报道的估值逐轮推算：每轮投资人获得的比例为投资额除以投后估值，此前所有股东按同一比例被稀释。由此得出约 {pct}。期权池和 Y Combinator 的加速器股份未计入。他们的份额是公司价值的一部分，而不是成本中的一项，所以单独列出。据报道，在 2025 年那轮融资时，公司年收入约 {revenue}，接近盈亏平衡。",
    colRound: "轮次",
    colRaised: "融资额",
    colValuation: "估值",
    colLead: "领投方",
    notReported: "未披露",
    /** HTML. */
    affiliation: "<b>无关联：</b>openpurr 与 RevenueCat 没有任何关联。这些是我们的估算，而非 RevenueCat 的数据。",
    assumptions: "各团队的假设",
    colTeam: "团队",
    colPeople: "人数",
    colSalary: "薪资",
    colCost: "年成本",
    colBasis: "薪资来源",
  },
  sources: {
    title: "来源",
    /** One label per source, in this order. The links themselves are in English. */
    items: [
      "RevenueCat 定价：每月跟踪收入从 2,500 美元起收取 1%",
      "RevenueCat 招聘页面，含薪资范围（Ashby）",
      "RevenueCat 早期标明薪资的招聘职位（Greenhouse）",
      "TechCrunch：RevenueCat 融资 5000 万美元，总融资额达 1 亿美元（2025 年 5 月）",
      "TechCrunch：Y Combinator Continuity Fund 领投的 4000 万美元 B 轮，估值 3 亿美元（2021 年）",
      "TechCrunch：Adjacent 领投的 1200 万美元 C 轮（2024 年）",
      "SaaStr：2018 年估值 700 万美元的种子轮，以及此后各轮",
      "Multiples.vc：2025 年那轮融资时收入约 3000 万美元、估值 5 亿美元（估算）",
      "员工人数估算：TipRanks（185 人）",
      "员工人数估算：TrueUp（130 人）",
    ],
    /** HTML. {date} is the date; {issue} becomes a link labelled with `issueLink`. */
    checked: "核查于 {date}。发现信息过时了？{issue}。",
    issueLink: "提交 Issue",
  },
};
