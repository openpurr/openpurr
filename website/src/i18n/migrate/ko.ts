// Korean copy of the migration page. Follows en.ts; see the notes there.
import type { MigrateDict } from "./en";

export const migrateKo: MigrateDict = {
  meta: {
    title: "RevenueCat에서 openpurr로 마이그레이션하는 방법",
    description:
      "오픈소스 RevenueCat 대안 openpurr로 마이그레이션하는 방법을 단계별로 안내합니다. Purchases SDK는 그대로 두고, 모든 구독자를 가져오고, 이용 권한도 유지하세요.",
    ogImageAlt:
      "구독자를 한 명도 잃지 않고 RevenueCat에서 openpurr로 이전: Purchases SDK는 그대로, 모든 고객을 가져오고, 이전 버전의 앱도 계속 작동합니다.",
  },
  hero: {
    crumb: "RevenueCat에서 마이그레이션",
    eyebrow: "마이그레이션 가이드",
    headline: "구독자를 한 명도 잃지 않고 RevenueCat에서 openpurr로 옮기세요",
    lede: "앱에서 이미 쓰고 있는 Purchases SDK는 그대로 둡니다. 기존 고객은 RevenueCat 내보내기에서 가져오고, 구매 내역 자체는 openpurr가 Apple과 Google에서 직접 가져옵니다. 사용자들이 업데이트하는 동안에도 이전 버전의 앱은 계속 작동합니다.",
    guide: "단계별 가이드 읽기 (영어)",
    steps: "단계 보기",
    updated: "{date} 업데이트",
  },
  summary: {
    title: "요약",
    items: [
      "openpurr는 셀프 호스팅 오픈소스 RevenueCat 대안입니다. 수정하지 않은 공식 RevenueCat Purchases SDK와 함께 작동합니다.",
      "앱에 추가하는 것은 한 줄(SDK의 프록시 URL)과 한 번만 실행하는 <code>syncPurchases</code> 호출입니다. 나머지 결제 코드는 그대로입니다.",
      "<code>openpurr import</code>는 RevenueCat 내보내기에서 기존 고객을 가져옵니다. 구매 내역 자체는 복사하지 않고 Apple과 Google에서 가져옵니다.",
      "App Store 앱은 RevenueCat의 Scheduled Data Export를 사용할 수 있습니다. Google Play는 구매 토큰이 들어 있는 유일한 내보내기인, RevenueCat Support가 제공하는 마이그레이션 내보내기가 필요합니다.",
      "대부분의 사용자가 앱을 업데이트할 때까지 두 백엔드가 모두 최신 상태로 유지되므로 이용이 끊기는 사람이 없습니다.",
      "Cloudflare 무료 플랜에서는 하루에 약 2,500명의 고객을 가져올 수 있습니다. Workers Paid에서는 대규모 가져오기도 몇 시간이면 끝납니다.",
    ],
  },
  how: {
    eyebrow: "작동 방식",
    title: "RevenueCat 마이그레이션의 작동 방식",
    lede: "openpurr는 RevenueCat에서 구매 기록을 복사하지 않습니다. 누가 어떤 구매를 소유하는지만 알면 됩니다. 그다음에는 앱이 구매를 전송할 때와 똑같이 스토어에 직접 확인합니다.",
    ways: [
      {
        title: "가져오기",
        body: "RevenueCat 내보내기에는 어떤 앱 사용자가 어떤 스토어 구매를 소유하는지 나와 있습니다. <code>openpurr import</code>는 구매마다 Apple과 Google에 확인하고, 스토어의 응답을 해당 사용자의 기록으로 저장합니다. 앱을 다시 열지 않는 사람까지 포함해 모든 고객을 한 번에 옮깁니다.",
      },
      {
        title: "앱 업데이트",
        body: "새 버전은 Purchases SDK가 openpurr를 가리키게 하고, <code>syncPurchases</code>로 각 고객의 구매 내역을 한 번 전송합니다. 이렇게 하면 내보내기에서 빠진 고객과 내보내기 이후에 구매한 고객도 놓치지 않습니다.",
      },
      {
        title: "당분간은 두 백엔드 모두",
        body: "이전 버전의 앱은 사용자가 업데이트할 때까지 RevenueCat과 계속 통신합니다. RevenueCat이 Apple의 알림을 openpurr로 전달하고, 두 번째 Pub/Sub 구독이 Google의 알림을 똑같이 전달하므로 두 백엔드가 모두 최신 상태로 유지됩니다.",
      },
    ],
  },
  app: {
    eyebrow: "앱에서",
    title: "앱에서 바뀌는 점",
    lede: "configure 전에 프록시 URL을 설정하고, 각 고객의 구매 내역을 한 번 전송하세요. Android, Flutter, React Native에서도 같은 두 가지 변경이면 됩니다. 플랫폼별 코드는 가이드에 있습니다.",
    codeLabel: "Swift 예제: 프록시 URL과 일회성 동기화",
    proxyComment: "configure() 전에: 대부분의 앱은 이 한 줄만 추가",
    syncComment: "설치당 한 번: 이 고객의 구매 내역을 openpurr로 전송",
  },
  import: {
    eyebrow: "가져오기",
    title: "RevenueCat에서 고객 가져오기",
    lede: "openpurr CLI는 RevenueCat의 열을 그대로 읽습니다. 앱 사용자 ID, App Store 거래 ID, Google Play 구매 토큰, 그리고 <code>$email</code> 같은 속성입니다.",
    codeLabel: "터미널: RevenueCat 내보내기 가져오기",
    dryRunComment: "처음 몇 행 확인: Apple과 Google에 묻고, 아무것도 쓰지 않음",
    importComment: "모두 가져오기. 언제든 멈추고, 다시 실행하면 이어서 진행",
    safeguards: [
      ["이용이 끊기는 사람 없음", "앱이 이미 고객의 구매로 전송한 내역은 그 고객의 것으로 남습니다. 가져오기가 이를 옮기지 않습니다."],
      ["중복 웹훅 없음", "가져온 구매는 새 구매가 아니므로 openpurr는 이에 대한 이벤트를 보내지 않습니다."],
      ["정확한 차트", "가져온 고객은 첫 구매 날짜를 기준으로 기록되며, 가져온 날의 신규 고객으로 집계되지 않습니다."],
      ["앱은 계속 작동", "Cloudflare 무료 플랜에서는 가져오기가 일일 한도의 90%에서 멈추고 다음 날 이어서 진행합니다."],
      ["중단과 재개", "진행 상황이 저장됩니다. 같은 행을 두 번 가져와도 바뀌는 것이 없으므로 더 최신 내보내기로 다시 실행할 수 있습니다."],
      ["먼저 시험해 보기", "드라이 런은 스토어에 확인한 뒤 어떤 일이 일어날지 보고하며, 아무것도 쓰지 않습니다."],
    ] as [string, string][],
  },
  steps: {
    eyebrow: "단계별 안내",
    title: "RevenueCat에서 마이그레이션하는 7단계",
    lede: "전환할 준비가 될 때까지 두 백엔드가 모두 계속 실행되므로, 이전 버전의 앱을 쓰는 고객도 이용 권한을 유지합니다.",
    items: [
      {
        title: "openpurr 설정",
        body: "내 Cloudflare 계정에 openpurr Lite를 배포하고, App Store와 Google Play API 접근 권한을 부여한 뒤, 상품, 엔타이틀먼트, 오퍼링을 같은 식별자로 다시 만드세요. RevenueCat의 공개 SDK 키를 그대로 써도 됩니다.",
      },
      {
        title: "두 백엔드 모두에 알림 전달",
        body: "openpurr를 RevenueCat의 Apple Server Notification Forwarding URL로 설정하고, Play 알림 토픽에 openpurr의 푸시 구독을 추가하세요.",
      },
      {
        title: "내보내기 받기",
        body: "App Store만 쓴다면 RevenueCat의 Scheduled Data Export에 필요한 정보가 모두 들어 있습니다. Google Play를 쓴다면 구매 토큰이 들어 있는 것은 마이그레이션 내보내기뿐이므로 RevenueCat Support에 요청하세요. 가이드에 그대로 복사해 쓸 수 있는 요청문이 있습니다.",
      },
      { title: "가져오기", body: "먼저 드라이 런을 한 뒤 <code>openpurr import</code>를 실행하세요. 개별 행의 문제는 보고서에 기록되며 가져오기를 멈추지 않습니다." },
      { title: "앱 업데이트 출시", body: "프록시 URL과 일회성 <code>syncPurchases</code>를 추가하세요. 가져오기가 끝난 뒤에 출시하세요." },
      {
        title: "확인",
        body: "<code>openpurr doctor</code>로 설정을 점검하세요. 알고 있는 고객을 조회하고, 활성 구독 수를 RevenueCat 차트와 비교해 보세요.",
      },
      {
        title: "전환 마무리",
        body: "대부분의 고객이 업데이트하면 Apple과 Google이 openpurr를 직접 가리키게 하고, openpurr의 웹훅을 켜고, RevenueCat의 웹훅을 끄세요.",
      },
    ],
    source: "출처:",
    sourceNotifications: "RevenueCat: Apple 서버 알림 (영어)",
    sourceExports: "RevenueCat: 데이터 내보내기 및 마이그레이션 (영어)",
    more: "모든 명령어와 설정은 전체 가이드에 있습니다 (영어) →",
  },
  moves: {
    eyebrow: "옮겨지는 것",
    title: "RevenueCat에서 옮겨지는 것과 옮겨지지 않는 것",
    rows: [
      ["구독과 구매 (갱신, 환불, 유예 기간, 만료 포함)", "예, Apple과 Google에서 가져옵니다"],
      ["누가 어떤 구매를 소유하는지", "예, RevenueCat 내보내기에서 가져옵니다"],
      ["앱 사용자 ID (익명 ID 포함)", "예, 그대로 유지됩니다"],
      ["고객 속성 ($email, $displayName, 직접 정의한 속성)", "예, Audience export에서 가져옵니다"],
      ["상품, 엔타이틀먼트, 오퍼링", "같은 식별자로 직접 다시 만듭니다"],
      ["전환 이전의 차트 기록", "일부만: 기록용으로 RevenueCat 차트 CSV를 보관하세요"],
      ["페이월, 실험, 연동, Customer Center", "아니요: openpurr에는 없습니다"],
    ] as [string, string][],
  },
  faq: {
    eyebrow: "FAQ",
    title: "RevenueCat 마이그레이션 FAQ",
    items: [
      {
        q: "결제 코드를 바꿔야 하나요?",
        a: "아니요. openpurr는 수정하지 않은 공식 RevenueCat Purchases SDK와 함께 작동합니다. 앱 업데이트에서는 configure 전에 프록시 URL을 설정하고, syncPurchases를 한 번 호출하는 코드만 추가합니다. getOfferings, purchase, restorePurchases, logIn 등은 그대로입니다.",
      },
      {
        q: "마이그레이션하려면 RevenueCat의 도움이 필요한가요?",
        a: "App Store 앱이라면 필요 없습니다. RevenueCat의 Scheduled Data Export에 openpurr가 필요로 하는 거래 ID가 들어 있습니다. Google Play라면 필요합니다. RevenueCat 문서에 따르면 Google이 요구하는 구매 토큰은 RevenueCat Support가 준비하는 마이그레이션 내보내기에만 들어 있습니다.",
      },
      {
        q: "앱을 업데이트하지 않는 고객은 어떻게 되나요?",
        a: "가져오기로 처리됩니다. 이 고객들의 구매 내역은 Apple과 Google에서 가져와 같은 앱 사용자 ID에 연결됩니다. 이전 버전의 앱은 RevenueCat과 통신하므로, 대부분의 사용자가 업데이트할 때까지 두 백엔드 모두에 알림이 전달되도록 유지합니다.",
      },
      {
        q: "가져오기에는 시간이 얼마나 걸리나요?",
        a: "고객 한 명당 데이터베이스 행 쓰기가 약 30번 발생합니다. Cloudflare 무료 플랜에서는 하루 약 2,500명이며, 가져오기는 일일 한도에 도달하면 스스로 멈췄다가 다음 날 다시 시작합니다. Workers Paid(월 $5)에서는 대규모 가져오기도 몇 시간이면 끝납니다.",
      },
      {
        q: "데이터가 RevenueCat에서 복사되나요?",
        a: "앱 사용자와 스토어 구매의 연결 정보, 그리고 가져오기를 선택한 경우의 속성만 복사됩니다. 구매 내역 자체는 Apple과 Google에서 직접 가져오므로, openpurr에는 갱신과 환불을 포함한 스토어의 현재 상태가 기록됩니다.",
      },
    ],
  },
  cta: {
    title: "전환할 준비가 되셨나요?",
    body: "가이드에서 모든 단계를 차례로 안내합니다. 내 환경에 맞지 않는 부분이 있다면 이슈를 등록해 주세요. 마이그레이션 사례가 다음에 만들 기능을 결정합니다.",
    guide: "가이드 읽기 (영어)",
    github: "GitHub의 openpurr",
    issue: "이슈 등록하기",
  },
};
