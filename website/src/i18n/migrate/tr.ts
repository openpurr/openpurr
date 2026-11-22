// Turkish copy of the migration page. Follows en.ts; see the notes there.
import type { MigrateDict } from "./en";

export const migrateTr: MigrateDict = {
  meta: {
    title: "RevenueCat'ten openpurr'a geçiş: adım adım rehber",
    description:
      "Uygulamanızı açık kaynak RevenueCat alternatifi openpurr'a taşıyın: Purchases SDK'yı koruyun, tüm aboneleri içe aktarın ve erişimlerini kaybetmelerini önleyin.",
    ogImageAlt:
      "Tek bir aboneyi bile kaybetmeden RevenueCat'ten openpurr'a geçin: Purchases SDK'yı koruyun, tüm müşterileri içe aktarın, eski uygulama sürümleri çalışmaya devam etsin.",
  },
  hero: {
    crumb: "RevenueCat'ten geçiş",
    eyebrow: "Geçiş rehberi",
    headline: "Tek bir aboneyi bile kaybetmeden RevenueCat'ten openpurr'a geçin",
    lede: "Uygulamanızın zaten kullandığı Purchases SDK yerinde kalır. Mevcut müşterilerinizi RevenueCat'in dışa aktarımından içe aktarın: openpurr her satın almayı Apple ve Google'dan kendisi alır. Kullanıcılar güncelleme yaparken eski uygulama sürümleri çalışmaya devam eder.",
    guide: "Adım adım rehberi okuyun (İngilizce)",
    steps: "Adımları görün",
    updated: "Güncellendi: {date}",
  },
  summary: {
    title: "Kısaca",
    items: [
      "openpurr, kendi sunucunuzda çalışan, açık kaynak bir RevenueCat alternatifidir. Resmi ve değiştirilmemiş RevenueCat Purchases SDK ile çalışır.",
      "Uygulamanıza tek bir satır (SDK'nın proxy URL'si) ve tek seferlik bir <code>syncPurchases</code> çağrısı eklenir. Satın alma kodunuzun geri kalanı aynı kalır.",
      "<code>openpurr import</code>, mevcut müşterileri RevenueCat'in dışa aktarımından taşır. Satın almaların kendisi kopyalanmaz, Apple ve Google'dan alınır.",
      "App Store uygulamaları RevenueCat'in Scheduled Data Export'unu kullanabilir. Google Play için RevenueCat Support'tan bir geçiş dışa aktarımı gerekir; satın alma token'larını içeren tek dışa aktarım budur.",
      "Kullanıcıların çoğu uygulamayı güncelleyene kadar iki backend de güncel kalır, böylece kimse erişimini kaybetmez.",
      "Cloudflare'in ücretsiz planında içe aktarma günde yaklaşık 2.500 müşteri işler. Workers Paid ile büyük bir içe aktarma birkaç saat sürer.",
    ],
  },
  how: {
    eyebrow: "Nasıl çalışır",
    title: "RevenueCat'ten geçiş nasıl işler",
    lede: "openpurr, satın alma kayıtlarını RevenueCat'ten kopyalamaz. Yalnızca hangi satın almanın kime ait olduğunu bilmesi yeterlidir; ardından, uygulamanız bir satın alma gönderdiğinde yaptığı gibi mağazalara sorar.",
    ways: [
      {
        title: "İçe aktarma",
        body: "RevenueCat'in dışa aktarımı, hangi mağaza satın almasının hangi uygulama kullanıcısına ait olduğunu söyler. <code>openpurr import</code> her satın almayı Apple ve Google'a sorar ve mağazanın yanıtını o kullanıcı için kaydeder. Uygulamayı bir daha hiç açmayacak olanlar dahil herkesi tek seferde taşır.",
      },
      {
        title: "Uygulama güncellemesi",
        body: "Yeni sürüm, Purchases SDK'yı openpurr'a yönlendirir ve her müşterinin satın almalarını <code>syncPurchases</code> ile bir kez gönderir. Böylece dışa aktarımda eksik kalanlar ve dışa aktarım alındıktan sonra satın alma yapanlar da yakalanır.",
      },
      {
        title: "Bir süre iki backend birden",
        body: "Kullanıcılar güncelleme yapana kadar eski uygulama sürümleri RevenueCat ile konuşmaya devam eder. RevenueCat, Apple'ın bildirimlerini openpurr'a iletir, ikinci bir Pub/Sub aboneliği de aynısını Google için yapar; böylece ikisi de güncel kalır.",
      },
    ],
  },
  app: {
    eyebrow: "Uygulamanızda",
    title: "Uygulamanızda neler değişir",
    lede: "Proxy URL'sini configure'dan önce ayarlayın ve her müşterinin satın almalarını bir kez gönderin. Aynı iki değişiklik Android, Flutter ve React Native'de de geçerlidir; her biri için kod rehberde.",
    codeLabel: "Swift örneği: proxy URL'si ve tek seferlik eşitleme",
    proxyComment: "configure()'dan önce: çoğu uygulamanın eklediği tek satır",
    syncComment: "Kurulum başına bir kez: bu müşterinin satın almalarını openpurr'a gönder",
  },
  import: {
    eyebrow: "İçe aktarma",
    title: "Müşterileri RevenueCat'ten içe aktarma",
    lede: "openpurr CLI, RevenueCat'in sütunlarını olduğu gibi okur: uygulama kullanıcı kimlikleri, App Store işlem kimlikleri, Google Play satın alma token'ları ve <code>$email</code> gibi öznitelikler.",
    codeLabel: "Terminal: RevenueCat dışa aktarımını içe aktarma",
    dryRunComment: "İlk satırları kontrol et: Apple ve Google'a sorar, hiçbir şey yazmaz",
    importComment: "Herkesi içe aktar. İstediğin an durdur; devam etmek için yeniden çalıştır.",
    safeguards: [
      ["Kimse erişimini kaybetmez", "Uygulamanın bir müşteri için zaten gönderdiği satın alma o müşteride kalır; içe aktarma onu asla taşımaz."],
      ["Yinelenen webhook yok", "İçe aktarılan satın almalar yeni değildir, bu yüzden openpurr onlar için olay göndermez."],
      ["Dürüst grafikler", "İçe aktarılan müşteriler, içe aktarma gününde yeni sayılmaz; ilk satın alma tarihlerine göre tarihlenir."],
      ["Uygulamanız çalışmaya devam eder", "Cloudflare'in ücretsiz planında içe aktarma, günlük sınırın %90'ında durur ve ertesi gün devam eder."],
      ["Durdurun ve sürdürün", "İlerleme kaydedilir. Bir satırı iki kez içe aktarmak hiçbir şeyi değiştirmez, bu yüzden daha yeni bir dışa aktarım yeniden çalıştırılabilir."],
      ["Önce deneyin", "Deneme çalıştırması (dry run) mağazalara sorar ve hiçbir şey yazmadan ne olacağını raporlar."],
    ] as [string, string][],
  },
  steps: {
    eyebrow: "Adım adım",
    title: "Yedi adımda RevenueCat'ten geçiş nasıl yapılır",
    lede: "Geçişe hazır olana kadar iki backend de çalışmaya devam eder, böylece eski uygulama sürümlerini kullanan müşteriler erişimlerini korur.",
    items: [
      {
        title: "openpurr'ı kurun",
        body: "openpurr Lite'ı Cloudflare hesabınıza dağıtın, App Store ve Google Play API erişimi verin, ürünlerinizi, erişim haklarınızı ve tekliflerinizi (offerings) aynı tanımlayıcılarla yeniden oluşturun. RevenueCat'in herkese açık SDK anahtarlarını bile koruyabilirsiniz.",
      },
      {
        title: "İki backend'i de bilgilendirin",
        body: "openpurr'ı RevenueCat'in Apple Server Notification Forwarding URL'si olarak ayarlayın ve openpurr'ın push aboneliğini Play bildirim konunuza ekleyin.",
      },
      {
        title: "Dışa aktarımınızı alın",
        body: "Yalnızca App Store: RevenueCat'in Scheduled Data Export'u gereken her şeyi içerir. Google Play ile RevenueCat Support'tan bir geçiş dışa aktarımı isteyin, çünkü satın alma token'ları yalnızca onda bulunur. Rehberde kopyalayabileceğiniz bir talep metni var.",
      },
      { title: "İçe aktarın", body: "Önce bir deneme çalıştırmasıyla <code>openpurr import</code> komutunu çalıştırın. Tek tek satırlardaki sorunlar bir rapora yazılır ve içe aktarmayı durdurmaz." },
      { title: "Uygulama güncellemesini yayınlayın", body: "Proxy URL'sini ve tek seferlik <code>syncPurchases</code> çağrısını ekleyin. İçe aktarma bittikten sonra yayınlayın." },
      {
        title: "Kontrol edin",
        body: "<code>openpurr doctor</code> kurulumu kontrol eder. Tanıdığınız müşterileri arayın ve aktif abonelikleri RevenueCat'in grafikleriyle karşılaştırın.",
      },
      {
        title: "Geçişi tamamlayın",
        body: "Müşterilerin çoğu güncelleme yaptıktan sonra Apple ve Google'ı doğrudan openpurr'a yönlendirin, openpurr'ın webhook'larını açın ve RevenueCat'inkileri kapatın.",
      },
    ],
    source: "Kaynak:",
    sourceNotifications: "RevenueCat: Apple sunucu bildirimleri (İngilizce)",
    sourceExports: "RevenueCat: verileri dışa aktarma veya taşınma (İngilizce)",
    more: "Tüm komutlar ve ayarlar rehberin tamamında (İngilizce) →",
  },
  moves: {
    eyebrow: "Neler taşınır",
    title: "RevenueCat'ten neler taşınır, neler taşınmaz",
    rows: [
      ["Yenilemeler, iadeler, ek süreler ve sona ermelerle birlikte abonelikler ve satın almalar", "Evet, Apple ve Google'dan alınır"],
      ["Hangi satın almanın kime ait olduğu", "Evet, RevenueCat'in dışa aktarımından"],
      ["Anonim olanlar dahil uygulama kullanıcı kimlikleri", "Evet, değişmeden"],
      ["Müşteri öznitelikleri ($email, $displayName ve kendi öznitelikleriniz)", "Evet, bir Audience export'tan"],
      ["Ürünler, erişim hakları ve teklifler (offerings)", "Aynı tanımlayıcılarla siz yeniden oluşturursunuz"],
      ["Geçişten önceki grafik geçmişi", "Kısmen: kayıtlarınız için RevenueCat'in grafik CSV'lerini saklayın"],
      ["Deneyler", "Siz yeniden oluşturursunuz: openpurr tekliflerinizde (offerings) fiyat deneyleri çalıştırır"],
      ["Paywall'lar, entegrasyonlar, Customer Center", "Hayır: openpurr'da bunlar yok"],
    ] as [string, string][],
  },
  faq: {
    eyebrow: "SSS",
    title: "RevenueCat'ten geçiş hakkında SSS",
    items: [
      {
        q: "Satın alma kodumu değiştirmem gerekir mi?",
        a: "Hayır. openpurr, resmi ve değiştirilmemiş RevenueCat Purchases SDK ile çalışır. Uygulama güncellemesi, configure'dan önce proxy URL'sini ve tek seferlik bir syncPurchases çağrısını ekler. getOfferings, purchase, restorePurchases, logIn ve diğerleri olduğu gibi kalır.",
      },
      {
        q: "Geçiş için RevenueCat'in yardımına ihtiyacım var mı?",
        a: "App Store uygulamaları için hayır, çünkü RevenueCat'in Scheduled Data Export'u openpurr'ın ihtiyaç duyduğu işlem kimliklerini içerir. Google Play için evet, çünkü RevenueCat'in belgelerine göre Google'ın istediği satın alma token'larını yalnızca RevenueCat Support'un hazırladığı geçiş dışa aktarımı içerir.",
      },
      {
        q: "Uygulamayı hiç güncellemeyen müşteriler ne olacak?",
        a: "İçe aktarma onları kapsar: satın almaları Apple ve Google'dan alınır ve aynı uygulama kullanıcı kimliklerine atanır. Eski bir uygulama sürümünü kullandıkları sürece bu sürüm RevenueCat ile konuşur; kullanıcıların çoğu güncelleme yapana kadar iki backend'in de bilgilendirilmesinin nedeni budur.",
      },
      {
        q: "Bir içe aktarma ne kadar sürer?",
        a: "Her müşteri yaklaşık 30 veritabanı satırı yazımı gerektirir. Cloudflare'in ücretsiz planında bu, günde yaklaşık 2.500 müşteri demektir; içe aktarma günlük sınırda kendiliğinden duraklar ve ertesi gün devam eder. Workers Paid ile (ayda 5 $) büyük bir içe aktarma birkaç saat sürer.",
      },
      {
        q: "Verilerim RevenueCat'ten kopyalanıyor mu?",
        a: "Yalnızca uygulama kullanıcılarıyla mağaza satın almaları arasındaki eşleme ve içe aktarırsanız öznitelikler kopyalanır. Satın almaların kendisi doğrudan Apple ve Google'dan gelir, bu yüzden openpurr mağazaların güncel durumunu, yenilemeler ve iadeler dahil olmak üzere kaydeder.",
      },
    ],
  },
  cta: {
    title: "Geçmeye hazır mısınız?",
    body: "Rehber her adımı tek tek anlatır. Kurulumunuzda uymayan bir şey varsa bir issue açın: sırada neyin geliştirileceğini geçişler belirliyor.",
    guide: "Rehberi okuyun (İngilizce)",
    github: "GitHub'da openpurr",
    issue: "Issue açın",
  },
};
