// The "Add in-app purchases" page in this language (see en.ts for the notes).
import type { StartDict } from "./en";

export const startTr: StartDict = {
  meta: {
    title: "Uygulamanıza ücretsiz satın alma ve abonelik ekleyin - openpurr",
    description:
      "Yeni bir uygulamaya mı başlıyorsunuz? Resmi Purchases SDK ve kendi çalıştırdığınız açık kaynak bir backend ile satın alma ve abonelik ekleyin. Hiç gelir payı yok.",
    ogImageAlt: "Yeni bir uygulamaya mı başlıyorsunuz? Gelir payı olmadan başlayın. %1'iniz sizde kalsın, işinize yatırın.",
  },
  hero: {
    crumb: "Uygulama içi satın alma ekleyin",
    eyebrow: "Yeni uygulamalar için",
    headline: "Yeni bir uygulamaya mı başlıyorsunuz?",
    headlineAccent: "Gelir payı olmadan başlayın.",
    /** {threshold} is "$2,500". */
    lede: "Çoğu satın alma backend'i, aylık {threshold} eşiğini geçtiğiniz anda gelirinizin %1'ini alır ve siz büyüdükçe fatura da büyür. Bundan kaçınmanın en kolay zamanı ilk satıştan öncesidir. openpurr, uygulama içi satın almalar ve abonelikler için kendi çalıştırdığınız ücretsiz, açık kaynak bir backend'dir ve büyük platformların kullandığı resmi SDK ile çalışır.",
    ctaStart: "GitHub'da başlayın",
    ctaHow: "Nasıl çalışır",
    ctaAi: "Yapay zekâ asistanınız için bir prompt kopyalayın",
  },
  growth: {
    title: "%1'iniz, ilk günden itibaren",
    text: "Uygulamanızın üç yıl sonra nerede olmasını beklediğinizi seçin. Sıfırdan istikrarlı bir büyüme varsayarsak, %1'lik bir gelir payının bu yolda ne kadar tuttuğunu görün.",
    target: "Üç yıl sonraki aylık gelir",
    /** Labels for the totals. */
    fee: "%1 gelir payı, 3 yılda",
    servers: "Kendiniz çalıştırırsanız, 3 yılda",
    after: "Sonrasında da her yıl",
    /** The chart's accessible description. */
    chartLabel: "Üç yıl boyunca ay ay biriken gelir payı",
    /** HTML. {fee} and {servers} are amounts that move with the slider. */
    summary: "Dördüncü yıla gelmeden <b>{fee}</b> ödemiş olursunuz; kendi sunucularınız ise <b>{servers}</b> tutar. Bu para sizde kalsın, işinize yatırın.",
  },
  invest: {
    title: "İşinize ve kendinize yatırın",
    text: "%1'inizin bir yıllığı sizde kalırsa neler alır:",
  },
  how: {
    title: "Nasıl çalışır",
    lede: "Dört adım; yazdığınız kod da herhangi bir RevenueCat eğitimindekiyle aynı.",
    steps: [
      {
        title: "openpurr'ü kurun",
        /** HTML. */
        text: "Kurulumu Cloudflare hesabınızda çalıştırın. Küçük uygulamalar için Lite <b>ücretsiz plana</b> sığar; kurulum yarıda kalırsa güvenle yeniden çalıştırabilirsiniz.",
      },
      {
        title: "Uygulamanızı ve ürünlerinizi ekleyin",
        text: "Panel ilk uygulamanızı eklemekle açılır: önce bundle ID ve paket adı, ardından ürünler, erişim hakları ve teklifler.",
      },
      {
        title: "Purchases SDK'yı ekleyin",
        /** HTML. */
        text: "MIT lisansıyla açık kaynak olan resmi RevenueCat Purchases SDK'yı yükleyin ve yapılandırmadan önce <b>tek bir proxy URL'si</b> ayarlayın.",
      },
      {
        title: "Yayınlayın",
        text: "Satın almalar Apple ve Google ile doğrulanır, yenilemeler ve iadeler mağaza bildirimleriyle gelir ve backend'iniz webhook'lar alır. Claude Code mu kullanıyorsunuz? openpurr eklentisi App Store Connect ve Play Console kurulumunda size adım adım yol gösterir.",
      },
    ],
    /** Above the setup commands. */
    setupLabel: "Kurulum, kendi bilgisayarınızda",
  },
  ai: {
    title: "Yapay zekâ kodlama asistanınızla kurun",
    text: "Uygulamanızın projesini Claude Code, Codex, Cursor, Grok veya başka bir kodlama ajanında açın ve bu prompt'u yapıştırın. openpurr'ü dağıtır, mağazaları bağlar ve SDK'yı ekler; giriş yapmanızı gerektiren her adımdan önce size sorar.",
    copy: "Prompt'u kopyala",
    copied: "Kopyalandı",
    claudeTip: "Claude Code mu kullanıyorsunuz? Önce adım adım yardım eden openpurr eklentisini ekleyin:",
  },
  includes: {
    title: "Neler sunuyor",
    yes: [
      "App Store ve Google Play'de satın almalar ve abonelikler",
      "Erişim hakları ve teklifler",
      "Backend'inize imzalı ve yeniden denenen webhook'lar",
      "16 grafik: gelir, MRR, churn, deneme süreleri ve daha fazlası",
      "Fiyat deneyleri",
      "Verileriniz kendi veritabanınızda",
    ],
    notYetTitle: "Henüz yok",
    notYet: "Paywall oluşturucular, üçüncü taraf analiz entegrasyonları, reklam olayları, web üzerinden ödeme ve Amazon. Bunlara ilk günden ihtiyacınız varsa ticari platformlar bugün sunuyor.",
  },
  lockin: {
    title: "Hiçbir yönde bağımlılık yok",
    text: "openpurr standart Purchases SDK'yı kullandığı için satın alma kodunuz iki backend ile de çalışır. openpurr size yetmez hale gelirse ya da ticari platformların sunduklarını isterseniz, geçiş bir yapılandırma değişikliği ve müşteri içe aktarımıdır; kodu yeniden yazmanız gerekmez.",
  },
  pricingLink: {
    text: "Ödediğinizde %1'in nereye gittiğini merak mı ediyorsunuz?",
    link: "RevenueCat fiyatlarının dökümünü görün →",
  },
  faq: {
    title: "Sık sorulan sorular",
    /** Each answer is also the page's FAQ structured data. */
    items: {
      backend: {
        q: "Uygulama içi satın almalar için backend gerekir mi?",
        a: "Kesin olarak değil: StoreKit ve Google Play Billing cihazda çalışır. Ama bir backend abonelikleri güvenilir tutar. Satın almaları Apple ve Google ile doğrular, yenilemeleri, iptalleri ve iadeleri mağaza bildirimleriyle takip eder, uygulamanıza ve sunucunuza kimin erişimi olduğunu söyler. openpurr bu backend'dir ve onu kendiniz çalıştırırsınız.",
      },
      cheapest: {
        q: "Bir iOS veya Android uygulamasına abonelik eklemenin en ucuz yolu nedir?",
        /** {servers} a yearly amount, {m25k} "$25,000". */
        a: "Backend'i kendiniz çalıştırmak. Küçük uygulamalar için openpurr Lite, Cloudflare'in ücretsiz planına sığar ve ücretsiz, açık kaynak Purchases SDK ile çalışır; yani yalnızca sunuculara ödersiniz: modelimize göre ayda {m25k} kazanan bir uygulama için yılda yaklaşık {servers}, gelir payı olmadan.",
      },
      free: {
        q: "openpurr gerçekten ücretsiz mi?",
        a: "Evet. Apache 2.0 lisansıyla açık kaynaktır; gelir payı ve işlem başına ücret yoktur. Kendi sunucularınız için ödersiniz, küçük uygulamalar da Cloudflare'in ücretsiz planına sığar.",
      },
      switch: {
        q: "Daha sonra RevenueCat'e geçebilir miyim?",
        a: "Evet. openpurr resmi RevenueCat Purchases SDK'yı kullanır; bu yüzden uygulamanızın satın alma kodu iki backend ile de çalışır ve ürünleriniz mağazalarda aynı kalır. Geçiş, bir yapılandırma değişikliği ve müşteri kayıtlarınızın taşınmasından ibarettir.",
      },
      missing: {
        q: "openpurr henüz neleri yapmıyor?",
        a: "Paywall oluşturucular, üçüncü taraf analiz entegrasyonları, reklam olayları, web üzerinden ödeme ve Amazon. Fiyat deneyleri yerleşik olarak gelir. Gerisine ilk günden ihtiyacınız varsa, ticari bir platform bugün sunuyor.",
      },
    },
  },
};
