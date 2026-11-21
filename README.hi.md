<!-- translated-from: README.md sha256:2f5fb4fb0a81c338 -->
<h1 align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset=".github/assets/openpurr-logo-dark.png">
    <img src=".github/assets/openpurr-logo.png" alt="openpurr" width="400">
  </picture>
</h1>

<!-- languages -->
<p align="center"><a href="README.md">English</a> · <a href="README.de.md">Deutsch</a> · <a href="README.es.md">Español</a> · <a href="README.fr.md">Français</a> · <a href="README.it.md">Italiano</a> · <a href="README.nl.md">Nederlands</a> · <a href="README.pl.md">Polski</a> · <a href="README.pt-BR.md">Português (Brasil)</a> · <a href="README.tr.md">Türkçe</a> · <a href="README.id.md">Bahasa Indonesia</a> · <a href="README.vi.md">Tiếng Việt</a> · <a href="README.ar.md">العربية</a> · <b>हिन्दी</b> · <a href="README.ja.md">日本語</a> · <a href="README.ko.md">한국어</a> · <a href="README.zh-CN.md">简体中文</a> · <a href="README.zh-TW.md">繁體中文</a></p>
<!-- /languages -->

RevenueCat का self-hosted, open-source विकल्प backend।

RevenueCat के open-source Purchases SDKs इस्तेमाल करते हुए, अपने app का `Purchases.proxyURL` अपने server पर point करें। openpurr, App Store और Google Play की purchases validate करता है, entitlements track करता है, store notifications receive करता है, आपके backend को webhooks भेजता है और आपके मुख्य subscription metrics के charts दिखाता है। यह आपके अपने control वाले infrastructure पर चलता है।

openpurr एक स्वतंत्र project है। यह RevenueCat, Inc. से जुड़ा नहीं है और न ही RevenueCat, Inc. इसका समर्थन करती है।

<picture>
  <source media="(prefers-color-scheme: dark)" srcset=".github/assets/openpurr-dashboard-dark.png">
  <img src=".github/assets/openpurr-dashboard.png" alt="openpurr Lite का dashboard, जिसमें 12 महीनों का MRR movement, active subscriptions, churn, नए ग्राहक, नए trials और active trials दिख रहे हैं">
</picture>

## यह किसके लिए है

ऐसे app developers के लिए जो:

- **अपना purchase infrastructure ख़ुद संभालना चाहते हैं।** आपके purchase records, entitlements और store credentials आपके अपने चलाए servers पर रहते हैं, ऐसे database में जिसे आप query, back up और export कर सकते हैं। आपके app और आपके ग्राहकों के बीच कोई बाहरी service नहीं होती।
- **अपने revenue का कोई प्रतिशत नहीं देना चाहते।** openpurr में कोई revenue share नहीं है और हर transaction पर कोई fee नहीं। Lite edition को Cloudflare के free plan में चलने के लिए बनाया गया है, इसलिए एक छोटा app इसे मुफ़्त में चला सकता है।
- **किसी commercial service पर निर्भर नहीं रहना चाहते।** यह open source है: आप code पढ़ सकते हैं, उसमें बदलाव कर सकते हैं, और इसे Cloudflare और अपने cloud के बीच कहीं भी ले जा सकते हैं।

