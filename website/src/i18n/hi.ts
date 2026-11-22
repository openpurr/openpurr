// Hindi copy. Follows en.ts; see the notes there. Uses "आप" and everyday Hindi, with technical terms in English as Indian developers use them; sentences end with the danda.
import type { Dict } from "./en";

export const hi: Dict = {
  meta: {
    title: "openpurr: RevenueCat का विकल्प, self-hosted और open-source",
    description:
      "openpurr, RevenueCat का self-hosted और open-source विकल्प है। जो Purchases SDK आप पहले से इस्तेमाल करते हैं, उसे अपने server पर लगाएँ और कोई revenue share न दें।",
    ogImageAlt: "openpurr: RevenueCat का self-hosted, open-source विकल्प, साथ में इसका subscription charts वाला dashboard",
  },
  header: {
    home: "openpurr होम",
    nav: { features: "फ़ीचर", editions: "Editions", roadmap: "Roadmap", faq: "FAQ", migrate: "माइग्रेट करें" },
    language: "भाषा",
  },
  footer: {
    tagline: "Open-source purchase infrastructure, जिसे आप ख़ुद चलाते हैं।",
    roadmap: "Roadmap",
    contributing: "योगदान दें",
    sponsor: "Sponsor करें",
    contact: "संपर्क",
    privacy: "Privacy (अंग्रेज़ी में)",
    disclaimer:
      "openpurr एक स्वतंत्र project है। यह RevenueCat, Inc. से जुड़ा नहीं है और न ही RevenueCat, Inc. इसका समर्थन करती है। App Store, Apple Inc. का trademark है। Google Play, Google LLC का trademark है।",
    copyright: "Copyright {year} openpurr contributors.",
    cookieSettings: "Cookie settings",
  },
  consent: {
    label: "Cookie सहमति",
    text: "हम visits गिनने और यह देखने के लिए कि कौन-से pages काम आते हैं, Google Analytics cookies इस्तेमाल करना चाहेंगे। जब तक आप accept नहीं करते, कुछ भी set नहीं होता, और आप Cookie settings में जाकर कभी भी अपना फ़ैसला बदल सकते हैं।",
    privacy: "Privacy (अंग्रेज़ी में)",
    decline: "मना करें",
    accept: "Accept करें",
  },
  snippet: {
    tabs: "SDK platform",
    note: "बस एक line। वही SDK, वही purchase code।",
  },
  home: {
    hero: {
      /** HTML */
      title: '<span class="accent">RevenueCat का विकल्प</span>, <span class="nowrap">self-hosted</span> और open-source',
      lede: "अपना purchase infrastructure ख़ुद संभालें, अपने revenue का कोई हिस्सा न दें और किसी commercial service पर निर्भर न रहें। जो Purchases SDK आप पहले से इस्तेमाल करते हैं, वही रखें: सिर्फ़ एक URL बदलें, अपना purchase code नहीं।",
      star: "GitHub पर Star करें",
      how: "यह कैसे काम करता है",
      shotAlt:
        "openpurr Lite का dashboard, जिसमें 12 महीनों का MRR movement, active subscriptions, churn, नए ग्राहक, नए trials और active trials दिख रहे हैं",
    },
    why: {
      eyebrow: "यह किसके लिए है",
      title: "उन app developers के लिए जो इसे ख़ुद चलाना पसंद करते हैं",
      lede: "openpurr आधिकारिक, बिना बदलाव वाले SDKs के साथ काम करता है। Switch करने की शुरुआत एक URL बदलने से होती है, purchase code दोबारा लिखने से नहीं।",
      reasons: [
        {
          title: "आपका data, आपके servers",
          body: "Purchase records, entitlements और store credentials ऐसे database में रहते हैं जिसे आप ख़ुद चलाते हैं, query करते हैं, back up करते हैं और export करते हैं। आपके app और आपके ग्राहकों के बीच कोई बाहरी service नहीं होती।",
        },
        {
          title: "कोई revenue share नहीं",
          body: "Revenue का कोई प्रतिशत नहीं और हर transaction पर कोई fee नहीं। Lite edition को Cloudflare के free plan में चलने के लिए बनाया गया है, इसलिए एक छोटा app इसे मुफ़्त में चला सकता है।",
        },
        {
          title: "किसी vendor पर निर्भरता नहीं",
          body: "यह Apache 2.0 के तहत open source है। Code पढ़ें, उसमें बदलाव करें, और इसे Cloudflare और अपने cloud के बीच कहीं भी ले जाएँ।",
        },
      ],
    },
    how: {
      eyebrow: "यह कैसे काम करता है",
      title: "जहाँ पहले vendor था, वहाँ अब आपका server है",
      lede: "आपका app वही open-source Purchases SDK रखता है जिसके साथ वह पहले से ship होता है। SDK, openpurr से बात करता है। openpurr, stores से बात करता है, subscription की स्थिति संभालता है और आपके backend को बताता है कि क्या बदला।",
      flowLabel: "Request flow",
      app: "आपका app",
      sdkLicense: "आधिकारिक, बिना बदलाव के, MIT licensed",
      sdkPlatforms: "iOS, Android, Flutter या React Native",
      coreWhere: "Cloudflare Workers पर या आपके अपने cloud में",
      appStoreApi: "Server API और notifications",
      playApi: "Developer API और RTDN",
      backend: "आपका backend",
      backendHooks: "Signed webhooks",
      steps: [
        {
          title: "Deploy करें",
          /** HTML */
          body: "openpurr Lite को अपने Cloudflare account पर चलाएँ। Guided setup, <code>pnpm run setup</code>, database बनाता है, दोनों Workers deploy करता है और आपका owner account बनाता है।",
        },
        {
          title: "SDK को point करें",
          /** HTML */
          body: "<code>configure</code> से पहले proxy URL set करें। अपना custom domain इस्तेमाल करें, ताकि आप बाद में आसानी से shift कर सकें।",
        },
        {
          title: "Stores कनेक्ट करें",
          /** HTML */
          body: "अपने store credentials और notification URLs जोड़ें। Setup check, <code>openpurr doctor</code>, इन्हें verify करता है और बताता है कि जो कुछ छूटा है उसे कैसे ठीक करें।",
        },
      ],
    },
    features: {
      eyebrow: "यह क्या करता है",
      title: "Subscription backend, बिना उन extras के जिनका आप इस्तेमाल नहीं करते",
      items: [
        {
          title: "Purchases और store notifications",
          body: "StoreKit 2 transactions और Google Play purchases को validate करता है, वही CustomerInfo और entitlements लौटाता है जिनकी SDK को ज़रूरत होती है, और App Store व Google Play notifications से renewals, refunds और grace periods को up to date रखता है।",
        },
        {
          title: "Webhooks",
          body: "आपके backend को RevenueCat जैसे format में events भेजता है, जो HMAC-SHA256 से signed होते हैं और लगभग 72 घंटे तक retry किए जाते हैं।",
        },
        {
          title: "Charts",
          body: "16 charts: revenue, MRR और ARR, MRR और subscription movement, active और paid subscriptions, subscription status, churn, trials और trial conversion, नए ग्राहक, refunds और refund rate, और one-time purchases। App, store, product और environment के हिसाब से filter करें, revenue USD में convert होकर दिखता है।",
        },
        {
          title: "Price experiments",
          body: "आपके app पर नए ग्राहकों को अलग-अलग offerings दिखाएँ, फिर हर ग्राहक के हिसाब से conversion और revenue की तुलना करें, साथ ही देखें कि हर variant के control से बेहतर होने की कितनी संभावना है। App update की ज़रूरत नहीं।",
        },
        {
          title: "Auth और audit",
          body: "SDK keys और secret keys, optional authenticator codes के साथ operator sign-in, roles, access tokens और एक audit log।",
        },
        {
          title: "MCP server और Claude skills",
          body: "किसी AI assistant से पूछें कि किसी ग्राहक के पास entitlement क्यों है या क्यों नहीं, purchases खोजें, या App Store Connect और Play Console का setup step by step समझें।",
        },
      ],
    },
    editions: {
      eyebrow: "दो editions",
      title: "छोटे से शुरू करें, app update के बिना आगे बढ़ें",
      lede: "दोनों editions एक ही conformance suite पास करते हैं। अगर आपका app आपके अपने custom domain पर point करता है, तो Lite से Standard पर जाने के लिए नया app release नहीं चाहिए।",
      lite: {
        badge: "Indie apps के लिए",
        price: "$0",
        priceNote: "Cloudflare के free plan पर",
        items: ["Cloudflare Workers और D1 पर TypeScript", "हल्का और चलाने में सस्ता", "Free plan की limits तक पहुँचने से पहले usage alerts"],
      },
      standard: {
        badge: "जल्द आ रहा है",
        price: "आपका cloud bill",
        priceNote: "बस इतना ही",
        items: ["Containers में Go और Postgres", "GCP या AWS", "Apps के बड़े portfolios के लिए"],
      },
    },
    savings: {
      eyebrow: "लागत",
      title: "RevenueCat की तुलना में आप कितना बचाते हैं",
      lede: "RevenueCat का Pro plan हर महीने $2,500 से कम tracked revenue पर मुफ़्त है, उसके बाद पूरे revenue का 1% लेता है। Lite, Cloudflare के free plan पर चलता है, और जब आपका app उससे आगे बढ़ जाए तो $5 प्रति माह से शुरू होने वाले Workers Paid पर।",
      revenue: "मासिक revenue",
      rc: "RevenueCat",
      op: "openpurr Lite",
      saved: "हर साल की बचत",
      perMonth: "{amount} प्रति माह",
      free: "Cloudflare free plan",
      paid: "Cloudflare Workers Paid",
      chartLabel: "मासिक revenue के अनुसार मासिक लागत: RevenueCat की लागत revenue के साथ बढ़ती है, openpurr Lite की लगभग शून्य रहती है",
      gapLegend: "आपकी बचत",
      tableSummary: "दूसरे revenue स्तरों पर तुलना करें",
      colRevenue: "मासिक revenue",
      colRc: "RevenueCat, मासिक",
      colOp: "openpurr Lite, मासिक",
      colSaved: "हर साल की बचत",
      methodSummary: "हम इसका अनुमान कैसे लगाते हैं",
      method: [
        "RevenueCat: Pro plan की list price, $2,500 से मासिक tracked revenue का 1%। Tracked revenue सालाना plans और एक बार की खरीदारी को भुगतान वाले महीने में गिनता है, इसलिए यह MRR से ज़्यादा हो सकता है। बड़े accounts Enterprise pricing पर बातचीत कर सकते हैं।",
        "openpurr Lite: Workers और D1 के लिए Cloudflare की कीमतें। हम हर daily active user पर लगभग $1.50 मासिक revenue और रोज़ लगभग 10 SDK requests मानते हैं। इस हिसाब से free plan की रोज़ की 100,000 requests लगभग {paidFrom} मासिक revenue तक काफ़ी हैं, कुछ गुंजाइश के साथ। उससे ऊपर हम Workers Paid गिनते हैं: $5 प्रति माह, और 1 करोड़ से ऊपर हर 10 लाख requests पर $0.30।",
        "शामिल नहीं: इसे चलाने में लगने वाला आपका समय। Store की fees दोनों में एक जैसी हैं।",
        "कीमतें {date} को जाँची गईं। openpurr का RevenueCat से कोई संबंध नहीं है।",
      ],
    },
    fit: {
      eyebrow: "साफ़-साफ़ बात",
      title: "हो सकता है यह अभी आपके लिए न हो",
      lede: "अगर आपको paywall builders, third-party analytics integrations या support contract चाहिए, तो commercial platforms ये आज ही देते हैं।",
      outTitle: "फ़िलहाल scope से बाहर",
      tags: ["Paywalls", "Ad events", "Customer Center", "Virtual currencies", "Web billing", "Amazon", "Analytics integrations"],
    },
    roadmap: {
      eyebrow: "Roadmap",
      title: "आगे की दिशा",
      lede: "क्रम तय है, लेकिन कोई तारीख़ें नहीं हैं। अगर कोई चीज़ आपके लिए ज़रूरी है, तो issue में बताएँ।",
      status: { done: "पूरा", wip: "काम जारी", planned: "Planned", later: "आप तय करें" },
      /** In order: Lite, Standard, then the community phase. "{version}" is the latest release. */
      phases: [
        {
          phase: "Lite",
          items: [
            "Latest release: {version}",
            "Cloudflare के free plan के लिए बनाया गया",
            "App Store और Google Play",
            "Webhooks, dashboard और admin",
            "एक deployment में कई apps",
            "Price experiments",
            "MCP server, CLI और Claude skills",
            "अगला कदम: device testing, फिर 1.0",
          ],
        },
        {
          phase: "Standard",
          items: ["Containers में Go और Postgres", "पहले GCP, फिर AWS", "Lite वाला ही conformance suite", "App update के बिना Lite से shift करें"],
        },
        {
          phase: "Community के साथ मिलकर",
          items: ["Verified end-user identity", "बड़ी teams के लिए Standard extras", "Issues में आप जो भी माँगें"],
        },
      ],
      more: "पूरा roadmap पढ़ें (अंग्रेज़ी में) →",
    },
    cta: {
      title: "इसे बनाने में मदद करें",
      body: "अभी सबसे काम की मदद है feedback: SDKs या stores के बारे में ग़लत धारणाएँ, और renewals, refunds और grace periods के असली edge cases।",
      star: "GitHub पर Star करें",
      issue: "Issue खोलें",
      coffee: "हमें एक coffee पिलाएँ",
    },
  },
  faq: {
    eyebrow: "FAQ",
    title: "RevenueCat के विकल्प के रूप में openpurr",
    lede: "जब आप अपना subscription backend ख़ुद चलाते हैं, तो क्या बदलता है और क्या नहीं।",
    items: [
      {
        q: "openpurr क्या है?",
        a: "openpurr, RevenueCat का open-source और self-hosted विकल्प है। यह in-app purchases और subscriptions के लिए एक backend है, जो आधिकारिक RevenueCat Purchases SDK के साथ काम करता है। यह App Store और Google Play की purchases validate करता है, entitlements track करता है, store notifications receive करता है, आपके backend को webhooks भेजता है और आपके मुख्य subscription metrics के charts दिखाता है, और यह सब आपके अपने control वाले infrastructure पर होता है।",
      },
      {
        q: "openpurr, RevenueCat से कैसे अलग है?",
        a: "RevenueCat एक hosted commercial service है, जो free tier के बाद revenue का एक हिस्सा लेती है। openpurr ऐसा software है जिसे आप ख़ुद चलाते हैं: आपके purchase records, entitlements और store credentials आपके अपने database में रहते हैं, और कोई revenue share या per-transaction fee नहीं है। RevenueCat आज ज़्यादा features देता है, जैसे paywalls और analytics integrations। openpurr का फ़ोकस मुख्य subscription backend पर है।",
      },
      {
        q: "क्या RevenueCat से switch करने के लिए मुझे अपना purchase code दोबारा लिखना होगा?",
        a: "नहीं। openpurr आधिकारिक, बिना बदलाव वाले Purchases SDK के साथ काम करता है। configure call करने से पहले आप SDK का proxy URL अपने openpurr server पर set करते हैं, और आपका बाक़ी purchase code वैसा ही रहता है। इसे अपने custom domain पर point करें, ताकि बाद में आप app update के बिना server बदल सकें।",
      },
      {
        q: "मैं अपने मौजूदा ग्राहकों को RevenueCat से कैसे लाऊँ?",
        a: "उन्हें import करें। RevenueCat से migration export माँगें, फिर openpurr import हर ग्राहक की purchases Apple और Google से लाता है और उन्हें उन्हीं app user IDs को दे देता है। आपके app का नया version भी हर ग्राहक की purchases एक बार भेजता है, और जब तक लोग app update करते हैं, दोनों backends up to date रहते हैं, इसलिए किसी का access नहीं जाता।",
        link: "माइग्रेट कैसे करें",
      },
      {
        q: "क्या मैं Adapty से switch कर सकता हूँ?",
        a: "हाँ, एक app update के साथ। Adapty के SDK को किसी दूसरे server पर point नहीं किया जा सकता, इसलिए update उसकी जगह Purchases SDK लगा देता है, जिसके साथ openpurr काम करता है। आपके products stores में वैसे ही रहते हैं। openpurr आपके App Store ग्राहकों को Adapty के event export से import करता है, आपके app का नया version बाक़ी सभी ग्राहकों को पहली बार चलने पर ले आता है, और जब तक लोग app update करते हैं, दोनों backends up to date रहते हैं।",
        link: "Adapty guide पढ़ें",
        linkTo: "adapty",
      },
      {
        q: "openpurr किन platforms और stores को support करता है?",
        a: "यह iOS, Android, Flutter और React Native के लिए Purchases SDK को support करता है, और App Store और Google Play की purchases को। Amazon और web billing फ़िलहाल scope से बाहर हैं।",
      },
      {
        q: "openpurr की कीमत कितनी है?",
        a: "openpurr, Apache 2.0 license के तहत मुफ़्त और open source है। आप सिर्फ़ उस infrastructure के लिए पैसे देते हैं जिस पर यह चलता है। Lite edition को Cloudflare के free plan पर चलने के लिए बनाया गया है, इसलिए एक छोटा app इसे मुफ़्त में चला सकता है। Standard edition आपके अपने cloud में containers में चलता है, इसलिए इसकी लागत आपका cloud bill ही है।",
      },
      {
        q: "मेरा data कहाँ store होता है?",
        a: "आपके अपने database में। Lite edition आपके Cloudflare account में Cloudflare D1 इस्तेमाल करता है। Standard edition, GCP या AWS पर Postgres इस्तेमाल करता है। आप इसे query, back up और export कर सकते हैं, और आपके app और आपके ग्राहकों के बीच कोई बाहरी service नहीं होती।",
      },
      {
        q: "क्या openpurr, RevenueCat की तरह webhooks भेजता है?",
        a: "हाँ। openpurr आपके backend को RevenueCat जैसे format में events भेजता है, जो HMAC-SHA256 से signed होते हैं और लगभग 72 घंटे तक retry किए जाते हैं, इसलिए मौजूदा webhook handlers में बहुत कम या कोई बदलाव नहीं करना पड़ता।",
      },
      {
        q: "RevenueCat ऐसा क्या करता है जो openpurr नहीं करता?",
        a: "Paywalls, third-party analytics integrations, Customer Center, virtual currencies, web billing, Amazon, ad events और commercial support contract फ़िलहाल scope से बाहर हैं। Price experiments इसमें built in हैं। अगर आपको बाकी चीज़ें आज ही चाहिए, तो कोई commercial platform आपके लिए बेहतर रहेगा।",
      },
      {
        q: "क्या openpurr production के लिए तैयार है?",
        a: "अभी नहीं। openpurr अभी शुरुआती दौर में है: Lite edition पर काम चल रहा है और Standard edition बाद में आएगा। GitHub पर roadmap follow करें, और अगर कोई चीज़ आपके लिए ज़रूरी है तो issue खोलें।",
      },
      {
        q: "क्या openpurr, RevenueCat से जुड़ा है?",
        a: "नहीं। openpurr एक स्वतंत्र open-source project है, जो RevenueCat, Inc. से जुड़ा नहीं है और न ही RevenueCat, Inc. इसका समर्थन करती है। यह RevenueCat के आधिकारिक Purchases SDK के साथ काम करता है, जो MIT licensed है।",
      },
    ],
  },
  /** The SoftwareApplication structured data. */
  structured: {
    description:
      "RevenueCat का self-hosted, open-source विकल्प: App Store और Google Play की in-app purchases और subscriptions के लिए एक backend, जो आधिकारिक, बिना बदलाव वाले Purchases SDK के साथ काम करता है। यह purchases validate करता है, entitlements track करता है, store notifications receive करता है, webhooks भेजता है और subscription metrics के charts दिखाता है।",
    subCategory: "In-app purchase और subscription backend",
    features: [
      "iOS, Android, Flutter और React Native के लिए आधिकारिक RevenueCat Purchases SDK के साथ काम करता है",
      "StoreKit 2 और Google Play purchase validation",
      "App Store Server Notifications V2 और Google Play Real-time Developer Notifications",
      "HMAC-SHA256 से signed, RevenueCat जैसे format वाले webhooks",
      "16 subscription charts, जिनमें MRR, churn और trial conversion शामिल हैं",
      "Offerings पर price experiments, हर variant के results के साथ",
      "MCP server, CLI और Claude skills",
    ],
  },
};
