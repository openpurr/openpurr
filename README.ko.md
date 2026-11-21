<!-- translated-from: README.md sha256:2f5fb4fb0a81c338 -->
<h1 align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset=".github/assets/openpurr-logo-dark.png">
    <img src=".github/assets/openpurr-logo.png" alt="openpurr" width="400">
  </picture>
</h1>

<!-- languages -->
<p align="center"><a href="README.md">English</a> · <a href="README.de.md">Deutsch</a> · <a href="README.es.md">Español</a> · <a href="README.fr.md">Français</a> · <a href="README.it.md">Italiano</a> · <a href="README.nl.md">Nederlands</a> · <a href="README.pl.md">Polski</a> · <a href="README.pt-BR.md">Português (Brasil)</a> · <a href="README.tr.md">Türkçe</a> · <a href="README.id.md">Bahasa Indonesia</a> · <a href="README.vi.md">Tiếng Việt</a> · <a href="README.ar.md">العربية</a> · <a href="README.hi.md">हिन्दी</a> · <a href="README.ja.md">日本語</a> · <b>한국어</b> · <a href="README.zh-CN.md">简体中文</a> · <a href="README.zh-TW.md">繁體中文</a></p>
<!-- /languages -->

셀프 호스팅 오픈소스 RevenueCat 대안 백엔드입니다.

RevenueCat의 오픈소스 Purchases SDK를 그대로 사용하면서, 앱의 `Purchases.proxyURL`을 내 서버로 지정하세요. openpurr는 App Store와 Google Play 구매를 검증하고, 엔타이틀먼트를 추적하고, 스토어 알림을 수신하고, 백엔드로 웹훅을 보내고, 핵심 구독 지표를 차트로 보여 줍니다. 모든 것이 직접 통제하는 인프라에서 실행됩니다.

openpurr는 독립 프로젝트이며 RevenueCat, Inc.와 제휴하거나 그 보증을 받지 않았습니다.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset=".github/assets/openpurr-dashboard-dark.png">
  <img src=".github/assets/openpurr-dashboard.png" alt="openpurr Lite 대시보드. 12개월간의 MRR 변동, 활성 구독, 이탈, 신규 고객, 신규 체험, 활성 체험을 보여 줍니다">
</picture>

## 누구를 위한 것인가

다음과 같은 앱 개발자를 위한 프로젝트입니다.

- **결제 인프라를 직접 통제하고 싶은 분.** 구매 기록, 엔타이틀먼트, 스토어 자격 증명이 직접 운영하는 서버에, 조회하고 백업하고 내보낼 수 있는 데이터베이스에 저장됩니다. 앱과 고객 사이에 외부 서비스가 끼어들지 않습니다.
- **수익의 일부를 나누고 싶지 않은 분.** openpurr에는 수익 배분도, 거래당 수수료도 없습니다. Lite 에디션은 Cloudflare 무료 플랜에 맞게 설계되어 작은 앱이라면 비용 없이 운영할 수 있습니다.
- **상용 서비스에 의존하고 싶지 않은 분.** 오픈소스이므로 코드를 읽고, 고치고, Cloudflare와 내 클라우드 사이를 옮길 수 있습니다.