अगर आप पहले से RevenueCat SDKs इस्तेमाल करते हैं और उन्हें रखना चाहते हैं, तब भी यह अच्छा विकल्प है। openpurr आधिकारिक, बिना बदलाव वाले SDKs के साथ काम करता है, इसलिए switch करने की शुरुआत एक URL बदलने से होती है, purchase code दोबारा लिखने से नहीं। अपने मौजूदा ग्राहकों को लाने के लिए [RevenueCat से माइग्रेट करना](https://openpurr.org/hi/migrate-from-revenuecat/) देखें।

**हो सकता है यह (अभी) आपके लिए न हो** अगर आपको paywall builders, A/B experiments, third-party analytics integrations या support contract चाहिए। Commercial platforms ये आज ही देते हैं। आगे क्या आ रहा है, इसके लिए [roadmap](ROADMAP.md) (अंग्रेज़ी में) देखें।

## यह क्या करता है

- **Purchases:** StoreKit 2 transactions और Google Play purchases को validate करता है, और वही `CustomerInfo` और entitlements लौटाता है जिनकी SDK को ज़रूरत होती है।
- **Store notifications:** App Store Server Notifications V2 और Google Play Real-time Developer Notifications receive करता है।
- **Webhooks:** आपके backend को RevenueCat जैसे format में events भेजता है, जो HMAC-SHA256 से signed होते हैं और लगभग 72 घंटे तक retry किए जाते हैं।
- **Charts:** dashboard में 16 charts, जिन्हें project, app, store, product और environment के हिसाब से filter किया जा सकता है और CSV में download किया जा सकता है:
  - **Revenue:** revenue, refunds, refund rate और non-subscription purchases।
  - **Recurring revenue:** MRR, ARR और MRR movement।
  - **Subscriptions:** active subscriptions, paid subscriptions, subscription movement, subscription status और churn।
  - **Trials:** active trials, नए trials और trial movement।
  - **Customers:** नए ग्राहक।
- **Auth:** SDK keys और secret keys, operator login (password, साथ में optional authenticator codes; Cloudflare Access planned है), roles और एक audit log।
- **MCP server और Claude skills:** कोई AI assistant ग्राहकों को खोज सकता है, समझा सकता है कि किसी के पास entitlement क्यों है या क्यों नहीं, और App Store और Play Console का setup step by step करवा सकता है।

**फ़िलहाल scope से बाहर:** paywalls, ad events, Customer Center, virtual currencies, web billing, Amazon और third-party analytics integrations। Price experiments [roadmap](ROADMAP.md#later-) (अंग्रेज़ी में) पर हैं।

## दो editions

| | Lite | Standard |
|---|---|---|
| भाषा | TypeScript | Go |
| कहाँ चलता है | Cloudflare Workers + D1 | GCP या AWS पर Containers + Postgres |
| लागत | Cloudflare के free plan में चलने के लिए बनाया गया | आपका cloud bill |
| किसके लिए | Indie apps: हल्का और चलाने में सस्ता | Apps के बड़े portfolios (जल्द आ रहा है) |

दोनों editions `spec/` में मौजूद एक ही conformance suite पास करते हैं। अगर आपका app आपके अपने custom domain पर point करता है, तो आप app update ship किए बिना Lite से Standard पर जा सकते हैं।

## SDK compatibility

पहले दिन से आधिकारिक, बिना बदलाव वाले SDKs इस्तेमाल होते हैं (सभी MIT licensed):

| SDK | इसे openpurr पर कैसे point करें |
|---|---|
| iOS | `Purchases.proxyURL = URL(string: "https://purchases.example.com")` |
| Android | `Purchases.proxyURL = URL("https://purchases.example.com")` |
| Flutter, React Native | `Purchases.setProxyURL("https://purchases.example.com")` |

`configure` call करने से पहले proxy URL set करें। Entitlement verification को उसके default (disabled) पर ही रहने दें, क्योंकि signed responses, RevenueCat की अपनी key पर निर्भर होते हैं।

**Android पर एक ज्ञात कमी:** proxy URL set होने पर भी SDK, diagnostics, paywall और ad traffic सीधे RevenueCat के तीन hosts पर भेजता है। openpurr, remote config के ज़रिए diagnostics बंद कर देता है। openpurr के साथ Android पर RevenueCatUI paywalls या ads इस्तेमाल न करें।

## Repo का planned layout

```
spec/       language-neutral contract: OpenAPI, JSON schemas, fixtures, conformance suite
lite/       Lite edition: lightweight, for indie apps on Cloudflare Workers (TypeScript)
standard/   Standard edition: for larger app portfolios on AWS or GCP (Go, coming soon)
cli/        `npx @openpurr/cli` (works with either edition)
skills/     Claude Code plugin
examples/   sample apps
infra/      Terraform/OpenTofu modules for GCP, AWS and DigitalOcean
```

## शुरुआत करें

Lite अभी 0.1.0 पर है, जो इसका पहला release है, इसलिए 1.0 से पहले बदलावों की उम्मीद रखें। इसे अपने Cloudflare account पर आज़माने के लिए (free plan काफ़ी है), Node 22.12 या उसके बाद के version के साथ:

```sh
git clone https://github.com/openpurr/openpurr && cd openpurr
npx pnpm install
cd lite && npx wrangler login
npx pnpm run setup      # database, both Workers, operator secret and your owner account
```

अगर setup बीच में रुक जाए, तो इसे दोबारा चलाना सुरक्षित है। आख़िर में यह dashboard का link देता है, जो आपका पहला app जोड़ने से शुरू होता है: उसका bundle ID और package name, फिर products, entitlements और offerings। एक deployment कई apps को अलग-अलग projects के रूप में चला सकता है, हर एक के अपने ग्राहकों के साथ। इसके बाद:

- **अपना setup जाँचें:** `npx @openpurr/cli login` चलाएँ, फिर `npx @openpurr/cli doctor`। यह बताता है कि क्या छूटा है और हर चीज़ को कैसे ठीक करें।
- **Usage alerts पाएँ:** Account Analytics: Read वाला एक Cloudflare API token, `CLOUDFLARE_ANALYTICS_TOKEN` secret के रूप में जोड़ें। फिर free plan की daily limits के requests रोकने से पहले dashboard आपको चेतावनी देता है।
- **अपने data का backup लें:** `npx pnpm db:backup` database को एक file में export करता है। D1 भी free plan पर 7 दिन की history रखता है (Workers Paid पर 30 दिन)।
- **हर push पर deploy करें:** repo को fork करें और अपनी Cloudflare details, repository secrets के रूप में जोड़ें। [`lite-deploy.yml`](.github/workflows/lite-deploy.yml) में इनकी सूची है।

Claude Code इस्तेमाल करते हैं? [openpurr plugin](plugin/) (अंग्रेज़ी में) यही steps करवाता है, साथ में App Store Connect और Play Console का setup भी।

## योगदान

[CONTRIBUTING.md](CONTRIBUTING.md) (अंग्रेज़ी में) देखें। अभी सबसे काम की मदद है issues में feedback: SDKs या stores के बारे में ग़लत धारणाएँ, और असली दुनिया के edge cases।

किसी और बात के लिए [hello@openpurr.org](mailto:hello@openpurr.org) पर ईमेल करें।

## Star History

<a href="https://www.star-history.com/?repos=openpurr%2Fopenpurr&type=timeline&legend=bottom-right">
 <picture>
   <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/chart?repos=openpurr/openpurr&type=date&theme=dark&legend=bottom-right" />
   <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/chart?repos=openpurr/openpurr&type=date&legend=bottom-right" />
   <img alt="Star History chart" src="https://api.star-history.com/chart?repos=openpurr/openpurr&type=date&legend=bottom-right" />
 </picture>
</a>

## License

[Apache License 2.0](LICENSE)। Copyright 2026 openpurr contributors.
