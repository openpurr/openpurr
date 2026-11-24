// The "RevenueCat's CEO on X" page in this language (see en.ts for the notes).
import type { CeoDict } from "./en";

export const ceoJa: CeoDict = {
  meta: {
    title: "RevenueCat の CEO は X に 1 日 {perDay} 回投稿 - openpurr",
    description:
      "RevenueCat の CEO は 90 日で X に {posts} 回投稿。1 日 {hours} の時間帯に投稿し、RevenueCat への言及は約 {pct}。あなたの 1% が彼の会社を支えています。",
    ogImageAlt: "RevenueCat の CEO は毎日、X に 1 日約 10 回投稿しています。あなたの 1% が、彼の率いる会社を支えています。",
  },
  hero: {
    crumb: "X での CEO",
    eyebrow: "あなたの 1% の行き先",
    headline: "RevenueCat の CEO は X に 1 日 {perDay} 回投稿しています。",
    headlineAccent: "あなたの 1% が、彼の率いる会社を支えています。",
    lede: "過去 {days} 日間で、RevenueCat の CEO、Jacob Eiting（{handle}）は X に {posts} 回投稿しました。1 日あたり約 {perDay} 件、1 日のうち {hours} の時間帯に分かれ、{days} 日中 {active} 日に投稿しています。",
    updated: "{date} 更新 - 公開投稿から集計",
  },
  stats: {
    posts: "{days} 日間の投稿数",
    perDay: "1 日あたりの投稿数",
    hours: "1 日あたりの活動時間帯",
    active: "投稿のあった日（{days} 日中）",
  },
  calendar: {
    title: "{days} 日間の投稿",
    note: "1 マスが 1 日です。色が濃いほど、その日に投稿のあった時間帯が多いことを示します。",
    less: "投稿なし",
    more: "時間帯が多い",
    cell: "{date}：{hours} の時間帯に {posts} 件",
  },
  topic: {
    title: "そのうち RevenueCat の話はどれくらい？",
    text: "下記のルールでは、彼の投稿の <b>{pct}</b> が RevenueCat またはその事業に触れています（{posts} 件中 {onTopic} 件）。同じルールで {base} 自身の投稿を調べても {basePct} しか拾えないため、取りこぼしはあります。それでも、彼の投稿の大半は別の話題です。",
    ceo: "彼の投稿",
    base: "{base} の投稿",
    about: "RevenueCat 関連",
  },
  pays: {
    title: "あなたの 1% で払われているもの",
    text: "RevenueCat は、月 {threshold} を超えると売上全体の 1% を取ります。そのお金で、サーバーから経営陣まで、会社が回っています。",
    link: "残りの 1% の行き先を見る →",
    ctaKeep: "1% を取り戻す →",
    ctaGithub: "GitHub で openpurr を見る",
  },
  method: {
    title: "集計の方法",
    posts: "<b>投稿：</b>{start} から {end} までの {handle} の公開投稿と返信すべて。{checked} に X の API から取得しました。リポストは数えておらず、削除された投稿は数えられません。",
    hours: "<b>活動時間帯：</b>投稿が 1 件以上あった、時計上の 1 時間（9 時台、10 時台など）。9:05、9:40、14:10 の投稿なら 2 つの時間帯です。数えているのは投稿のあった時間帯で、費やした時間ではありません。1 日は UTC の 0 時から 24 時までです。",
    rules: "<b>RevenueCat 関連：</b>{accounts} に言及する、{sites} にリンクする、または次の語を使う投稿：{terms}。",
    limits: "<b>この数字が示さないこと：</b>投稿は CEO の仕事の一部でもありえますし、これらの数字は彼がいつ働いているかを示すものではありません。示しているのは、どれくらいの頻度で、何について投稿しているかです。",
    data: "<b>データ：</b>保存しているのは件数だけで、投稿本文は保存していません。集計に使ったスクリプトは{script}で公開しています。",
    scriptLink: "私たちのリポジトリ",
    affiliation: "<b>提携関係なし：</b>openpurr は RevenueCat とは無関係です。",
  },
};
