// Korean copy. Follows en.ts; see the notes there. Polite formal style (합니다, -세요); "entitlement" is 엔타이틀먼트 throughout.
import type { Dict } from "./en";

export const ko: Dict = {
  meta: {
    title: "openpurr: 셀프 호스팅 오픈소스 RevenueCat 대안",
    description:
      "openpurr는 셀프 호스팅 오픈소스 RevenueCat 대안입니다. 지금 쓰는 Purchases SDK를 그대로 두고 내 서버에 연결하세요. 수익 배분은 없습니다.",
    ogImageAlt: "openpurr: 셀프 호스팅 오픈소스 RevenueCat 대안과 구독 차트 대시보드",
  },
  header: {
    home: "openpurr 홈",
    nav: { features: "기능", editions: "에디션", roadmap: "로드맵", faq: "FAQ", migrate: "마이그레이션" },
    language: "언어",
  },
  footer: {
    tagline: "직접 운영하는 오픈소스 인앱 결제 인프라.",
    roadmap: "로드맵",
    contributing: "기여하기",
    sponsor: "후원하기",
    contact: "문의",
    privacy: "개인정보 처리방침 (영어)",
    disclaimer:
      "openpurr는 독립 프로젝트이며 RevenueCat, Inc.와 제휴하거나 그 보증을 받지 않았습니다. App Store는 Apple Inc.의 상표입니다. Google Play는 Google LLC의 상표입니다.",
    copyright: "Copyright {year} openpurr 기여자.",
    cookieSettings: "쿠키 설정",
  },
  consent: {
    label: "쿠키 동의",
    text: "방문 수를 집계하고 어떤 페이지가 도움이 되는지 알아보기 위해 Google Analytics 쿠키를 사용하려고 합니다. 동의하지 않으면 아무것도 저장되지 않으며, 언제든지 쿠키 설정에서 선택을 바꿀 수 있습니다.",
    privacy: "개인정보 처리방침 (영어)",
    decline: "거부",
    accept: "동의",
  },
  snippet: {
    tabs: "SDK 플랫폼",
    note: "한 줄이면 됩니다. SDK도, 결제 코드도 그대로입니다.",
  },
  home: {
    hero: {
      title: '<span class="nowrap">셀프 호스팅</span> 오픈소스 <span class="accent">RevenueCat 대안</span>',
      lede: "결제 인프라를 직접 통제하고, 수익을 나누지 않고, 어떤 상용 서비스에도 의존하지 마세요. 지금 쓰는 Purchases SDK는 그대로 둡니다. 바꾸는 것은 결제 코드가 아니라 URL 하나입니다.",
      star: "GitHub에서 Star 하기",
      how: "작동 방식",
      runsOn: "지원 클라우드",
      shotAlt:
        "openpurr Lite 대시보드. 12개월간의 MRR 변동, 활성 구독, 이탈, 신규 고객, 신규 체험, 활성 체험을 보여 줍니다",
    },
    why: {
      eyebrow: "누구를 위한 것인가",
      title: "직접 운영하고 싶은 앱 개발자를 위해",
      lede: "openpurr는 수정하지 않은 공식 SDK와 함께 작동합니다. 전환은 결제 코드를 다시 짜는 것이 아니라 URL 하나를 바꾸는 것에서 시작합니다.",
      reasons: [
        {
          title: "내 데이터, 내 서버",
          body: "구매 기록, 엔타이틀먼트, 스토어 자격 증명은 직접 운영하고 조회하고 백업하고 내보낼 수 있는 데이터베이스에 저장됩니다. 앱과 고객 사이에 외부 서비스가 끼어들지 않습니다.",
        },
        {
          title: "수익 배분 없음",
          body: "수익의 일정 비율도, 거래당 수수료도 없습니다. Lite 에디션은 Cloudflare 무료 플랜에 맞게 설계되어 작은 앱이라면 비용 없이 운영할 수 있습니다.",
        },
        {
          title: "의존할 벤더 없음",
          body: "Apache 2.0 라이선스의 오픈소스입니다. 코드를 읽고, 고치고, Cloudflare와 내 클라우드 사이를 자유롭게 옮길 수 있습니다.",
        },
      ],
    },
    how: {
      eyebrow: "작동 방식",
      title: "벤더가 있던 자리에 내 서버가 들어갑니다",
      lede: "앱은 이미 탑재한 오픈소스 Purchases SDK를 그대로 사용합니다. SDK는 openpurr와 통신하고, openpurr는 스토어와 통신하며 구독 상태를 관리하고 무엇이 바뀌었는지 백엔드에 알려 줍니다.",
      flowLabel: "요청 흐름",
      app: "내 앱",
      sdkLicense: "수정하지 않은 공식 SDK, MIT 라이선스",
      sdkPlatforms: "iOS, Android, Flutter 또는 React Native",
      coreWhere: "Cloudflare Workers 또는 내 클라우드에서 실행",
      appStoreApi: "Server API와 알림",
      playApi: "Developer API와 RTDN",
      backend: "내 백엔드",
      backendHooks: "서명된 웹훅",
      steps: [
        {
          title: "배포",
          body: "내 Cloudflare 계정에서 openpurr Lite를 실행하세요. 안내형 설정 <code>pnpm run setup</code>이 데이터베이스를 만들고, 두 Worker를 배포하고, 소유자 계정을 생성합니다.",
        },
        {
          title: "SDK 연결",
          body: "<code>configure</code> 전에 프록시 URL을 설정하세요. 나중에 옮길 수 있도록 직접 소유한 커스텀 도메인을 사용하세요.",
        },
        {
          title: "스토어 연결",
          body: "스토어 자격 증명과 알림 URL을 추가하세요. 설정 점검 도구 <code>openpurr doctor</code>가 이를 확인하고, 빠진 항목이 있으면 해결 방법을 알려 줍니다.",
        },
      ],
    },
    features: {
      eyebrow: "주요 기능",
      title: "쓰지 않는 부가 기능 없이, 구독 백엔드만",
      items: [
        {
          title: "구매와 스토어 알림",
          body: "StoreKit 2 거래와 Google Play 구매를 검증하고, SDK가 기대하는 CustomerInfo와 엔타이틀먼트를 반환하며, App Store와 Google Play 알림으로 갱신, 환불, 유예 기간을 항상 최신 상태로 유지합니다.",
        },
        {
          title: "웹훅",
          body: "RevenueCat 형식의 이벤트를 HMAC-SHA256으로 서명해 백엔드로 보내고, 약 72시간 동안 재시도합니다.",
        },
        {
          title: "차트",
          body: "16가지 차트: 매출, MRR과 ARR, MRR 및 구독 변동, 활성 구독과 유료 구독, 구독 상태, 이탈, 체험과 체험 전환, 신규 고객, 환불과 환불률, 일회성 구매. 앱, 스토어, 상품, 환경별로 필터링할 수 있으며 매출은 USD로 환산됩니다.",
        },
        {
          title: "가격 실험",
          body: "앱을 처음 쓰는 고객에게 서로 다른 오퍼링을 보여 주고, 전환율과 고객당 매출을 비교하세요. 각 변형이 대조군보다 나을 확률도 함께 확인할 수 있습니다. 앱 업데이트는 필요 없습니다.",
        },
        {
          title: "인증과 감사",
          body: "SDK 키와 시크릿 키, 선택적 인증 앱 코드를 지원하는 운영자 로그인, 역할, 액세스 토큰, 감사 로그를 제공합니다.",
        },
        {
          title: "MCP 서버와 Claude 스킬",
          body: "고객에게 엔타이틀먼트가 있거나 없는 이유를 AI 어시스턴트에게 묻고, 구매 내역을 조회하고, App Store Connect와 Play Console 설정 안내를 받아 보세요.",
        },
      ],
    },
    editions: {
      eyebrow: "두 가지 에디션",
      title: "작게 시작하고, 앱 업데이트 없이 확장하세요",
      lede: "두 에디션은 같은 적합성 테스트 스위트를 통과합니다. 앱이 직접 소유한 커스텀 도메인을 가리키고 있다면, Lite에서 Standard로 옮길 때 앱을 새로 출시할 필요가 없습니다.",
      lite: {
        badge: "인디 앱용",
        price: "$0",
        priceNote: "Cloudflare 무료 플랜 기준",
        items: ["Cloudflare Workers와 D1 위의 TypeScript", "가볍고 운영 비용이 저렴함", "무료 플랜 한도에 도달하기 전 사용량 알림"],
      },
      standard: {
        badge: "출시 예정",
        price: "클라우드 요금만",
        priceNote: "그 외 비용 없음",
        items: ["컨테이너에서 실행되는 Go와 Postgres", "GCP 또는 AWS", "더 많은 앱을 운영하는 팀을 위해"],
      },
    },
    savings: {
      eyebrow: "비용",
      title: "RevenueCat와 비교해 남는 금액",
      lede: "RevenueCat의 Pro 요금제는 월 추적 매출이 $2,500 미만이면 무료이고, 그 이상이면 전체 매출의 1%를 받습니다. Lite는 Cloudflare 무료 플랜에서 실행되고, 앱이 무료 플랜을 넘어서면 월 $5부터인 Workers Paid에서 실행됩니다.",
      revenue: "월 매출",
      rc: "RevenueCat",
      op: "openpurr Lite",
      saved: "연간 절약액",
      perMonth: "월 {amount}",
      free: "Cloudflare 무료 플랜",
      paid: "Cloudflare Workers Paid",
      chartLabel: "월 매출별 월 비용: RevenueCat은 매출과 함께 늘고, openpurr Lite는 0에 가깝게 유지됩니다",
      gapLegend: "남는 금액",
      tableSummary: "다른 매출 규모에서 비교하기",
      colRevenue: "월 매출",
      colRc: "RevenueCat, 월",
      colOp: "openpurr Lite, 월",
      colSaved: "연간 절약액",
      methodSummary: "계산 방법",
      pricingLink: "RevenueCat의 1%는 어디로 갈까요? →",
      method: [
        "RevenueCat: Pro 요금제의 정가로, $2,500부터 월 추적 매출의 1%입니다. 추적 매출은 연간 구독과 일회성 구매를 결제한 달에 집계하므로 MRR보다 클 수 있습니다. 대규모 계정은 Enterprise 가격을 협상할 수 있습니다.",
        "openpurr Lite: Workers와 D1에 대한 Cloudflare 요금입니다. 일간 활성 사용자 1명당 월 매출 약 $1.50, 하루 SDK 요청 약 10회를 가정합니다. 이 기준이면 무료 플랜의 하루 100,000회 요청으로 여유 있게 월 매출 약 {paidFrom}까지 감당합니다. 그 이상은 Workers Paid로 계산합니다. 월 $5에 1,000만 회를 넘는 요청은 100만 회당 $0.30이 추가됩니다.",
        "포함되지 않은 것: 운영에 드는 시간. 스토어 수수료는 어느 쪽이든 같습니다.",
        "요금은 {date}에 확인했습니다. openpurr는 RevenueCat과 관련이 없습니다.",
      ],
    },
    fit: {
      eyebrow: "솔직하게 말씀드리면",
      title: "아직은 맞지 않을 수도 있습니다",
      lede: "페이월 빌더, 서드파티 분석 연동, 지원 계약이 필요하다면 지금은 상용 플랫폼이 이를 제공합니다.",
      outTitle: "현재 지원 범위 밖",
      tags: ["페이월", "광고 이벤트", "Customer Center", "가상 화폐", "웹 결제", "Amazon", "분석 연동"],
    },
    roadmap: {
      eyebrow: "로드맵",
      title: "앞으로의 방향",
      lede: "순서는 정해져 있지만 일정은 없습니다. 중요한 것이 있다면 이슈로 알려 주세요.",
      status: { done: "완료", wip: "진행 중", planned: "계획됨", later: "여러분의 선택" },
      phases: [
        {
          phase: "Lite",
          items: [
            "최신 릴리스: {version}",
            "Cloudflare 무료 플랜에 맞춘 설계",
            "App Store와 Google Play",
            "웹훅, 대시보드, 관리 기능",
            "하나의 배포에서 여러 앱 운영",
            "가격 실험",
            "MCP 서버, CLI, Claude 스킬",
            "다음 단계: 실기기 테스트, 그다음 1.0",
          ],
        },
        {
          phase: "Standard",
          items: ["컨테이너에서 실행되는 Go와 Postgres", "GCP 먼저, 그다음 AWS", "Lite와 같은 적합성 테스트 스위트", "앱 업데이트 없이 Lite에서 이전"],
        },
        {
          phase: "커뮤니티와 함께 만드는 단계",
          items: ["검증된 최종 사용자 신원", "더 큰 팀을 위한 Standard 부가 기능", "이슈로 요청해 주시는 모든 것"],
        },
      ],
      more: "전체 로드맵 보기 (영어) →",
    },
    cta: {
      title: "함께 만들어 주세요",
      body: "지금 가장 도움이 되는 것은 피드백입니다. SDK나 스토어에 대한 잘못된 가정, 그리고 갱신, 환불, 유예 기간에서 실제로 겪은 예외 상황을 알려 주세요.",
      star: "GitHub에서 Star 하기",
      issue: "이슈 등록하기",
      coffee: "커피 한 잔 후원하기",
    },
  },
  faq: {
    eyebrow: "FAQ",
    title: "RevenueCat 대안으로서의 openpurr",
    lede: "구독 백엔드를 직접 운영하면 무엇이 바뀌고 무엇이 그대로인지 정리했습니다.",
    items: [
      {
        q: "openpurr는 무엇인가요?",
        a: "openpurr는 셀프 호스팅 오픈소스 RevenueCat 대안입니다. 공식 RevenueCat Purchases SDK와 함께 작동하는 인앱 결제 및 구독 백엔드입니다. App Store와 Google Play 구매를 검증하고, 엔타이틀먼트를 추적하고, 스토어 알림을 수신하고, 백엔드로 웹훅을 보내고, 핵심 구독 지표를 차트로 보여 줍니다. 이 모든 것이 직접 통제하는 인프라에서 이루어집니다.",
      },
      {
        q: "openpurr는 RevenueCat과 무엇이 다른가요?",
        a: "RevenueCat은 무료 구간을 넘으면 수익의 일부를 받는 호스팅형 상용 서비스입니다. openpurr는 직접 운영하는 소프트웨어입니다. 구매 기록, 엔타이틀먼트, 스토어 자격 증명은 내 데이터베이스에 저장되며, 수익 배분이나 거래당 수수료가 없습니다. 현재 기능은 페이월, 분석 연동 등 RevenueCat이 더 많습니다. openpurr는 핵심 구독 백엔드에 집중합니다.",
      },
      {
        q: "RevenueCat에서 전환하려면 결제 코드를 다시 작성해야 하나요?",
        a: "아니요. openpurr는 수정하지 않은 공식 Purchases SDK와 함께 작동합니다. configure를 호출하기 전에 SDK의 프록시 URL을 openpurr 서버로 설정하면 나머지 결제 코드는 그대로입니다. 직접 소유한 커스텀 도메인을 사용하면 나중에 앱 업데이트 없이 서버를 옮길 수 있습니다.",
      },
      {
        q: "기존 고객을 RevenueCat에서 어떻게 옮기나요?",
        a: "가져오기 기능을 사용합니다. RevenueCat에 마이그레이션 내보내기를 요청하면, openpurr import가 각 고객의 구매 내역을 Apple과 Google에서 가져와 동일한 앱 사용자 ID에 연결합니다. 새 버전의 앱도 각 고객의 구매 내역을 한 번 전송하고, 사용자들이 앱을 업데이트하는 동안 두 백엔드가 모두 최신 상태로 유지되므로 이용이 끊기는 사람이 없습니다.",
        link: "마이그레이션 방법",
      },
      {
        q: "Adapty에서 옮겨 올 수 있나요?",
        a: "네, 앱 업데이트가 필요합니다. Adapty의 SDK는 다른 서버를 가리키도록 설정할 수 없으므로, 업데이트를 통해 openpurr와 함께 작동하는 Purchases SDK로 교체합니다. 스토어의 상품은 그대로 유지됩니다. openpurr는 Adapty의 이벤트 내보내기에서 App Store 고객을 가져오고, 나머지 고객은 새 버전의 앱이 처음 실행될 때 옮겨집니다. 사용자들이 앱을 업데이트하는 동안 두 백엔드가 모두 최신 상태로 유지됩니다.",
        link: "Adapty 가이드 읽기",
        linkTo: "adapty",
      },
      {
        q: "openpurr는 어떤 플랫폼과 스토어를 지원하나요?",
        a: "iOS, Android, Flutter, React Native용 Purchases SDK를 지원하며, App Store와 Google Play 구매를 처리합니다. Amazon과 웹 결제는 현재 지원 범위에 포함되지 않습니다.",
      },
      {
        q: "openpurr는 비용이 얼마인가요?",
        a: "openpurr는 Apache 2.0 라이선스의 무료 오픈소스입니다. 실행하는 인프라 비용만 내면 됩니다. Lite 에디션은 Cloudflare 무료 플랜에서 실행되도록 설계되어 작은 앱이라면 비용 없이 운영할 수 있습니다. Standard 에디션은 내 클라우드의 컨테이너에서 실행되므로 비용은 클라우드 요금이 전부입니다.",
      },
      {
        q: "데이터는 어디에 저장되나요?",
        a: "내 데이터베이스에 저장됩니다. Lite 에디션은 내 Cloudflare 계정의 Cloudflare D1을 사용하고, Standard 에디션은 GCP 또는 AWS의 Postgres를 사용합니다. 데이터를 조회하고 백업하고 내보낼 수 있으며, 앱과 고객 사이에 외부 서비스가 끼어들지 않습니다.",
      },
      {
        q: "openpurr도 RevenueCat처럼 웹훅을 보내나요?",
        a: "네. openpurr는 RevenueCat 형식의 이벤트를 HMAC-SHA256으로 서명해 백엔드로 보내고 약 72시간 동안 재시도합니다. 따라서 기존 웹훅 핸들러는 거의 또는 전혀 수정할 필요가 없습니다.",
      },
      {
        q: "RevenueCat에는 있고 openpurr에는 없는 기능은 무엇인가요?",
        a: "페이월, 서드파티 분석 연동, Customer Center, 가상 화폐, 웹 결제, Amazon, 광고 이벤트, 상용 지원 계약은 현재 지원 범위에 포함되지 않습니다. 가격 실험은 기본으로 제공됩니다. 다른 기능이 지금 필요하다면 상용 플랫폼이 더 적합합니다.",
      },
      {
        q: "openpurr를 프로덕션에서 사용할 수 있나요?",
        a: "아직은 아닙니다. openpurr는 초기 단계로, Lite 에디션은 개발 중이고 Standard 에디션은 그 이후에 나옵니다. GitHub에서 로드맵을 지켜봐 주시고, 중요한 것이 있다면 이슈를 등록해 주세요.",
      },
      {
        q: "openpurr는 RevenueCat과 관련이 있나요?",
        a: "아니요. openpurr는 독립 오픈소스 프로젝트이며 RevenueCat, Inc.와 제휴하거나 그 보증을 받지 않았습니다. MIT 라이선스로 공개된 RevenueCat의 공식 Purchases SDK와 함께 작동합니다.",
      },
    ],
  },
  structured: {
    description:
      "셀프 호스팅 오픈소스 RevenueCat 대안: 수정하지 않은 공식 Purchases SDK와 함께 작동하는 App Store 및 Google Play 인앱 결제와 구독용 백엔드입니다. 구매를 검증하고, 엔타이틀먼트를 추적하고, 스토어 알림을 수신하고, 웹훅을 보내고, 구독 지표를 차트로 보여 줍니다.",
    subCategory: "인앱 결제 및 구독 백엔드",
    features: [
      "iOS, Android, Flutter, React Native용 공식 RevenueCat Purchases SDK와 호환",
      "StoreKit 2 및 Google Play 구매 검증",
      "App Store Server Notifications V2 및 Google Play Real-time Developer Notifications",
      "HMAC-SHA256으로 서명된 RevenueCat 형식의 웹훅",
      "MRR, 이탈, 체험 전환을 포함한 16가지 구독 차트",
      "오퍼링 대상 가격 실험과 변형별 결과",
      "MCP 서버, CLI, Claude 스킬",
    ],
  },
};
