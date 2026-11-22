<!-- translated-from: README.md sha256:51ff71c4d2f67d7f -->
<h1 align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset=".github/assets/openpurr-logo-dark.png">
    <img src=".github/assets/openpurr-logo.png" alt="openpurr" width="400">
  </picture>
</h1>

<!-- languages -->
<p align="center"><a href="README.md">English</a> · <a href="README.de.md">Deutsch</a> · <a href="README.es.md">Español</a> · <a href="README.fr.md">Français</a> · <a href="README.it.md">Italiano</a> · <a href="README.nl.md">Nederlands</a> · <a href="README.pl.md">Polski</a> · <a href="README.pt-BR.md">Português (Brasil)</a> · <a href="README.tr.md">Türkçe</a> · <a href="README.id.md">Bahasa Indonesia</a> · <a href="README.vi.md">Tiếng Việt</a> · <b>العربية</b> · <a href="README.hi.md">हिन्दी</a> · <a href="README.ja.md">日本語</a> · <a href="README.ko.md">한국어</a> · <a href="README.zh-CN.md">简体中文</a> · <a href="README.zh-TW.md">繁體中文</a></p>
<!-- /languages -->

واجهة خلفية (backend) بديلة لـ RevenueCat، مستضافة ذاتيًا ومفتوحة المصدر.

باستخدام حزم Purchases SDK مفتوحة المصدر من RevenueCat، وجّه `Purchases.proxyURL` في تطبيقك إلى خادمك الخاص. يتحقق openpurr من عمليات الشراء في App Store وGoogle Play، ويتتبّع الاستحقاقات (entitlements)، ويستقبل إشعارات المتاجر، ويرسل webhooks إلى واجهتك الخلفية، ويعرض مخططات لمقاييس الاشتراكات الأساسية. ويعمل على بنية تحتية تتحكم فيها.

openpurr مشروع مستقل، وهو غير تابع لشركة RevenueCat, Inc. ولا يحظى بدعمها.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset=".github/assets/openpurr-dashboard-demo-dark.webp">
  <img src=".github/assets/openpurr-dashboard-demo.webp" alt="مخططات لوحة تحكم openpurr Lite مع تلميحاتها: MRR، حركة MRR، الإيرادات، الاشتراكات النشطة، الإلغاء">
</picture>

## لمن هو

لمطوري التطبيقات الذين:

- **يريدون التحكم في بنيتهم التحتية لعمليات الشراء.** سجلات الشراء والاستحقاقات وبيانات اعتماد المتاجر محفوظة على خوادم تشغّلها بنفسك، في قاعدة بيانات يمكنك الاستعلام منها ونسخها احتياطيًا وتصديرها. لا توجد خدمة خارجية بين تطبيقك وعملائك.
- **لا يريدون التخلي عن نسبة من إيراداتهم.** لا يأخذ openpurr أي حصة من الإيرادات ولا رسومًا على كل عملية. صُمّم إصدار Lite ليعمل ضمن الخطة المجانية من Cloudflare، فيمكن لتطبيق صغير تشغيله دون أي تكلفة.
- **لا يريدون الاعتماد على خدمة تجارية.** الكود مفتوح المصدر: يمكنك قراءته وتعديله ونقله بين Cloudflare وسحابتك الخاصة.