이미 RevenueCat SDK를 쓰고 있고 계속 쓰고 싶은 경우에도 잘 맞습니다. openpurr는 수정하지 않은 공식 SDK와 함께 작동하므로, 전환은 결제 코드를 다시 짜는 것이 아니라 URL 하나를 바꾸는 것에서 시작합니다. 기존 고객을 옮기려면 [RevenueCat에서 마이그레이션하기](https://openpurr.org/ko/migrate-from-revenuecat/)를 참고하세요.

**(아직은) 맞지 않을 수도 있습니다.** 페이월 빌더, A/B 실험, 서드파티 분석 연동, 지원 계약이 필요한 경우입니다. 지금은 상용 플랫폼이 이를 제공합니다. 앞으로의 계획은 [로드맵](ROADMAP.md)(영어)을 참고하세요.

## 주요 기능

- **구매:** StoreKit 2 거래와 Google Play 구매를 검증하고, SDK가 기대하는 `CustomerInfo`와 엔타이틀먼트를 반환합니다.
- **스토어 알림:** App Store Server Notifications V2와 Google Play Real-time Developer Notifications를 수신합니다.
- **웹훅:** RevenueCat 형식의 이벤트를 백엔드로 보냅니다. HMAC-SHA256으로 서명하고 약 72시간 동안 재시도합니다.
- **차트:** 활성 구독, MRR, 체험, 전환, 이탈을 보여 주는 작은 대시보드입니다.
- **인증:** SDK 키와 시크릿 키, 운영자 로그인(비밀번호와 선택적 인증 앱 코드, Cloudflare Access는 계획 중), 역할, 감사 로그를 제공합니다.
- **MCP 서버와 Claude 스킬:** AI 어시스턴트가 고객을 조회하고, 누군가에게 엔타이틀먼트가 있거나 없는 이유를 설명하고, App Store와 Play Console 설정을 안내합니다.

**현재 지원 범위 밖:** 페이월, 광고 이벤트, Customer Center, 가상 화폐, 웹 결제, Amazon, 서드파티 분석 연동. 가격 실험은 [로드맵](ROADMAP.md#later-)(영어)에 있습니다.

## 두 가지 에디션

| | Lite | Standard |
|---|---|---|
| 언어 | TypeScript | Go |
| 실행 환경 | Cloudflare Workers + D1 | GCP 또는 AWS의 컨테이너 + Postgres |
| 비용 | Cloudflare 무료 플랜에 맞게 설계 | 클라우드 요금 |
| 대상 | 인디 앱: 가볍고 운영 비용이 저렴함 | 더 많은 앱 포트폴리오 (출시 예정) |

두 에디션은 `spec/`에 있는 같은 적합성 테스트 스위트를 통과합니다. 앱이 직접 소유한 커스텀 도메인을 가리키고 있다면, 앱 업데이트를 출시하지 않고도 Lite에서 Standard로 옮길 수 있습니다.

## SDK 호환성

처음부터 수정하지 않은 공식 SDK를 사용합니다(모두 MIT 라이선스):

| SDK | openpurr에 연결하는 방법 |
|---|---|
| iOS | `Purchases.proxyURL = URL(string: "https://purchases.example.com")` |
| Android | `Purchases.proxyURL = URL("https://purchases.example.com")` |
| Flutter, React Native | `Purchases.setProxyURL("https://purchases.example.com")` |

`configure`를 호출하기 전에 프록시 URL을 설정하세요. 엔타이틀먼트 검증은 기본값(비활성화)으로 두세요. 서명된 응답은 RevenueCat 자체의 키에 의존하기 때문입니다.

**Android의 알려진 제약:** SDK는 프록시 URL을 설정해도 진단, 페이월, 광고 트래픽을 세 개의 RevenueCat 호스트로 직접 보냅니다. openpurr는 원격 설정으로 진단을 끕니다. Android에서 openpurr를 사용할 때는 RevenueCatUI 페이월이나 광고를 사용하지 마세요.

## 계획된 저장소 구조

```
spec/       language-neutral contract: OpenAPI, JSON schemas, fixtures, conformance suite
lite/       Lite edition: lightweight, for indie apps on Cloudflare Workers (TypeScript)
standard/   Standard edition: for larger app portfolios on AWS or GCP (Go, coming soon)
cli/        `npx @openpurr/cli` (works with either edition)
skills/     Claude Code plugin
examples/   sample apps
infra/      Terraform/OpenTofu modules for GCP, AWS and DigitalOcean
```

## 시작하기

Lite는 첫 릴리스인 0.1.0이므로 1.0 전까지 변경이 있을 수 있습니다. 내 Cloudflare 계정(무료 플랜으로 충분합니다)에서 사용해 보려면 Node 22.12 이상에서 다음을 실행하세요.

```sh
git clone https://github.com/openpurr/openpurr && cd openpurr
npx pnpm install
cd lite && npx wrangler login
npx pnpm run setup      # database, both Workers, operator secret and your owner account
```

설정이 중간에 멈춰도 안전하게 다시 실행할 수 있습니다. 마지막에 대시보드 링크가 표시되고, 대시보드는 첫 앱 추가 화면에서 열립니다. 번들 ID와 패키지 이름을 입력한 뒤 상품, 엔타이틀먼트, 오퍼링을 설정합니다. 하나의 배포에서 여러 앱을 각각 별도의 프로젝트로 운영할 수 있으며, 프로젝트마다 고객이 따로 관리됩니다. 그다음에는 다음을 할 수 있습니다.

- **설정 점검:** `npx @openpurr/cli login`을 실행한 뒤 `npx @openpurr/cli doctor`를 실행하세요. 빠진 항목과 각각의 해결 방법을 알려 줍니다.
- **사용량 알림 받기:** Account Analytics: Read 권한이 있는 Cloudflare API 토큰을 `CLOUDFLARE_ANALYTICS_TOKEN` 시크릿으로 추가하면, 무료 플랜의 일일 한도로 요청이 중단되기 전에 대시보드가 경고해 줍니다.
- **데이터 백업:** `npx pnpm db:backup`은 데이터베이스를 파일로 내보냅니다. D1은 무료 플랜에서도 7일간의 기록을 보관합니다(Workers Paid에서는 30일).
- **push할 때마다 배포:** 저장소를 포크하고 Cloudflare 정보를 저장소 시크릿으로 추가하세요. 필요한 항목은 [`lite-deploy.yml`](.github/workflows/lite-deploy.yml)에 나와 있습니다.

Claude Code를 사용하시나요? [openpurr 플러그인](plugin/)(영어)이 같은 단계와 함께 App Store Connect 및 Play Console 설정도 안내합니다.

## 기여하기

[CONTRIBUTING.md](CONTRIBUTING.md)(영어)를 참고하세요. 지금 가장 도움이 되는 것은 이슈로 남겨 주시는 피드백입니다. SDK나 스토어에 대한 잘못된 가정, 그리고 실제로 겪은 예외 상황을 알려 주세요.

## Star History

<a href="https://www.star-history.com/?repos=openpurr%2Fopenpurr&type=timeline&legend=bottom-right">
 <picture>
   <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/chart?repos=openpurr/openpurr&type=date&theme=dark&legend=bottom-right" />
   <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/chart?repos=openpurr/openpurr&type=date&legend=bottom-right" />
   <img alt="Star History 차트" src="https://api.star-history.com/chart?repos=openpurr/openpurr&type=date&legend=bottom-right" />
 </picture>
</a>

## 라이선스

[Apache License 2.0](LICENSE). Copyright 2026 openpurr 기여자.
