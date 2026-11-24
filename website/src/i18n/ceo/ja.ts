// The "RevenueCat's CEO on X" page in this language (see en.ts for the notes).
import type { CeoDict } from "./en";

export const ceoJa: CeoDict = {
  meta: {
    title: "RevenueCat CEO の Jacob Eiting、X に 1 日 {perDay} 回投稿",
    description:
      "RevenueCat の CEO、Jacob Eiting は 90 日で X に {posts} 回投稿。1 日 {hours} の時間帯に投稿し、RevenueCat への言及は約 {pct}。その費用の一部は、あなたの 1% です。",
    ogImageAlt: "RevenueCat の CEO は毎日、X に 1 日約 10 回投稿しています。その費用の一部は、あなたの 1% です。",
  },
  hero: {
    crumb: "X での CEO",
    eyebrow: "あなたの 1% の行き先",
    headline: "RevenueCat の CEO、Jacob Eiting は X に 1 日 {perDay} 回投稿しています。",
    headlineAccent: "その費用の一部は、あなたの 1% です。",
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
    title: "あなたの 1% は、彼の SNS 代でもある",
    text: "RevenueCat は、月 {threshold} を超えると売上全体の 1% を取ります。そのお金で会社が回り、CEO の報酬もそこから出ています。つまり、あなたの 1% の一部は、X への 1 日約 {perDay} 件の投稿に使われています。",
    link: "残りの 1% の行き先を見る →",
    ctaKeep: "1% を取り戻す →",
    ctaGithub: "GitHub で openpurr を見る",
  },
  faq: {
    title: "よくある質問",
    items: {
      who: {
        q: "RevenueCat の CEO は誰ですか？",
        a: "Jacob Eiting は RevenueCat の共同創業者で CEO です。X では {handle} として投稿しており、フォロワーは約 {followers} 人です。",
      },
      often: {
        q: "RevenueCat の CEO は X にどれくらい投稿していますか？",
        a: "{end} までの {days} 日間で、Jacob Eiting は X に {posts} 回投稿しました（返信を含み、リポストは除く）。1 日あたり約 {perDay} 件、1 日のうち {hours} の時間帯に分かれ、{days} 日中 {active} 日に投稿しています。",
      },
      about: {
        q: "RevenueCat の CEO は X で何を投稿していますか？",
        a: "大半は RevenueCat 以外の話題です。私たちのキーワードルールでは、彼の投稿の {pct} が RevenueCat またはその事業に触れており、{base} 自身の投稿では {basePct} です。ルールは一部の投稿を取りこぼすため、{pct} は下限と考えてください。",
      },
      pays: {
        q: "RevenueCat の 1% の手数料は CEO の報酬にも使われていますか？",
        a: "一部はそうです。RevenueCat は、月 {threshold} を超えると売上全体の 1% を取り、そのお金で会社が回っています。経営陣の報酬もそこから出ています。RevenueCat は役員報酬を公開していません。",
      },
    },
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
