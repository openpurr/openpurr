// The "RevenueCat's CEO on X" page in this language (see en.ts for the notes).
import type { CeoDict } from "./en";

export const ceoKo: CeoDict = {
  meta: {
    title: "RevenueCat CEO는 X에 하루 {perDay}번 글을 올립니다 - openpurr",
    description:
      "RevenueCat CEO는 90일간 X에 {posts}번, 하루 {hours}개 시간대에 글을 올렸습니다. RevenueCat 언급은 약 {pct}. 그가 X에 쓰는 시간의 일부를 내 1%가 냅니다.",
    ogImageAlt: "RevenueCat CEO는 매일 X에 하루 약 10번 글을 올립니다. 그 비용의 일부는 내 1%입니다.",
  },
  hero: {
    crumb: "X의 CEO",
    eyebrow: "내 1%가 가는 곳",
    headline: "RevenueCat CEO는 X에 하루 {perDay}번 글을 올립니다.",
    headlineAccent: "그 비용의 일부는 내 1%입니다.",
    lede: "지난 {days}일 동안 RevenueCat CEO Jacob Eiting({handle})은 X에 {posts}번 글을 올렸습니다. 하루 약 {perDay}개를, 하루 {hours}개 시간대에 나눠, {days}일 중 {active}일 동안 올린 셈입니다.",
    updated: "{date} 업데이트 - 공개 게시물 기준 집계",
  },
  stats: {
    posts: "{days}일간 게시물",
    perDay: "하루 게시물",
    hours: "하루 활동 시간대",
    active: "게시한 날 ({days}일 중)",
  },
  calendar: {
    title: "{days}일간의 게시 기록",
    note: "칸 하나가 하루입니다. 색이 진할수록 그날 글을 올린 시간대가 많습니다.",
    less: "게시 없음",
    more: "시간대 많음",
    cell: "{date}: {hours}개 시간대에 게시물 {posts}개",
  },
  topic: {
    title: "그중 RevenueCat 이야기는 얼마나 될까요?",
    text: "아래 기준으로 보면 그의 게시물 중 <b>{pct}</b>가 RevenueCat이나 그 사업을 언급합니다({posts}개 중 {onTopic}개). 같은 기준을 {base} 계정의 게시물에 적용해도 {basePct}만 잡히므로, 놓치는 글도 있습니다. 그래도 그가 올리는 글 대부분은 다른 이야기입니다.",
    ceo: "그의 게시물",
    base: "{base} 게시물",
    about: "RevenueCat 관련",
  },
  pays: {
    title: "내 1%는 그의 소셜 미디어 비용이기도 합니다",
    text: "RevenueCat은 월 매출이 {threshold}를 넘으면 전체 매출의 1%를 가져갑니다. 그 돈으로 회사가 돌아가고, CEO의 보수도 거기서 나옵니다. 결국 내 1%의 일부는 X에 하루 약 {perDay}개씩 올라오는 글값입니다.",
    link: "내 1%의 나머지가 어디로 가는지 보기 →",
    ctaKeep: "내 1% 지키기 →",
    ctaGithub: "GitHub에서 openpurr 보기",
  },
  method: {
    title: "집계 방법",
    posts: "<b>게시물:</b> {start}부터 {end}까지 {handle}의 모든 공개 게시물과 답글로, {checked}에 X API로 읽었습니다. 리포스트는 세지 않았고, 삭제된 게시물은 셀 수 없습니다.",
    hours: "<b>활동 시간대:</b> 글이 하나 이상 올라온 정시 단위 시간(9시대, 10시대 등)입니다. 9:05, 9:40, 14:10에 올린 글은 활동 시간대 2개입니다. 글을 올린 시간대를 세는 것이지, 들인 시간을 세는 것이 아닙니다. 하루는 UTC 기준 자정부터 자정까지입니다.",
    rules: "<b>RevenueCat 관련:</b> {accounts} 계정을 언급하거나, {sites} 링크를 포함하거나, 다음 용어 중 하나를 쓰는 게시물: {terms}.",
    limits: "<b>이 수치가 말하지 않는 것:</b> 글을 올리는 것도 CEO 업무의 일부일 수 있으며, 이 수치는 그가 언제 일하는지 보여주지 않습니다. 얼마나 자주, 무엇에 대해 글을 올리는지를 보여줄 뿐입니다.",
    data: "<b>데이터:</b> 저희는 개수만 저장하며, 게시물 본문은 저장하지 않습니다. 집계에 쓴 스크립트는 {script} 있습니다.",
    scriptLink: "저희 저장소에",
    affiliation: "<b>제휴 관계 없음:</b> openpurr는 RevenueCat과 관련이 없습니다.",
  },
};
