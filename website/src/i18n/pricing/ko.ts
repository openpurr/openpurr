// The RevenueCat pricing page in this language (see en.ts for the notes).
import type { PricingDict } from "./en";

export const pricingKo: PricingDict = {
  meta: {
    title: "RevenueCat 가격: 내 1%는 어디로 · openpurr",
    description:
      "RevenueCat은 매출의 1%를 가져갑니다. 서버 비용은 푼돈입니다. 나머지는 급여, 영업, 벤처 투자자에게 갑니다.",
    ogImageAlt: "RevenueCat은 매출의 1%를 가져가고, 서버 비용은 푼돈입니다. 나머지는 어디에 쓰일까요?",
  },
  hero: {
    crumb: "RevenueCat 가격",
    eyebrow: "내 1%가 가는 곳",
    headline: "서버 비용을 내는 게 아닙니다.",
    /** The headline's second, highlighted sentence. {valuation} is "$500 million". */
    headlineAccent: "기업가치 {valuation}짜리 회사에 돈을 대고 있습니다.",
    /** {threshold} is "$2,500". */
    lede: "RevenueCat은 월 추적 매출이 {threshold} 이상이 되면 그 전체의 1%를 가져가고, 매출이 늘 때마다 청구액도 커집니다. 앱을 돌리는 서버 비용은 푼돈입니다. 나머지는 회사 자체, 즉 급여와 영업팀, 그리고 투자자의 수익에 쓰입니다.",
    updated: "{date} 업데이트 · 공개 자료 기반 추정",
  },
  answer: {
    title: "RevenueCat 가격 한 줄 요약",
    /** HTML. {threshold} is "$2,500". */
    text: "월 추적 매출 {threshold} 미만은 무료, 그 이상이면 <strong>전체의 1%</strong>. 1년이면 얼마가 되는지, 같은 앱의 서버 비용과 나란히 놓았습니다:",
    colRevenue: "월 매출",
    colFee: "RevenueCat, 연간",
    colServers: "서버, 연간",
  },
  calc: {
    revenue: "내 앱의 월 매출",
    fee: "RevenueCat이 가져가는 돈",
    servers: "실제 서버 비용",
    perYear: "/년",
    stackLabel: "연간 수수료: 서버와 RevenueCat 팀별 몫",
    /** HTML. {servers} and {rest} are percentages. */
    stackNote: "서버: {servers}. 나머지 {rest}는 그들의 팀에 들어갑니다:",
    /** {people} is a number, {salary} is like "$210K". */
    teamMeta: "약 {people}명 · 일반적인 연봉 {salary}",
    swag: "청구서에는 이것도 있습니다. 팀에 나눠 준 빛나는 RevenueCat 스케이트보드, 그리고 멋져 보이려는 나머지 모든 노력. 그 비용도 당신의 1%가 냅니다.",
    swagPostAlt: "RevenueCat 직원의 X 게시물: “RevenueCat 스케이트보드가 어제 도착했어요! 무료 RevenueCat 스케이트보드를 받는 링크는 여기”라며 RevenueCat 채용 페이지로 연결",
    swagPhotoAlt: "빛나는 RevenueCat 스케이트보드",
    swagCaption: "{date} X에 게시. “직접 받기” 링크는 그들의 채용 페이지로 연결됩니다. {link}",
    swagLink: "게시물 보기",
    ownersTitle: "내 1%가 남의 엑시트를 만듭니다",
    /** {pct} is like "55%". */
    ownersInvestors: "벤처 투자자 · 약 {pct}",
    ownersRest: "창업자와 직원",
    ownersBarLabel: "벤처 투자자의 RevenueCat 지분은 약 {pct} (자체 추정)",
    /** HTML. {funding} is "$100 million"; {vc} is an amount that moves with the slider. */
    ownersText:
      "벤처 투자자들은 다섯 차례 라운드에 걸쳐 RevenueCat에 약 {funding} 규모를 투자했고, 보도된 기업가치로 따지면 회사의 절반 이상을 소유하고 있습니다. 결제 건마다 몫을 떼어 갈 필요도 없습니다. 당신이 내는 수수료 하나하나가 그들이 소유한 회사의 가치를 끌어올리고, 회사가 팔릴 때 그들이 회수합니다. 지분으로 따지면 당신이 매년 내는 돈 중 약 {vc} 정도가 그들의 수익을 쌓고 있습니다.",
    investorsLabel: "RevenueCat의 투자자",
    /** HTML. {days} is a number, {infra} an amount; both move with the slider. */
    punch: "당신의 1%로 사는 건 1년에 RevenueCat 엔지니어 약 {days}일 치의 일입니다. 같은 일을 직접 돌리는 데 드는 비용은 {infra}입니다.",
    /** HTML. {keep} is an amount that moves with the slider. */
    keep: "나머지 {keep}, 그대로 지키세요.",
    ctaKeep: "내 1% 지키기 →",
    ctaGithub: "GitHub에서 openpurr 보기",
  },
  teams: {
    eng: { name: "엔지니어링", basis: "시니어 SDK 엔지니어 채용 공고, $21.2만" },
    product: { name: "제품, 디자인, 데이터", basis: "시니어 프로덕트 매니저 채용 공고, $23만; 시니어 데이터 사이언티스트, $22만" },
    sales: { name: "영업", basis: "Head of Sales 채용 공고, $36.3만; 시니어 세일즈 엔지니어, $20만; 프로덕트 전문가, $13.3만" },
    growth: { name: "마케팅과 그로스", basis: "Head of Customer Growth 채용 공고, $25.9만; CRO 디자이너, $20.5만; 프로덕트 마케팅, $16.8만" },
    support: { name: "고객 성공과 지원", basis: "개발자 지원 엔지니어 채용 공고, $11.8만" },
    community: { name: "개발자 관계와 커뮤니티", basis: "전체 공고의 중간값(약 $21.5만)에서 직급 구성을 고려해 낮춤" },
    ops: { name: "운영, 재무, 인사", basis: "영업·운영 전문가 채용 공고, $16.7만; Head of People, $28만" },
    exec: { name: "경영진", basis: "Head of Sales 공고($36.3만)보다 높은 사람도, 낮은 사람도 있음" },
  },
  faq: {
    title: "자주 묻는 질문",
    /** Each answer is also the page's FAQ structured data. Amounts are filled in by the page. */
    items: {
      cost: {
        q: "RevenueCat 가격은 얼마인가요?",
        /** {threshold} "$2,500"; {at10k} the yearly fee at $10,000 a month, {at100k} at $100,000 a month; {m10k} "$10,000", {m100k} "$100,000". */
        a: "RevenueCat의 Pro 요금제는 월 추적 매출이 {threshold} 미만이면 무료입니다. 그 이상이면 {threshold} 초과분만이 아니라 전체 매출의 1%를 냅니다. 월 매출 {m10k}인 앱은 연 {at10k}, 월 매출 {m100k}인 앱은 연 {at100k}입니다. 대규모 계정은 Enterprise 가격을 협상할 수 있습니다.",
      },
      pays: {
        q: "RevenueCat의 1% 수수료는 어디에 쓰이나요?",
        /** {servers} and {fee} are yearly amounts for an app making {m25k} ("$25,000") a month; {people} is a number. */
        a: "대부분 회사 자체에 쓰입니다. 일반적인 앱의 서버 비용은 한 달에 몇 달러 수준입니다. 월 매출 {m25k}인 앱이라면 수수료는 연 {fee}인데, 서버 비용은 연 {servers}에 불과합니다. 나머지는 엔지니어링, 영업, 마케팅, 경영진을 포함한 약 {people}명 규모의 팀에 쓰이고, 회사 투자자들을 위한 가치를 쌓습니다.",
      },
      owns: {
        q: "RevenueCat의 주인은 누구인가요?",
        /** {funding} "$100 million"; {investors} the list of firms, already joined; {pct} like "55%". */
        a: "RevenueCat은 다섯 차례 라운드에서 {investors} 등 벤처 투자자로부터 약 {funding} 규모를 조달했습니다. 보도된 라운드별 기업가치로 누적 계산하면, 투자자 지분은 약 {pct}로 추정됩니다. 나머지는 창업자와 직원의 몫입니다.",
      },
      worth: {
        q: "RevenueCat의 기업가치는 얼마인가요?",
        /** {valuation} "$500 million", {round} "$50 million", {revenue} "$30 million". */
        a: "RevenueCat은 2025년 {round} 규모의 시리즈 C를 유치할 때 기업가치 {valuation}, 당시 연 매출 약 {revenue}로 보도되었습니다. 언론과 애널리스트의 수치이며, 회사가 공개한 수치는 아닙니다.",
      },
      alternative: {
        q: "수익 배분 없는 RevenueCat 대안이 있나요?",
        a: "있습니다. openpurr는 공식 RevenueCat Purchases SDK와 함께 작동하는 무료 오픈소스 셀프 호스팅 백엔드입니다. SDK의 프록시 URL을 내 서버로 바꾸기만 하면 결제 코드는 그대로 둘 수 있습니다. 작은 앱은 Cloudflare 무료 플랜에서 실행되며, 수익 배분도 거래당 수수료도 없습니다.",
      },
    },
  },
  more: {
    title: "네, 기능은 더 많습니다",
    text: "RevenueCat은 결제 백엔드 이상을 만듭니다. 페이월, 실험, 연동, 고객 지원까지요. 그 전부를 쓴다면 그만한 가치가 있을지도 모릅니다. 하지만 필요한 게 구매 검증과 구독 상태 유지뿐이라면, 한 달에 서버 몇 달러면 되는 일에 앞으로 벌 모든 매출의 일부를 내주고 있는 셈입니다.",
  },
  method: {
    title: "추정 방법",
    /** HTML. Each item starts with a bold label. */
    fee: "<b>수수료:</b> RevenueCat Pro 요금제의 정가로, {threshold}부터 월 추적 매출의 1%입니다. 대규모 계정은 다른 가격을 협상할 수 있습니다.",
    /** HTML. {calculator} becomes a link labelled with `calculatorLink`. */
    servers:
      "<b>서버:</b> 해당 매출 규모의 앱에서 openpurr Lite를 Cloudflare로 운영하는 비용으로, {calculator}와 같은 모델입니다. RevenueCat 자체의 호스팅 비용은 공개되어 있지 않습니다. 이 수치는 같은 일을 직접 운영할 때 드는 비용입니다.",
    calculatorLink: "절약액 계산기",
    /** HTML. {used}, {low}, {high} are headcounts; {loaded} is "1.3". */
    teams:
      "<b>팀:</b> 사람이 아니라 직무 기준입니다. 인원은 {used}명으로 가정하고(공개 추정치는 {low}~{high}명), 직무별 배분은 저희가 직접 했습니다. 연봉은 급여를 명시한 RevenueCat의 공개 채용 공고에서 가져왔습니다. 각 팀의 비용은 인원 × 연봉 × {loaded}(세금, 복리후생, 장비)이며, 지분 보상은 제외했습니다. 수수료 중 서버를 뺀 부분을 이 비용에 비례해 나눴습니다.",
    split:
      "<b>영업·성장 인력이 엔지니어링보다 많은 이유:</b> {date} 기준 RevenueCat 채용 페이지에는 총 {open}개의 채용 공고가 있었습니다. 영업, 마케팅, 그로스 분야 {gtm}개, 핵심 엔지니어링 분야 {eng}개입니다. 이 단계의 회사는 시장 진출(go-to-market) 조직을 키우는 중이며, 새로 올라온 Head of Sales 공고가 페이지에서 연봉이 가장 높은 공고입니다.",
    /** HTML. {funding} "$100 million", {pct} like "55%", {revenue} "$30 million". */
    investors:
      "<b>투자자:</b> 2018년부터 2025년까지 다섯 차례 라운드, 총 약 {funding}. 지분은 공개되지 않으므로 보도된 기업가치로 누적 계산했습니다. 각 라운드의 투자자는 투자액을 포스트머니 기업가치로 나눈 만큼의 지분을 받고, 그 이전의 모든 주주는 같은 비율만큼 희석됩니다. 그 결과가 약 {pct}입니다. 스톡옵션 풀과 Y Combinator의 액셀러레이터 지분은 포함하지 않았습니다. 투자자의 몫은 회사 가치에 대한 것이지 비용 항목이 아니므로 따로 표시했습니다. 2025년 라운드 당시 회사의 연 매출은 약 {revenue}로, 손익분기점에 가까웠다고 보도되었습니다.",
    colRound: "라운드",
    colRaised: "조달액",
    colValuation: "기업가치",
    colLead: "리드 투자자",
    notReported: "미공개",
    /** HTML. */
    affiliation: "<b>제휴 관계 없음:</b> openpurr는 RevenueCat과 관련이 없습니다. 이 수치는 저희의 추정치이며, RevenueCat의 수치가 아닙니다.",
    assumptions: "팀별 가정",
    colTeam: "팀",
    colPeople: "인원",
    colSalary: "연봉",
    colCost: "연간 비용",
    colBasis: "연봉 근거",
  },
  sources: {
    title: "출처",
    /** One label per source, in this order. The links themselves are in English. */
    items: [
      "RevenueCat 가격: $2,500부터 월 추적 매출의 1%",
      "RevenueCat 채용 페이지, 급여 범위 포함 (Ashby)",
      "급여가 명시된 이전 RevenueCat 채용 공고 (Greenhouse)",
      "TechCrunch: RevenueCat, $5,000만 유치로 누적 $1억 (2025년 5월)",
      "TechCrunch: Y Combinator Continuity Fund가 주도한 $4,000만 시리즈 B, 기업가치 $3억 (2021년)",
      "TechCrunch: Adjacent가 주도한 $1,200만 시리즈 C (2024년)",
      "SaaStr: 기업가치 $700만의 2018년 시드와 이후 라운드",
      "Multiples.vc: 2025년 라운드 당시 매출 약 $3,000만, 기업가치 $5억 (추정)",
      "인원 추정: TipRanks (185명)",
      "인원 추정: TrueUp (130명)",
    ],
    /** HTML. {date} is the date; {issue} becomes a link labelled with `issueLink`. */
    checked: "{date} 확인. 오래된 정보를 발견했나요? {issue}.",
    issueLink: "이슈를 열어 주세요",
  },
};
