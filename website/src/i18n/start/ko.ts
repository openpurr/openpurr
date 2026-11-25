// The "Add in-app purchases" page in this language (see en.ts for the notes).
import type { StartDict } from "./en";

export const startKo: StartDict = {
  meta: {
    title: "앱에 인앱 결제와 구독을 무료로 추가하기 - openpurr",
    description:
      "새 앱을 시작하나요? 공식 Purchases SDK와 직접 운영하는 오픈소스 백엔드로 인앱 결제와 구독을 추가하세요. 수익 배분은 영원히 없습니다.",
    ogImageAlt: "새 앱을 시작하나요? 수익 배분 없이 시작하세요. 내 1%를 지켜서 비즈니스에 투자하세요.",
  },
  hero: {
    crumb: "인앱 결제 추가하기",
    eyebrow: "새 앱을 위해",
    headline: "새 앱을 시작하나요?",
    headlineAccent: "수익 배분 없이 시작하세요.",
    /** {threshold} is "$2,500". */
    lede: "대부분의 결제 백엔드는 월 매출이 {threshold} 이상이 되면 매출의 1%를 가져가고, 매출이 늘 때마다 청구액도 커집니다. 피하기 가장 쉬운 때는 첫 판매 전입니다. openpurr는 직접 운영하는 무료 오픈소스 인앱 결제 및 구독 백엔드로, 큰 플랫폼들이 쓰는 것과 같은 공식 SDK를 사용합니다.",
    ctaStart: "GitHub에서 시작하기",
    ctaHow: "작동 방식",
  },
  growth: {
    title: "내 1%, 첫날부터",
    text: "3년 후 앱이 어느 정도일지 골라 보세요. 0에서 꾸준히 성장한다고 가정할 때, 그때까지 1% 수익 배분이 얼마가 되는지 보여 드립니다.",
    target: "3년 후 월 매출",
    /** Labels for the totals. */
    fee: "1% 수익 배분, 3년 합계",
    servers: "직접 운영, 3년 합계",
    after: "그 후로는 매년",
    /** The chart's accessible description. */
    chartLabel: "3년 동안 매달 쌓여 가는 수익 배분",
    /** HTML. {fee} and {servers} are amounts that move with the slider. */
    summary: "4년 차가 되기 전에 넘겨주는 돈은 <b>{fee}</b>, 내 서버 비용은 <b>{servers}</b>입니다. 그 돈을 지켜서 비즈니스에 쓰세요.",
  },
  invest: {
    title: "비즈니스에, 그리고 나에게 투자하세요",
    text: "1%를 지키면 1년 치로 살 수 있는 것들:",
  },
  how: {
    title: "작동 방식",
    lede: "네 단계면 끝나고, 작성하는 코드는 RevenueCat 튜토리얼과 똑같습니다.",
    steps: [
      {
        title: "openpurr 배포하기",
        /** HTML. */
        text: "내 Cloudflare 계정에서 설정을 실행하세요. 작은 앱이라면 Lite는 <b>무료 플랜</b>에 맞고, 설정이 중간에 멈춰도 안전하게 다시 실행할 수 있습니다.",
      },
      {
        title: "앱과 상품 추가하기",
        text: "대시보드는 첫 앱 추가부터 시작합니다. 번들 ID와 패키지 이름을 넣고, 상품, 엔타이틀먼트, 오퍼링을 설정하세요.",
      },
      {
        title: "Purchases SDK 추가하기",
        /** HTML. */
        text: "MIT 라이선스 오픈소스인 공식 RevenueCat Purchases SDK를 설치하고, configure 전에 <b>프록시 URL 하나</b>만 설정하세요.",
      },
      {
        title: "출시하기",
        text: "구매는 Apple과 Google에서 검증되고, 갱신과 환불은 스토어 알림으로 들어오며, 내 백엔드는 웹훅을 받습니다. Claude Code를 쓰나요? openpurr 플러그인이 App Store Connect와 Play Console 설정을 안내합니다.",
      },
    ],
    /** Above the setup commands. */
    setupLabel: "설정, 내 컴퓨터에서",
  },
  includes: {
    title: "제공되는 것",
    yes: [
      "App Store와 Google Play의 구매와 구독",
      "엔타이틀먼트와 오퍼링",
      "서명되고 재시도되는 백엔드 웹훅",
      "16가지 차트: 매출, MRR, 이탈, 체험 등",
      "가격 실험",
      "내 데이터베이스에 저장되는 내 데이터",
    ],
    notYetTitle: "아직 없는 것",
    notYet: "페이월 빌더, 서드파티 분석 연동, 광고 이벤트, 웹 결제, Amazon. 처음부터 이것들이 필요하다면 상용 플랫폼에서 지금 바로 쓸 수 있습니다.",
  },
  lockin: {
    title: "어느 쪽이든, 종속 없음",
    text: "openpurr는 표준 Purchases SDK를 사용하므로 결제 코드는 어느 백엔드에서든 작동합니다. openpurr로 부족해지거나 상용 플랫폼의 기능이 필요해지면, 전환은 다시 작성할 필요 없이 설정 변경과 고객 가져오기로 끝납니다.",
  },
  pricingLink: {
    text: "1%를 내면 그 돈이 어디로 가는지 궁금하신가요?",
    link: "RevenueCat 가격 분석 보기 →",
  },
  faq: {
    title: "자주 묻는 질문",
    /** Each answer is also the page's FAQ structured data. */
    items: {
      backend: {
        q: "인앱 결제에 백엔드가 필요한가요?",
        a: "꼭 그렇지는 않습니다. StoreKit과 Google Play Billing은 기기에서 실행됩니다. 하지만 백엔드가 있으면 구독을 정확하게 관리할 수 있습니다. Apple과 Google에서 구매를 검증하고, 스토어 알림으로 갱신, 취소, 환불을 추적하고, 누가 이용 권한이 있는지 앱과 서버에 알려 줍니다. openpurr가 바로 그 백엔드이며, 직접 운영합니다.",
      },
      cheapest: {
        q: "iOS나 Android 앱에 구독을 추가하는 가장 저렴한 방법은 무엇인가요?",
        /** {servers} a yearly amount, {m25k} "$25,000". */
        a: "백엔드를 직접 운영하는 것입니다. openpurr Lite는 작은 앱이라면 Cloudflare 무료 플랜에 맞고 무료 오픈소스 Purchases SDK와 함께 작동하므로, 내는 비용은 서버뿐입니다. 저희 모델에서 월 매출이 {m25k} 규모인 앱이라면 연 약 {servers} 수준이며, 수익 배분은 없습니다.",
      },
      free: {
        q: "openpurr는 정말 무료인가요?",
        a: "네. Apache 2.0 라이선스의 오픈소스이며, 수익 배분도 거래당 수수료도 없습니다. 내 서버 비용만 내면 되고, 작은 앱은 Cloudflare 무료 플랜에 맞습니다.",
      },
      switch: {
        q: "나중에 RevenueCat으로 옮길 수 있나요?",
        a: "네. openpurr는 공식 RevenueCat Purchases SDK를 사용하므로 앱의 결제 코드는 어느 백엔드에서든 작동하고, 스토어의 상품도 그대로입니다. 전환은 설정 변경과 고객 기록 이전으로 끝납니다.",
      },
      missing: {
        q: "openpurr가 아직 하지 못하는 것은 무엇인가요?",
        a: "페이월 빌더, 서드파티 분석 연동, 광고 이벤트, 웹 결제, Amazon입니다. 가격 실험은 기본으로 들어 있습니다. 나머지가 처음부터 필요하다면 상용 플랫폼에서 지금 바로 쓸 수 있습니다.",
      },
    },
  },
};
