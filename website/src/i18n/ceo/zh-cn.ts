// The "RevenueCat's CEO on X" page in this language (see en.ts for the notes).
import type { CeoDict } from "./en";

export const ceoZhCn: CeoDict = {
  meta: {
    title: "RevenueCat CEO 每天在 X 上发帖 {perDay} 次 - openpurr",
    description:
      "90 天里，RevenueCat 的 CEO 在 X 上发帖 {posts} 次，每天分布在 {hours} 个小时，约 {pct} 提到 RevenueCat。你的 1% 在为他的公司买单。",
    ogImageAlt: "RevenueCat 的 CEO 每天在 X 上发帖约 10 次，天天如此。你的 1% 在为他掌管的公司买单。",
  },
  hero: {
    crumb: "CEO 的 X",
    eyebrow: "你的 1% 去了哪里",
    headline: "RevenueCat 的 CEO 每天在 X 上发帖 {perDay} 次。",
    headlineAccent: "你的 1% 在为他掌管的公司买单。",
    lede: "过去 {days} 天，RevenueCat 的 CEO Jacob Eiting（{handle}）在 X 上发帖 {posts} 次。平均每天约 {perDay} 条，每天分布在 {hours} 个不同的小时，{days} 天中有 {active} 天发了帖。",
    updated: "更新于 {date} - 根据公开帖子统计",
  },
  stats: {
    posts: "{days} 天内的帖子",
    perDay: "每天发帖数",
    hours: "每天活跃小时数",
    active: "有发帖的天数（共 {days} 天）",
  },
  calendar: {
    title: "{days} 天发帖记录",
    note: "每个方格代表一天。颜色越深，当天有帖子的小时越多。",
    less: "无发帖",
    more: "小时更多",
    cell: "{date}：{hours} 个小时内发帖 {posts} 条",
  },
  topic: {
    title: "其中有多少与 RevenueCat 有关？",
    text: "按下方规则，他的帖子中有 <b>{pct}</b> 提到 RevenueCat 或其业务：{posts} 条中的 {onTopic} 条。同样的规则在 {base} 自己的帖子里也只找到 {basePct}，所以会漏掉一些。即便如此，他发的大部分内容都与此无关。",
    ceo: "他的帖子",
    base: "{base} 的帖子",
    about: "与 RevenueCat 有关",
  },
  pays: {
    title: "你的 1% 在为什么买单",
    text: "月收入超过 {threshold} 后，RevenueCat 就抽走你全部收入的 1%。公司靠这笔钱运转，从服务器到管理层。",
    link: "看看你 1% 的其余部分去了哪里 →",
    ctaKeep: "留住你的 1% →",
    ctaGithub: "GitHub 上的 openpurr",
  },
  method: {
    title: "我们如何统计",
    posts: "<b>帖子：</b>{handle} 从 {start} 到 {end} 的所有公开帖子和回复，于 {checked} 通过 X 的 API 读取。转帖不计入，已删除的帖子无法计入。",
    hours: "<b>活跃小时：</b>至少有一条帖子的整点小时（如 9 点到 10 点）。9:05、9:40 和 14:10 发的帖子算 2 个活跃小时。统计的是有帖子的小时数，而不是花费的时间。每天按 UTC 从零点到零点计算。",
    rules: "<b>与 RevenueCat 有关：</b>提到 {accounts}、链接到 {sites}，或使用以下任一词语的帖子：{terms}。",
    limits: "<b>这些数字说明不了什么：</b>发帖可能是 CEO 工作的一部分，这些数字也不显示他何时工作。它们显示的是他发帖有多频繁，以及发的是什么。",
    data: "<b>数据：</b>我们只保存计数，不保存帖子正文。统计所用的脚本在{script}。",
    scriptLink: "我们的代码仓库",
    affiliation: "<b>无关联：</b>openpurr 与 RevenueCat 没有任何关联。",
  },
};
