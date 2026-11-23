// The RevenueCat pricing page in this language (see en.ts for the notes).
import type { PricingDict } from "./en";

export const pricingAr: PricingDict = {
  meta: {
    title: "تسعير RevenueCat: أين تذهب نسبة 1% فعلًا · openpurr",
    description:
      "يأخذ RevenueCat نسبة 1% من إيراداتك، والخوادم وراء تطبيقك لا تكلّف شيئًا يُذكر. اعرف أين يذهب الباقي: الرواتب والمبيعات ومستثمرو رأس المال المغامر.",
    ogImageAlt: "يأخذ RevenueCat نسبة 1% من إيراداتك، والخوادم لا تكلّف شيئًا يُذكر. إليك أين يذهب الباقي.",
  },
  hero: {
    crumb: "تسعير RevenueCat",
    headline: "أنت لا تدفع ثمن الخوادم.",
    /** The headline's second, highlighted sentence. {valuation} is "$500 million". */
    headlineAccent: "أنت تدفع ثمن شركة قيمتها {valuation}.",
    /** {threshold} is "$2,500". */
    lede: "يأخذ RevenueCat نسبة 1% من كل إيراداتك المتتبَّعة بمجرد أن تتجاوز {threshold} شهريًا، وتكبر الفاتورة كلما كبرت. الخوادم وراء تطبيقك لا تكلّف شيئًا يُذكر. والباقي يدفع ثمن الشركة نفسها: رواتبها، وفريق مبيعاتها، وعائد مستثمريها.",
    updated: "آخر تحديث: {date} · تقديرات من أرقام منشورة",
  },
  answer: {
    title: "تسعير RevenueCat في سطر واحد",
    /** HTML. {threshold} is "$2,500". */
    text: "مجاني إذا قلّت الإيرادات الشهرية المتتبَّعة عن {threshold}، ثم <strong>1% منها كلها</strong>. هذا ما يصل إليه المبلغ في سنة، بجانب تكلفة الخوادم للتطبيق نفسه:",
    colRevenue: "الإيرادات الشهرية",
    colFee: "RevenueCat سنويًا",
    colServers: "الخوادم سنويًا",
  },
  calc: {
    revenue: "الإيرادات الشهرية لتطبيقك",
    fee: "يأخذ RevenueCat",
    servers: "التكلفة الفعلية للخوادم",
    perYear: "سنويًا",
    stackLabel: "رسومك السنوية مقسّمة بين الخوادم وفرق RevenueCat",
    /** HTML. {servers} and {rest} are percentages. */
    stackNote: "الخوادم: {servers}. وكل ما تبقّى، أي {rest}، يدفع ثمن فرقهم:",
    /** {people} is a number, {salary} is like "$210K". */
    teamMeta: "نحو {people} شخصًا · الراتب المعتاد {salary}",
    ownersTitle: "نسبة 1% التي تدفعها تبني صفقة خروج لغيرك",
    /** {pct} is like "55%". */
    ownersInvestors: "مستثمرو رأس المال المغامر · نحو {pct}",
    ownersRest: "المؤسسون والموظفون",
    ownersBarLabel: "يملك مستثمرو رأس المال المغامر نحو {pct} من RevenueCat، بحسب تقديرنا",
    /** HTML. {funding} is "$100 million"; {vc} is an amount that moves with the slider. */
    ownersText:
      "ضخّ مستثمرو رأس المال المغامر نحو {funding} في RevenueCat عبر خمس جولات، وبحسب التقييمات المنشورة يملكون أكثر من نصف الشركة. لا يحتاجون إلى حصة من كل دفعة: كل رسم تدفعه يرفع قيمة الشركة التي يملكونها، ويقبضون حين تُباع. وبمنطق الملكية، نحو {vc} مما تدفعه كل سنة يبني عائدهم.",
    investorsLabel: "مستثمرو RevenueCat",
    /** HTML. {days} is a number, {infra} an amount; both move with the slider. */
    punch: "نسبة 1% التي تدفعها تشتري نحو {days} يوم عمل لمهندس في RevenueCat كل سنة. وتشغيل المهمة نفسها بنفسك يكلّف {infra}.",
    /** HTML. {keep} is an amount that moves with the slider. */
    keep: "واحتفظ بالباقي: {keep}.",
    ctaKeep: "احتفظ بنسبة 1% لنفسك ←",
    ctaGithub: "openpurr على GitHub",
  },
  teams: {
    eng: { name: "الهندسة", basis: "إعلان وظيفة مهندس SDK أول، 212 ألف دولار" },
    product: { name: "المنتج والتصميم والبيانات", basis: "إعلانات مدير منتج أول، 230 ألف دولار؛ عالم بيانات أول، 220 ألف دولار" },
    sales: { name: "المبيعات", basis: "إعلان رئيس المبيعات، 363 ألف دولار؛ مهندس مبيعات أول، 200 ألف دولار؛ خبير منتج، 133 ألف دولار" },
    growth: { name: "التسويق والنمو", basis: "إعلان رئيس نمو العملاء، 259 ألف دولار؛ مصمم تحسين معدل التحويل (CRO)، 205 آلاف دولار؛ تسويق المنتج، 168 ألف دولار" },
    support: { name: "نجاح العملاء والدعم", basis: "إعلان مهندس دعم المطورين، 118 ألف دولار" },
    community: { name: "علاقات المطورين والمجتمع", basis: "الوسيط العام للإعلانات، نحو 215 ألف دولار، مع خصم لمزيج من المستويات" },
    ops: { name: "العمليات والمالية والموارد البشرية", basis: "إعلان أخصائي المبيعات والعمليات، 167 ألف دولار؛ رئيس الموارد البشرية، 280 ألف دولار" },
    exec: { name: "الإدارة التنفيذية", basis: "أعلى من إعلان رئيس المبيعات (363 ألف دولار) لبعضهم، وأقل لآخرين" },
  },
  faq: {
    title: "أسئلة يطرحها الناس",
    /** Each answer is also the page's FAQ structured data. Amounts are filled in by the page. */
    items: {
      cost: {
        q: "كم يكلّف RevenueCat؟",
        /** {threshold} "$2,500"; {at10k} the yearly fee at $10,000 a month, {at100k} at $100,000 a month; {m10k} "$10,000", {m100k} "$100,000". */
        a: "خطة Pro من RevenueCat مجانية إذا قلّت الإيرادات الشهرية المتتبَّعة عن {threshold}. بعدها تكلّف 1% منها كلها، لا من الجزء الذي يزيد على {threshold} فقط: {at10k} سنويًا لتطبيق يحقق {m10k} شهريًا، و{at100k} سنويًا عند {m100k} شهريًا. ويمكن للحسابات الكبيرة التفاوض على أسعار Enterprise.",
      },
      pays: {
        q: "ماذا تموّل رسوم RevenueCat البالغة 1%؟",
        /** {servers} and {fee} are yearly amounts for an app making {m25k} ("$25,000") a month; {people} is a number. */
        a: "الشركة في الغالب. تشغيل الخوادم وراء تطبيق عادي يكلّف بضعة دولارات شهريًا: {servers} سنويًا لتطبيق يحقق {m25k} شهريًا، مقابل {fee} من الرسوم. والباقي يدفع ثمن فريق من نحو {people} شخصًا، يشمل الهندسة والمبيعات والتسويق والإدارة التنفيذية، ويبني القيمة لمستثمري الشركة.",
      },
      owns: {
        q: "من يملك RevenueCat؟",
        /** {funding} "$100 million"; {investors} the list of firms, already joined; {pct} like "55%". */
        a: "جمع RevenueCat نحو {funding} من مستثمري رأس المال المغامر في خمس جولات، منهم {investors}. وبحساب تقييمات الجولات المنشورة تراكميًا، يملك المستثمرون نحو {pct} من الشركة بحسب التقديرات. والباقي لمؤسسيها وموظفيها.",
      },
      worth: {
        q: "كم تبلغ قيمة RevenueCat؟",
        /** {valuation} "$500 million", {round} "$50 million", {revenue} "$30 million". */
        a: "أفادت التقارير بأن قيمة RevenueCat بلغت {valuation} حين جمع جولة Series C بقيمة {round} في 2025، وكانت إيراداته السنوية آنذاك نحو {revenue}. هذه أرقام من الصحافة والمحللين، لا إفصاحات من الشركة.",
      },
      alternative: {
        q: "هل يوجد بديل لـ RevenueCat بلا حصة من الإيرادات؟",
        a: "نعم. openpurr واجهة خلفية (backend) مجانية ومفتوحة المصدر ومستضافة ذاتيًا، تعمل مع Purchases SDK الرسمي من RevenueCat. تضبط رابط الوكيل (proxy URL) في SDK ليشير إلى خادمك، وتحتفظ بكود الشراء كما هو. ويعمل على الخطة المجانية من Cloudflare للتطبيقات الصغيرة، بلا حصة من الإيرادات ولا رسوم على كل عملية.",
      },
    },
  },
  more: {
    title: "نعم، يقدّمون أكثر من ذلك",
    text: "يبني RevenueCat أكثر من واجهة خلفية للمشتريات: شاشات الدفع (paywalls)، والتجارب، والتكاملات، وخط الدعم. إن كنت تستخدم كل ذلك، فربما يستحق المبلغ في نظرك. أما إن كان كل ما تحتاج إليه هو التحقق من المشتريات وإبقاء الاشتراكات محدّثة، فأنت تتنازل عن حصة من كل ما ستكسبه يومًا مقابل مهمة تعمل على خوادم ببضعة دولارات شهريًا.",
  },
  method: {
    title: "كيف نقدّر هذه الأرقام",
    /** HTML. Each item starts with a bold label. */
    fee: "<b>رسومك:</b> السعر المعلن لخطة Pro من RevenueCat، أي 1% من الإيرادات الشهرية المتتبَّعة بدءًا من {threshold}. ويمكن للحسابات الكبيرة التفاوض على أسعار أخرى.",
    /** HTML. {calculator} becomes a link labelled with `calculatorLink`. */
    servers:
      "<b>الخوادم:</b> تكلفة openpurr Lite على Cloudflare لتطبيق بهذه الإيرادات، بالنموذج نفسه الذي تعتمده {calculator}. تكاليف الاستضافة لدى RevenueCat غير منشورة؛ هذا ما تكلّفه المهمة حين تشغّلها بنفسك.",
    calculatorLink: "حاسبة التوفير",
    /** HTML. {used}, {low}, {high} are headcounts; {loaded} is "1.3". */
    teams:
      "<b>الفرق:</b> وظائف لا أشخاص. نفترض {used} شخصًا (تتراوح التقديرات المنشورة بين {low} و{high}) ونوزّعهم على الوظائف بأنفسنا. الرواتب مأخوذة من إعلانات الوظائف المنشورة لدى RevenueCat، وهي تذكر الأجر؛ وتكلفة كل فريق = عدد الأشخاص × الراتب × {loaded} للضرائب والمزايا والمعدات، دون الأسهم. ويُوزَّع الجزء من رسومك الذي لا يذهب إلى الخوادم بنسبة هذه التكاليف.",
    split:
      "<b>لماذا يفوق عدد العاملين في المبيعات والنمو عدد المهندسين:</b> في {date}، عرضت لوحة وظائف RevenueCat {open} وظيفة شاغرة: {gtm} في المبيعات والتسويق والنمو، و{eng} في الهندسة الأساسية. فالشركة في مرحلتها هذه تبني قدراتها في الوصول إلى السوق، وإعلان وظيفة Head of Sales الجديد هو الأعلى أجرًا على اللوحة.",
    /** HTML. {funding} "$100 million", {pct} like "55%", {revenue} "$30 million". */
    investors:
      "<b>المستثمرون:</b> خمس جولات من 2018 إلى 2025، بنحو {funding} إجمالًا. الملكية غير منشورة، لذا نحسبها تراكميًا من التقييمات المنشورة: يحصل مستثمرو كل جولة على المبلغ مقسومًا على التقييم بعد التمويل (post-money)، وتُخفَّف حصص كل من سبقهم بالنسبة نفسها. والنتيجة نحو {pct}. لا نحتسب مجمّعات خيارات الأسهم ولا حصة مسرّعة Y Combinator. حصتهم جزء من قيمة الشركة، لا بند في تكاليفها، ولهذا تظهر منفصلة. وعند جولة 2025، أفادت التقارير بأن إيرادات الشركة السنوية بلغت نحو {revenue}، قريبًا من نقطة التعادل.",
    colRound: "الجولة",
    colRaised: "المبلغ",
    colValuation: "التقييم",
    colLead: "بقيادة",
    notReported: "غير منشور",
    /** HTML. */
    affiliation: "<b>غير تابع:</b> openpurr غير تابع لـ RevenueCat. هذه تقديراتنا، لا أرقام RevenueCat.",
    assumptions: "الافتراضات، فريقًا فريقًا",
    colTeam: "الفريق",
    colPeople: "الأشخاص",
    colSalary: "الراتب",
    colCost: "التكلفة السنوية",
    colBasis: "مصدر الراتب",
  },
  sources: {
    title: "المصادر",
    /** One label per source, in this order. The links themselves are in English. */
    items: [
      "تسعير RevenueCat: 1% من الإيرادات الشهرية المتتبَّعة بدءًا من 2,500 دولار",
      "لوحة وظائف RevenueCat، مع نطاقات الأجور (Ashby)",
      "إعلانات سابقة لـ RevenueCat مع الأجور (Greenhouse)",
      "TechCrunch: يجمع RevenueCat مبلغ 50 مليون دولار، ليصل إجمالي تمويله إلى 100 مليون (مايو 2025)",
      "TechCrunch: جولة Series B بقيمة 40 مليون دولار بقيادة Continuity Fund من Y Combinator، بتقييم 300 مليون (2021)",
      "TechCrunch: جولة Series C بقيمة 12 مليون دولار بقيادة Adjacent (2024)",
      "SaaStr: جولة التمويل الأولي (seed) في 2018 بتقييم 7 ملايين دولار، والجولات التي تلتها",
      "Multiples.vc: إيرادات بنحو 30 مليون دولار وتقييم 500 مليون عند جولة 2025 (تقديرات)",
      "تقديرات عدد الموظفين: TipRanks (185)",
      "تقديرات عدد الموظفين: TrueUp (130)",
    ],
    /** HTML. {date} is the date; {issue} becomes a link labelled with `issueLink`. */
    checked: "تم التحقق في {date}. لاحظت معلومة قديمة؟ {issue}.",
    issueLink: "افتح issue",
  },
};
