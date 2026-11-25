// The "Add in-app purchases" page in this language (see en.ts for the notes).
import type { StartDict } from "./en";

export const startHi: StartDict = {
  meta: {
    title: "App में in-app purchases और subscriptions मुफ़्त जोड़ें - openpurr",
    description:
      "नया app बना रहे हैं? आधिकारिक Purchases SDK और खुद चलाए जाने वाले open-source backend से in-app purchases और subscriptions जोड़ें। कभी कोई revenue share नहीं।",
    ogImageAlt: "नया app बना रहे हैं? बिना revenue share के शुरुआत करें। अपना 1% अपने पास रखें और अपने business में लगाएँ।",
  },
  hero: {
    crumb: "In-app purchases जोड़ें",
    eyebrow: "नए apps के लिए",
    headline: "नया app बना रहे हैं?",
    headlineAccent: "बिना revenue share के शुरुआत करें।",
    /** {threshold} is "$2,500". */
    lede: "ज़्यादातर purchase backends हर महीने {threshold} पार करते ही आपके revenue का 1% लेते हैं, और आप जितना बढ़ते हैं, bill भी उतना बढ़ता है। इससे बचना सबसे आसान पहली sale से पहले है। openpurr in-app purchases और subscriptions के लिए एक मुफ़्त, open-source backend है जिसे आप खुद चलाते हैं, और यह वही आधिकारिक SDK इस्तेमाल करता है जो बड़े platforms करते हैं।",
    ctaStart: "GitHub पर शुरू करें",
    ctaAi: "अपने AI assistant के लिए prompt copy करें",
  },
  growth: {
    title: "आपका 1%, पहले दिन से",
    text: "चुनिए कि तीन साल बाद आप अपने app को कहाँ देखते हैं। शून्य से लगातार growth मानकर, वहाँ तक पहुँचते-पहुँचते 1% revenue share कुल इतना बनेगा।",
    target: "तीन साल बाद मासिक revenue",
    /** Labels for the totals. */
    fee: "1% revenue share, 3 साल में",
    servers: "खुद चलाने पर, 3 साल में",
    after: "और उसके बाद, हर साल",
    /** The chart's accessible description. */
    chartLabel: "तीन साल में महीने-दर-महीने बढ़ता revenue share",
    /** HTML. {fee} and {servers} are amounts that move with the slider. */
    summary: "चौथे साल से पहले आप <b>{fee}</b> दे चुके होंगे, जबकि अपने servers पर ख़र्च सिर्फ़ <b>{servers}</b>। यह पैसा अपने पास रखें, और इसे अपने business में लगाएँ।",
  },
  invest: {
    title: "इसे अपने business में लगाएँ, और खुद पर",
    text: "अपने पास रखा एक साल का 1% क्या-क्या दिला सकता है:",
  },
  how: {
    title: "यह कैसे काम करता है",
    lede: "चार steps, और आप जो code लिखते हैं वह किसी भी RevenueCat tutorial जैसा ही है।",
    steps: [
      {
        title: "openpurr deploy करें",
        /** HTML. */
        text: "अपने Cloudflare account पर setup चलाएँ। छोटे apps के लिए Lite <b>free plan</b> में आ जाता है, और setup बीच में रुक जाए तो उसे दोबारा चलाना सुरक्षित है।",
      },
      {
        title: "अपना app और products जोड़ें",
        text: "Dashboard आपका पहला app जोड़ने से शुरू होता है: उसका bundle ID और package name, फिर products, entitlements और offerings।",
      },
      {
        title: "Purchases SDK जोड़ें",
        /** HTML. */
        text: "आधिकारिक RevenueCat Purchases SDK install करें, जो MIT license के तहत open source है, और configure करने से पहले <b>एक proxy URL</b> set करें।",
      },
      {
        title: "Ship करें",
        text: "Purchases Apple और Google के साथ validate होती हैं, renewals और refunds store notifications से आते हैं, और आपके backend को webhooks मिलते हैं। Claude Code इस्तेमाल करते हैं? openpurr plugin आपको App Store Connect और Play Console का setup step-by-step करवाता है।",
      },
    ],
    /** Above the setup commands. */
    setupLabel: "Setup, आपकी machine पर",
  },
  ai: {
    title: "अपने AI coding assistant से सेट करें",
    text: "अपने app का project Claude Code, Codex, Cursor, Grok या किसी भी coding agent में खोलें और यह prompt paste करें। यह openpurr deploy करता है, stores जोड़ता है और SDK जोड़ता है, और जिस भी step में आपके login की ज़रूरत हो, उससे पहले आपसे पूछता है।",
    copy: "Prompt copy करें",
    copied: "Copy हो गया",
    claudeTip: "Claude Code इस्तेमाल करते हैं? पहले openpurr plugin जोड़ें, जो हर step में मदद करता है:",
  },
  includes: {
    title: "आपको क्या मिलता है",
    yes: [
      "App Store और Google Play पर purchases और subscriptions",
      "Entitlements और offerings",
      "आपके backend को webhooks, signed और fail होने पर दोबारा भेजे गए",
      "16 charts: revenue, MRR, churn, trials और भी बहुत कुछ",
      "Price experiments",
      "आपका data आपके अपने database में",
    ],
    notYetTitle: "अभी नहीं",
    notYet: "Paywall builders, third-party analytics integrations, ad events, web billing और Amazon। अगर आपको ये पहले दिन से चाहिए, तो commercial platforms इन्हें आज ही देते हैं।",
  },
  lockin: {
    title: "किसी भी तरफ़ lock-in नहीं",
    text: "क्योंकि openpurr standard Purchases SDK इस्तेमाल करता है, आपका purchase code दोनों में से किसी भी backend के साथ काम करता है। अगर आपका app openpurr से आगे निकल जाए, या आपको वह चाहिए जो commercial platforms जोड़ते हैं, तो switch करना बस configuration बदलना और customers import करना है, code दोबारा लिखना नहीं।",
  },
  pricingLink: {
    text: "जानना चाहते हैं कि 1% देने पर वह कहाँ जाता है?",
    link: "RevenueCat की pricing का पूरा हिसाब देखें →",
  },
  faq: {
    title: "लोग ये सवाल पूछते हैं",
    /** Each answer is also the page's FAQ structured data. */
    items: {
      backend: {
        q: "क्या in-app purchases के लिए मुझे backend चाहिए?",
        a: "ज़रूरी नहीं: StoreKit और Google Play Billing device पर चलते हैं। लेकिन backend subscriptions को सही रखता है। यह Apple और Google के साथ purchases validate करता है, store notifications से renewals, cancellations और refunds पर नज़र रखता है, और आपके app और server को बताता है कि किसके पास access है। openpurr वही backend है, और इसे आप खुद चलाते हैं।",
      },
      cheapest: {
        q: "iOS या Android app में subscriptions जोड़ने का सबसे सस्ता तरीका क्या है?",
        /** {servers} a yearly amount, {m25k} "$25,000". */
        a: "Backend खुद चलाएँ। छोटे apps के लिए openpurr Lite Cloudflare के free plan में आ जाता है और मुफ़्त, open-source Purchases SDK के साथ काम करता है, इसलिए आप सिर्फ़ servers का ख़र्च देते हैं: हमारे model में {m25k} महीना कमाने वाले app के लिए लगभग {servers} सालाना, बिना किसी revenue share के।",
      },
      free: {
        q: "क्या openpurr सच में मुफ़्त है?",
        a: "हाँ। यह Apache 2.0 license के तहत open source है, बिना revenue share और बिना per-transaction fees के। आप अपने servers का ख़र्च देते हैं, और छोटे apps Cloudflare के free plan में आ जाते हैं।",
      },
      switch: {
        q: "क्या मैं बाद में RevenueCat पर switch कर सकता हूँ?",
        a: "हाँ। openpurr आधिकारिक RevenueCat Purchases SDK इस्तेमाल करता है, इसलिए आपके app का purchase code दोनों में से किसी भी backend के साथ काम करता है और stores में आपके products वैसे ही रहते हैं। Switch करना बस configuration बदलना और अपने customer records ले जाना है।",
      },
      missing: {
        q: "openpurr अभी क्या नहीं करता?",
        a: "Paywall builders, third-party analytics integrations, ad events, web billing और Amazon। Price experiments built-in हैं। अगर आपको बाक़ी सब पहले दिन से चाहिए, तो commercial platforms इसे आज ही देते हैं।",
      },
    },
  },
};
