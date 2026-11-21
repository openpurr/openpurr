// Hindi copy of the migration page. Follows en.ts; see the notes there.
import type { MigrateDict } from "./en";

export const migrateHi: MigrateDict = {
  meta: {
    title: "RevenueCat से openpurr पर माइग्रेट कैसे करें, step by step",
    description:
      "अपना app RevenueCat से openpurr पर ले जाएँ, जो RevenueCat का open-source विकल्प है: Purchases SDK वही रखें, हर subscriber import करें और उनका access बना रहे।",
    ogImageAlt:
      "बिना कोई subscriber खोए RevenueCat से openpurr पर जाएँ: Purchases SDK वही रखें, हर ग्राहक को import करें, और पुराने app versions चलते रहें।",
  },
  hero: {
    crumb: "RevenueCat से माइग्रेट करें",
    eyebrow: "Migration guide",
    headline: "बिना कोई subscriber खोए RevenueCat से openpurr पर जाएँ",
    lede: "आपका app जो Purchases SDK पहले से इस्तेमाल करता है, वही रखें। अपने मौजूदा ग्राहकों को RevenueCat के export से import करें: openpurr हर purchase Apple और Google से ख़ुद लाता है। जब तक लोग app update करते हैं, पुराने app versions चलते रहते हैं।",
    guide: "Step-by-step guide पढ़ें (अंग्रेज़ी में)",
    steps: "Steps देखें",
    updated: "अपडेट: {date}",
  },
  summary: {
    title: "संक्षेप में",
    items: [
      "openpurr, RevenueCat का self-hosted, open-source विकल्प है। यह आधिकारिक, बिना बदलाव वाले RevenueCat Purchases SDK के साथ काम करता है।",
      "आपका app एक line (SDK का proxy URL) और एक बार का <code>syncPurchases</code> call जोड़ता है। बाक़ी purchase code वैसा ही रहता है।",
      "<code>openpurr import</code> मौजूदा ग्राहकों को RevenueCat के export से लाता है। Purchases ख़ुद Apple और Google से लाई जाती हैं, copy नहीं की जातीं।",
      "App Store apps, RevenueCat का Scheduled Data Export इस्तेमाल कर सकते हैं। Google Play के लिए RevenueCat Support से migration export चाहिए, क्योंकि सिर्फ़ उसी में purchase tokens होते हैं।",
      "जब तक ज़्यादातर लोग app update नहीं कर लेते, दोनों backends up to date रहते हैं, इसलिए किसी का access नहीं जाता।",
      "Cloudflare के free plan पर import रोज़ लगभग 2,500 ग्राहक handle करता है। Workers Paid पर बड़े import में कुछ घंटे लगते हैं।",
    ],
  },
  how: {
    eyebrow: "यह कैसे काम करता है",
    title: "RevenueCat migration कैसे काम करता है",
    lede: "openpurr, RevenueCat से purchase records copy नहीं करता। उसे बस यह जानना होता है कि कौन-सी purchase किसकी है, फिर वह stores से पूछता है, ठीक वैसे ही जैसे तब करता है जब आपका app कोई purchase भेजता है।",
    ways: [
      {
        title: "Import",
        body: "RevenueCat का export बताता है कि कौन-सी store purchase किस app user की है। <code>openpurr import</code> हर purchase के बारे में Apple और Google से पूछता है और store का जवाब उस user के लिए record करता है। यह सबको एक साथ ले आता है, उन लोगों को भी जो app दोबारा कभी नहीं खोलेंगे।",
      },
      {
        title: "App update",
        body: "नया version, Purchases SDK को openpurr पर point करता है और <code>syncPurchases</code> से हर ग्राहक की purchases एक बार भेजता है। इससे वे लोग भी आ जाते हैं जो export में छूट गए, और वे भी जिन्होंने export बनने के बाद ख़रीदा।",
      },
      {
        title: "कुछ समय तक दोनों backends",
        body: "पुराने app versions तब तक RevenueCat से बात करते रहते हैं जब तक लोग update नहीं करते। RevenueCat, Apple के notifications openpurr को forward करता है, और एक दूसरा Pub/Sub subscription Google के लिए यही करता है, इसलिए दोनों up to date रहते हैं।",
      },
    ],
  },
  app: {
    eyebrow: "आपके app में",
    title: "आपके app में क्या बदलता है",
    lede: "configure से पहले proxy URL set करें, और हर ग्राहक की purchases एक बार भेजें। यही दो बदलाव Android, Flutter और React Native पर भी काम करते हैं; guide में हर एक का code है।",
    codeLabel: "Swift उदाहरण: proxy URL और एक बार का sync",
    proxyComment: "configure() से पहले: ज़्यादातर apps बस यही line जोड़ते हैं",
    syncComment: "हर install पर एक बार: इस ग्राहक की purchases openpurr को भेजें",
  },
  import: {
    eyebrow: "Import",
    title: "RevenueCat से ग्राहकों को import करना",
    lede: "openpurr CLI, RevenueCat के columns को जैसे हैं वैसे ही पढ़ता है: app user IDs, App Store transaction IDs, Google Play purchase tokens, और <code>$email</code> जैसे attributes।",
    codeLabel: "Terminal: RevenueCat का export import करना",
    dryRunComment: "पहली rows जाँचें: Apple और Google से पूछता है, कुछ नहीं लिखता",
    importComment: "सबको import करें। कभी भी रोकें; आगे बढ़ाने के लिए फिर चलाएँ।",
    safeguards: [
      ["किसी का access नहीं जाता", "जो purchase app किसी ग्राहक के लिए पहले ही भेज चुका है, वह उसी की रहती है; import उसे कभी नहीं हटाता।"],
      ["कोई duplicate webhooks नहीं", "Import की गई purchases नई नहीं हैं, इसलिए openpurr उनके लिए कोई events नहीं भेजता।"],
      ["सही charts", "Import किए गए ग्राहकों की तारीख़ उनकी पहली purchase से गिनी जाती है, उन्हें import वाले दिन नए ग्राहक नहीं गिना जाता।"],
      ["आपका app चलता रहता है", "Cloudflare के free plan पर import, daily limit के 90% पर रुक जाता है और अगले दिन फिर शुरू होता है।"],
      ["रोकें और फिर शुरू करें", "Progress save रहती है। किसी row को दो बार import करने से कुछ नहीं बदलता, इसलिए नया export फिर से चलाया जा सकता है।"],
      ["पहले आज़माएँ", "Dry run, stores से पूछता है और बताता है कि क्या होगा, बिना कुछ लिखे।"],
    ] as [string, string][],
  },
  steps: {
    eyebrow: "Step by step",
    title: "सात steps में RevenueCat से माइग्रेट कैसे करें",
    lede: "जब तक आप switch करने के लिए तैयार नहीं होते, दोनों backends चलते रहते हैं, इसलिए पुराने app versions वाले ग्राहकों का access बना रहता है।",
    items: [
      {
        title: "openpurr set up करें",
        body: "openpurr Lite को अपने Cloudflare account पर deploy करें, उसे App Store और Google Play API access दें, और अपने products, entitlements और offerings उन्हीं identifiers के साथ दोबारा बनाएँ। आप चाहें तो अपनी RevenueCat public SDK keys भी रख सकते हैं।",
      },
      {
        title: "दोनों backends को जानकारी मिलती रहे",
        body: "openpurr को RevenueCat के Apple Server Notification Forwarding URL के रूप में set करें, और openpurr का push subscription अपने Play notifications topic में जोड़ें।",
      },
      {
        title: "अपना export लें",
        body: "सिर्फ़ App Store: RevenueCat के Scheduled Data Export में ज़रूरी सब कुछ है। Google Play के साथ, RevenueCat Support से migration export माँगें, क्योंकि सिर्फ़ उसी में purchase tokens होते हैं। Guide में एक request है जिसे आप copy कर सकते हैं।",
      },
      { title: "Import करें", body: "<code>openpurr import</code> चलाएँ, पहले एक dry run के साथ। अलग-अलग rows की समस्याएँ एक report में जाती हैं और import नहीं रोकतीं।" },
      { title: "App update ship करें", body: "Proxy URL और एक बार का <code>syncPurchases</code> जोड़ें। Import पूरा होने के बाद इसे release करें।" },
      {
        title: "जाँचें",
        body: "<code>openpurr doctor</code> setup जाँचता है। जिन ग्राहकों को आप जानते हैं उन्हें खोजें, और active subscriptions की तुलना RevenueCat के charts से करें।",
      },
      {
        title: "Switch पूरा करें",
        body: "जब ज़्यादातर ग्राहक update कर लें, तो Apple और Google को सीधे openpurr पर point करें, openpurr के webhooks चालू करें और RevenueCat के बंद करें।",
      },
    ],
    source: "Source:",
    sourceNotifications: "RevenueCat: Apple server notifications (अंग्रेज़ी में)",
    sourceExports: "RevenueCat: data export करना या migrate करना (अंग्रेज़ी में)",
    more: "हर command और setting पूरी guide में है (अंग्रेज़ी में) →",
  },
  moves: {
    eyebrow: "क्या आता है",
    title: "RevenueCat से क्या आता है, और क्या नहीं",
    rows: [
      ["Subscriptions और purchases, renewals, refunds, grace periods और expiry के साथ", "हाँ, Apple और Google से लाई जाती हैं"],
      ["कौन-सी purchase किसकी है", "हाँ, RevenueCat के export से"],
      ["App user IDs, anonymous IDs समेत", "हाँ, बिना बदलाव के"],
      ["Customer attributes ($email, $displayName और आपके अपने)", "हाँ, Audience export से"],
      ["Products, entitlements और offerings", "आप इन्हें उन्हीं identifiers के साथ दोबारा बनाते हैं"],
      ["Switch से पहले की chart history", "आंशिक रूप से: अपने records के लिए RevenueCat के chart CSVs रख लें"],
      ["Paywalls, experiments, integrations, Customer Center", "नहीं: ये openpurr में नहीं हैं"],
    ] as [string, string][],
  },
  faq: {
    eyebrow: "FAQ",
    title: "RevenueCat migration FAQ",
    items: [
      {
        q: "क्या मुझे अपना purchase code बदलना होगा?",
        a: "नहीं। openpurr आधिकारिक, बिना बदलाव वाले RevenueCat Purchases SDK के साथ काम करता है। App update में configure से पहले proxy URL और एक बार का syncPurchases call जुड़ता है। getOfferings, purchase, restorePurchases, logIn और बाक़ी सब वैसे ही रहते हैं।",
      },
      {
        q: "क्या माइग्रेट करने के लिए मुझे RevenueCat की मदद चाहिए?",
        a: "App Store apps के लिए नहीं: RevenueCat के Scheduled Data Export में वे transaction IDs होते हैं जिनकी openpurr को ज़रूरत है। Google Play के लिए हाँ: RevenueCat के documentation के अनुसार, Google को जिन purchase tokens की ज़रूरत होती है, वे सिर्फ़ RevenueCat Support के तैयार किए migration export में होते हैं।",
      },
      {
        q: "उन ग्राहकों का क्या जो कभी app update नहीं करते?",
        a: "Import उन्हें cover करता है: उनकी purchases Apple और Google से लाकर उन्हीं app user IDs को दी जाती हैं। जब तक वे पुराने app version पर हैं, वह version RevenueCat से बात करता है, इसीलिए ज़्यादातर लोगों के update करने तक दोनों backends को जानकारी मिलती रहती है।",
      },
      {
        q: "Import में कितना समय लगता है?",
        a: "हर ग्राहक के लिए database में लगभग 30 row writes होते हैं। Cloudflare के free plan पर इसका मतलब है रोज़ लगभग 2,500 ग्राहक, और import daily limit पर अपने आप रुक जाता है और अगले दिन फिर शुरू होता है। Workers Paid ($5 प्रति माह) पर बड़े import में कुछ घंटे लगते हैं।",
      },
      {
        q: "क्या मेरा data RevenueCat से copy होता है?",
        a: "सिर्फ़ app users और store purchases की mapping, और अगर आप import करें तो attributes। Purchases ख़ुद सीधे Apple और Google से आती हैं, इसलिए openpurr stores की मौजूदा सही स्थिति record करता है, renewals और refunds समेत।",
      },
    ],
  },
  cta: {
    title: "Switch करने के लिए तैयार हैं?",
    body: "Guide हर step समझाती है। अगर आपके setup में कुछ फ़िट नहीं बैठता, तो issue खोलें: migrations से तय होता है कि आगे क्या बनेगा।",
    guide: "Guide पढ़ें (अंग्रेज़ी में)",
    github: "GitHub पर openpurr",
    issue: "Issue खोलें",
  },
};