وهو مناسب أيضًا إذا كنت تستخدم حزم SDK من RevenueCat وتريد الاحتفاظ بها. يعمل openpurr مع حزم SDK الرسمية دون أي تعديل، فيبدأ الانتقال بتغيير رابط URL واحد، لا بإعادة كتابة كود الشراء. لنقل عملائك الحاليين، راجع [الانتقال من RevenueCat](https://openpurr.org/ar/migrate-from-revenuecat/).

**قد لا يناسبك (بعد)** إذا كنت تحتاج إلى أدوات بناء شاشات الدفع (paywalls)، أو تكاملات مع أدوات تحليلات خارجية، أو عقد دعم. المنصات التجارية توفّر ذلك اليوم. راجع [خارطة الطريق](ROADMAP.md) (بالإنجليزية) لمعرفة ما هو قادم.

## ما الذي يقدّمه

- **عمليات الشراء:** يتحقق من معاملات StoreKit 2 وعمليات شراء Google Play، ويعيد `CustomerInfo` والاستحقاقات التي يتوقعها SDK.
- **إشعارات المتاجر:** يستقبل App Store Server Notifications V2 وGoogle Play Real-time Developer Notifications.
- **Webhooks:** يرسل إلى واجهتك الخلفية أحداثًا بصيغة RevenueCat، موقّعة بـ HMAC-SHA256، ويعيد المحاولة لمدة 72 ساعة تقريبًا.
- **المخططات:** 16 مخططًا في لوحة التحكم، يمكن تصفيتها حسب المشروع والتطبيق والمتجر والمنتج والبيئة، وتنزيلها بصيغة CSV:
  - **الإيرادات:** الإيرادات، والمبالغ المستردة، ومعدل الاسترداد، وعمليات الشراء غير الاشتراكية.
  - **الإيرادات المتكررة:** MRR، وARR، وحركة MRR.
  - **الاشتراكات:** الاشتراكات النشطة، والاشتراكات المدفوعة، وحركة الاشتراكات، وحالة الاشتراكات، ومعدل الإلغاء.
  - **الفترات التجريبية:** الفترات التجريبية النشطة، والفترات التجريبية الجديدة، وحركة الفترات التجريبية.
  - **العملاء:** العملاء الجدد.
- **المصادقة:** مفاتيح SDK والمفاتيح السرية، وتسجيل دخول المشغّلين (كلمة مرور مع رموز تطبيق مصادقة اختيارية؛ ودعم Cloudflare Access مخطط له)، والأدوار، وسجل تدقيق.
- **خادم MCP ومهارات Claude:** يمكن لمساعد ذكاء اصطناعي البحث عن العملاء، وشرح سبب امتلاك شخص ما لاستحقاق أو عدم امتلاكه، وإرشادك خطوة بخطوة لإعداد App Store وPlay Console.

**خارج النطاق حاليًا:** شاشات الدفع، وأحداث الإعلانات، وCustomer Center، والعملات الافتراضية، والفوترة عبر الويب، وAmazon، وتكاملات التحليلات الخارجية. أما تجارب الأسعار فمتوفرة: راجع [الدليل](docs/price-experiments.md) (بالإنجليزية).

## إصداران

| | Lite | Standard |
|---|---|---|
| اللغة | TypeScript | Go |
| يعمل على | Cloudflare Workers + D1 | حاويات + Postgres على GCP أو AWS |
| التكلفة | مصمّم ليعمل ضمن الخطة المجانية من Cloudflare | فاتورة سحابتك |
| مناسب لـ | التطبيقات المستقلة: خفيف ومنخفض تكلفة التشغيل | محافظ التطبيقات الأكبر (قريبًا) |

يجتاز الإصداران مجموعة اختبارات التوافق نفسها في `spec/`. يمكنك الانتقال من Lite إلى Standard دون إصدار تحديث للتطبيق، ما دام تطبيقك يشير إلى نطاق مخصص تملكه.

## ما تحتفظ به مقارنةً بـ RevenueCat

خطة Pro من RevenueCat مجانية إذا قلّت الإيرادات المتتبَّعة عن 2,500 دولار شهريًا، ثم تتقاضى 1% منها كلها. يعمل Lite على الخطة المجانية من Cloudflare، ثم على Workers Paid بدءًا من 5 دولارات شهريًا عندما يتجاوزها تطبيقك.

<a href="https://openpurr.org/ar/#savings">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset=".github/assets/openpurr-savings-dark.webp">
    <img src=".github/assets/openpurr-savings.webp" alt="حاسبة التوفير: مع ارتفاع الإيرادات الشهرية حتى 250,000 دولار ترتفع التكلفة الشهرية لـ RevenueCat بينما تبقى تكلفة openpurr Lite قريبة من الصفر">
  </picture>
</a>

| الإيرادات الشهرية | RevenueCat شهريًا | openpurr Lite شهريًا | التوفير السنوي |
|---|--:|--:|--:|
| ‏2,000 US$ | ‏0 US$ | ‏0 US$ | **‏0 US$** |
| ‏5,000 US$ | ‏50 US$ | ‏0 US$ | **‏600 US$** |
| ‏10,000 US$ | ‏100 US$ | ‏0 US$ | **‏1,200 US$** |
| ‏25,000 US$ | ‏250 US$ | ‏5 US$ | **‏2,940 US$** |
| ‏50,000 US$ | ‏500 US$ | ‏5 US$ | **‏5,939 US$** |
| ‏100,000 US$ | ‏1,000 US$ | ‏9 US$ | **‏11,896 US$** |
| ‏250,000 US$ | ‏2,500 US$ | ‏20 US$ | **‏29,764 US$** |

تقديرات، وقد تم التحقق من الأسعار في 21 نوفمبر 2026. تفترض نحو 1.50 دولار من الإيرادات الشهرية و10 طلبات SDK يوميًا لكل مستخدم نشط يوميًا، ما يجعل الانتقال إلى Workers Paid عند نحو ‏11,250 US$ شهريًا. [جرّب أرقامك](https://openpurr.org/ar/#savings).

## التوافق مع حزم SDK

يستخدم openpurr منذ اليوم الأول حزم SDK الرسمية دون أي تعديل (وكلها بترخيص MIT):

| SDK | كيفية توجيهه إلى openpurr |
|---|---|
| iOS | `Purchases.proxyURL = URL(string: "https://purchases.example.com")` |
| Android | `Purchases.proxyURL = URL("https://purchases.example.com")` |
| Flutter وReact Native | `Purchases.setProxyURL("https://purchases.example.com")` |

اضبط رابط الوكيل (proxy URL) قبل استدعاء `configure`. اترك التحقق من الاستحقاقات على إعداده الافتراضي (معطّل)، لأن الاستجابات الموقّعة تعتمد على مفتاح RevenueCat الخاص.

**ثغرة معروفة على Android:** يرسل SDK بيانات التشخيص وحركة شاشات الدفع والإعلانات مباشرة إلى ثلاثة خوادم تابعة لـ RevenueCat، حتى عند ضبط رابط الوكيل. يعطّل openpurr التشخيص عبر الإعدادات عن بُعد (remote config). لا تستخدم شاشات الدفع أو الإعلانات من RevenueCatUI على Android مع openpurr.

## البنية المخطط لها للمستودع

```
spec/       language-neutral contract: OpenAPI, JSON schemas, fixtures, conformance suite
lite/       Lite edition: lightweight, for indie apps on Cloudflare Workers (TypeScript)
standard/   Standard edition: for larger app portfolios on AWS or GCP (Go, coming soon)
cli/        `npx @openpurr/cli` (works with either edition)
skills/     Claude Code plugin
examples/   sample apps
infra/      Terraform/OpenTofu modules for GCP, AWS and DigitalOcean
```

## البدء

إصدار Lite عند 0.1.0، وهو أول إصدار له، لذا توقّع تغييرات قبل 1.0. لتجربته على حسابك الخاص في Cloudflare (الخطة المجانية كافية)، مع Node 22.12 أو أحدث:

```sh
git clone https://github.com/openpurr/openpurr && cd openpurr
npx pnpm install
cd lite && npx wrangler login
npx pnpm run setup      # database, both Workers, operator secret and your owner account
```

يمكن تشغيل الإعداد مجددًا بأمان إذا توقف في منتصفه. وينتهي برابط إلى لوحة التحكم، التي تفتح على إضافة تطبيقك الأول: معرّف الحزمة (bundle ID) واسم الحزمة (package name)، ثم المنتجات والاستحقاقات والعروض (offerings). يمكن لعملية نشر واحدة تشغيل عدة تطبيقات كمشاريع منفصلة، لكل منها عملاؤه. بعد ذلك:

- **افحص إعدادك:** شغّل `npx @openpurr/cli login`، ثم `npx @openpurr/cli doctor`. يخبرك بما ينقص وكيفية إصلاح كل عنصر.
- **احصل على تنبيهات الاستخدام:** أضف رمز Cloudflare API بصلاحية Account Analytics: Read بوصفه السر `CLOUDFLARE_ANALYTICS_TOKEN`، فتنبّهك لوحة التحكم قبل أن توقف الحدود اليومية للخطة المجانية الطلبات.
- **انسخ بياناتك احتياطيًا:** يصدّر الأمر `npx pnpm db:backup` قاعدة البيانات إلى ملف. كما تحتفظ D1 بسجل 7 أيام على الخطة المجانية (30 يومًا على Workers Paid).
- **انشر مع كل push:** انسخ المستودع (fork) وأضف بيانات Cloudflare الخاصة بك بوصفها أسرارًا للمستودع (repository secrets). يسردها الملف [`lite-deploy.yml`](.github/workflows/lite-deploy.yml).

هل تستخدم Claude Code؟ يرشدك [إضافة openpurr](plugin/) (بالإنجليزية) عبر الخطوات نفسها، إضافة إلى إعداد App Store Connect وPlay Console.

## المساهمة

راجع [CONTRIBUTING.md](CONTRIBUTING.md) (بالإنجليزية). أكثر ما يفيد الآن هو الملاحظات في issues: الافتراضات الخاطئة عن حزم SDK أو المتاجر، والحالات الحدّية الواقعية.

لأي أمر آخر، راسلنا على [hello@openpurr.org](mailto:hello@openpurr.org).

## سجل النجوم

<a href="https://www.star-history.com/?repos=openpurr%2Fopenpurr&type=timeline&legend=bottom-right">
 <picture>
   <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/chart?repos=openpurr/openpurr&type=date&theme=dark&legend=bottom-right" />
   <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/chart?repos=openpurr/openpurr&type=date&legend=bottom-right" />
   <img alt="مخطط سجل النجوم" src="https://api.star-history.com/chart?repos=openpurr/openpurr&type=date&legend=bottom-right" />
 </picture>
</a>

## الترخيص

[Apache License 2.0](LICENSE). حقوق النشر 2026 للمساهمين في openpurr.
