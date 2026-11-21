// Turkish copy. Follows en.ts; see the notes there. Uses friendly "siz"; "entitlement" is rendered as "erişim hakkı" throughout; webhook and paywall stay English.
import type { Dict } from "./en";

export const tr: Dict = {
  meta: {
    title: "openpurr: kendi sunucunuzda açık kaynak RevenueCat alternatifi",
    description:
      "openpurr, kendi sunucunuzda çalışan açık kaynak bir RevenueCat alternatifi. Mevcut Purchases SDK'nızı koruyun, kendi sunucunuza yönlendirin, gelir payı ödemeyin.",
    ogImageAlt: "openpurr: kendi sunucunuzda çalışan açık kaynak bir RevenueCat alternatifi, abonelik grafikleri panelinin yanında",
  },
  header: {
    home: "openpurr ana sayfa",
    nav: { features: "Özellikler", editions: "Sürümler", roadmap: "Yol haritası", faq: "SSS", migrate: "Geçiş" },
    language: "Dil",
  },
  footer: {
    tagline: "Kendiniz çalıştırdığınız açık kaynak satın alma altyapısı.",
    roadmap: "Yol haritası",
    contributing: "Katkıda bulunun",
    sponsor: "Destek olun",
    privacy: "Gizlilik (İngilizce)",
    disclaimer:
      "openpurr bağımsız bir projedir. RevenueCat, Inc. ile bağlantılı değildir ve RevenueCat, Inc. tarafından desteklenmemektedir. App Store, Apple Inc.'in ticari markasıdır. Google Play, Google LLC'nin ticari markasıdır.",
    copyright: "Telif hakkı {year} openpurr katkıda bulunanları.",
    cookieSettings: "Çerez ayarları",
  },
  consent: {
    label: "Çerez onayı",
    text: "Ziyaretleri saymak ve hangi sayfaların işe yaradığını görmek için Google Analytics çerezlerini kullanmak istiyoruz. Siz kabul etmedikçe hiçbir çerez yerleştirilmez ve kararınızı istediğiniz zaman Çerez ayarları bölümünden değiştirebilirsiniz.",
    privacy: "Gizlilik (İngilizce)",
    decline: "Reddet",
    accept: "Kabul et",
  },
  snippet: {
    tabs: "SDK platformu",
    note: "Tek satır. Aynı SDK, aynı satın alma kodu.",
  },
  home: {
    hero: {
      title: '<span class="nowrap">Kendi sunucunuzda</span> çalışan, açık kaynak bir <span class="accent">RevenueCat alternatifi</span>',
      lede: "Satın alma altyapınızı kendiniz yönetin, gelirinizden kimseye pay vermeyin ve hiçbir ticari hizmete bağımlı kalmayın. Kullandığınız Purchases SDK yerinde kalır: satın alma kodunuzu değil, tek bir URL'yi değiştirirsiniz.",
      star: "GitHub'da yıldız verin",
      how: "Nasıl çalışır",
      shotAlt:
        "openpurr Lite paneli: 12 aylık MRR hareketi, aktif abonelikler, churn, yeni müşteriler, yeni deneme süreleri ve aktif deneme süreleri",
    },
    why: {
      eyebrow: "Kimler için",
      title: "Altyapıyı kendisi çalıştırmayı tercih eden uygulama geliştiricileri için",
      lede: "openpurr resmi ve değiştirilmemiş SDK'larla çalışır. Geçiş, satın alma kodunuzu yeniden yazmakla değil, tek bir URL'yi değiştirmekle başlar.",
      reasons: [
        {
          title: "Verileriniz, sunucularınız",
          body: "Satın alma kayıtları, erişim hakları ve mağaza kimlik bilgileri; sizin çalıştırdığınız, sorguladığınız, yedeklediğiniz ve dışa aktardığınız bir veritabanında durur. Uygulamanızla müşterileriniz arasında hiçbir dış hizmet yer almaz.",
        },
        {
          title: "Gelir payı yok",
          body: "Gelirden yüzde yok, işlem başına ücret yok. Lite sürümü Cloudflare'in ücretsiz planına sığacak şekilde tasarlandı, böylece küçük bir uygulama onu hiç ödemeden çalıştırabilir.",
        },
        {
          title: "Bağımlı kalacağınız bir sağlayıcı yok",
          body: "Apache 2.0 lisansıyla açık kaynaktır. Kodu okuyun, değiştirin ve Cloudflare ile kendi bulutunuz arasında taşıyın.",
        },
      ],
    },
    how: {
      eyebrow: "Nasıl çalışır",
      title: "Eskiden sağlayıcının durduğu yerde artık sizin sunucunuz var",
      lede: "Uygulamanız, zaten içinde gelen açık kaynak Purchases SDK'yı kullanmaya devam eder. SDK openpurr ile konuşur. openpurr mağazalarla konuşur, abonelik durumunu tutar ve neyin değiştiğini backend'inize bildirir.",
      flowLabel: "İstek akışı",
      app: "Uygulamanız",
      sdkLicense: "Resmi, değiştirilmemiş, MIT lisanslı",
      sdkPlatforms: "iOS, Android, Flutter veya React Native",
      coreWhere: "Cloudflare Workers'ta veya kendi bulutunuzda",
      appStoreApi: "Server API ve bildirimler",
      playApi: "Developer API ve RTDN",
      backend: "Backend'iniz",
      backendHooks: "İmzalı webhook'lar",
      steps: [
        {
          title: "Kurun",
          body: "openpurr Lite'ı kendi Cloudflare hesabınızda çalıştırın. Rehberli kurulum <code>pnpm run setup</code>, veritabanını oluşturur, iki Worker'ı da dağıtır ve sahip hesabınızı açar.",
        },
        {
          title: "SDK'yı yönlendirin",
          body: "Proxy URL'sini <code>configure</code> çağrısından önce ayarlayın. İleride taşınabilmek için size ait özel bir alan adı kullanın.",
        },
        {
          title: "Mağazaları bağlayın",
          body: "Mağaza kimlik bilgilerinizi ve bildirim URL'lerini ekleyin. Kurulum denetimi <code>openpurr doctor</code>, bunları doğrular ve eksik bir şey varsa nasıl düzelteceğinizi söyler.",
        },
      ],
    },
    features: {
      eyebrow: "Neler yapar",
      title: "Kullanmadığınız ekstralar olmadan abonelik backend'i",
      items: [
        {
          title: "Satın almalar",
          body: "StoreKit 2 işlemlerini ve Google Play satın almalarını doğrular, SDK'nın beklediği CustomerInfo'yu ve erişim haklarını döndürür.",
        },
        {
          title: "Mağaza bildirimleri",
          body: "App Store Server Notifications V2 ve Google Play Real-time Developer Notifications'ı alır; böylece yenilemeler, iadeler ve ek süreler güncel kalır.",
        },
        {
          title: "Webhook'lar",
          body: "RevenueCat biçimindeki olayları backend'inize gönderir; olaylar HMAC-SHA256 ile imzalanır ve yaklaşık 72 saat boyunca yeniden denenir.",
        },
        {
          title: "Grafikler",
          body: "16 grafik: gelir, MRR ve ARR, MRR ve abonelik hareketi, aktif ve ücretli abonelikler, abonelik durumu, churn, deneme süreleri ve denemeden dönüşüm, yeni müşteriler, iadeler ve iade oranı, tek seferlik satın almalar. Uygulamaya, mağazaya, ürüne ve ortama göre filtreleyin; gelir USD'ye çevrilir.",
        },
        {
          title: "Kimlik doğrulama ve denetim",
          body: "SDK anahtarları ve gizli anahtarlar, isteğe bağlı doğrulayıcı kodlarıyla operatör girişi, roller, erişim token'ları ve bir denetim günlüğü.",
        },
        {
          title: "MCP sunucusu ve Claude becerileri",
          body: "Bir yapay zekâ asistanına bir müşterinin neden bir erişim hakkına sahip olduğunu ya da olmadığını sorun, satın almaları arayın veya App Store Connect ve Play Console kurulumunda adım adım yönlendirilin.",
        },
      ],
    },
    editions: {
      eyebrow: "İki sürüm",
      title: "Küçük başlayın, uygulama güncellemesi olmadan büyüyün",
      lede: "İki sürüm de aynı uyumluluk test paketinden geçer. Uygulamanız size ait özel bir alan adını gösteriyorsa, Lite'tan Standard'a geçmek için yeni bir uygulama sürümü yayınlamanız gerekmez.",
      lite: {
        badge: "Bağımsız uygulamalar için",
        price: "$0",
        priceNote: "Cloudflare'in ücretsiz planında",
        items: [
          "Cloudflare Workers ve D1 üzerinde TypeScript",
          "Hafif ve çalıştırması ucuz",
          "Ücretsiz plan sınırlarına ulaşmadan önce kullanım uyarıları",
        ],
      },
      standard: {
        badge: "Yakında",
        price: "Bulut faturanız",
        priceNote: "fazlası değil",
        items: ["Container'larda Go ve Postgres", "GCP veya AWS", "Daha büyük uygulama portföyleri için"],
      },
    },
    fit: {
      eyebrow: "Açık konuşalım",
      title: "Henüz size göre olmayabilir",
      lede: "Paywall oluşturucular, A/B deneyleri, üçüncü taraf analiz entegrasyonları veya bir destek sözleşmesi gerekiyorsa, ticari platformlar bunları bugün sunuyor.",
      outTitle: "Şimdilik kapsam dışı",
      tags: ["Paywall'lar", "Reklam olayları", "Customer Center", "Sanal para birimleri", "Web üzerinden ödeme", "Amazon", "Analiz entegrasyonları"],
    },
    roadmap: {
      eyebrow: "Yol haritası",
      title: "Nereye gidiyor",
      lede: "Sıralama kesin, ancak tarih yok. Sizin için önemli bir şey varsa bir issue açarak söyleyin.",
      status: { done: "Tamamlandı", wip: "Devam ediyor", planned: "Planlandı", later: "Sizin kararınız" },
      phases: [
        {
          phase: "Lite",
          items: [
            "Son sürüm: {version}",
            "Cloudflare'in ücretsiz planı için tasarlandı",
            "App Store ve Google Play",
            "Webhook'lar, panel ve yönetim",
            "Tek kurulumda birden fazla uygulama",
            "MCP sunucusu, CLI ve Claude becerileri",
            "Sırada: cihaz testleri, ardından 1.0",
          ],
        },
        {
          phase: "Standard",
          items: [
            "Container'larda Go ve Postgres",
            "Önce GCP, sonra AWS",
            "Lite ile aynı uyumluluk test paketi",
            "Uygulama güncellemesi olmadan Lite'tan geçiş",
          ],
        },
        {
          phase: "Topluluğun şekillendirdiği",
          items: ["Doğrulanmış son kullanıcı kimliği", "Daha büyük ekipler için Standard ekstraları", "Issue'larda ne isterseniz"],
        },
      ],
      more: "Yol haritasının tamamını okuyun (İngilizce) →",
    },
    cta: {
      title: "Şekillendirmeye yardım edin",
      body: "Şu anda en faydalı yardım geri bildirimdir: SDK'lar veya mağazalar hakkındaki yanlış varsayımlar ve yenilemeler, iadeler ve ek sürelerle ilgili gerçek hayattan uç durumlar.",
      star: "GitHub'da yıldız verin",
      issue: "Issue açın",
      coffee: "Bize bir kahve ısmarlayın",
    },
  },
  faq: {
    eyebrow: "SSS",
    title: "Bir RevenueCat alternatifi olarak openpurr",
    lede: "Kendi abonelik backend'inizi çalıştırdığınızda neyin değiştiği ve neyin değişmediği.",
    items: [
      {
        q: "openpurr nedir?",
        a: "openpurr, RevenueCat'e açık kaynak ve kendi sunucunuzda çalışan bir alternatiftir. Resmi RevenueCat Purchases SDK ile çalışan, uygulama içi satın almalar ve abonelikler için bir backend'dir. App Store ve Google Play satın almalarını doğrular, erişim haklarını takip eder, mağaza bildirimlerini alır, backend'inize webhook gönderir ve temel abonelik metriklerinizi grafiklerle gösterir; hepsi sizin kontrol ettiğiniz altyapıda.",
      },
      {
        q: "openpurr'ın RevenueCat'ten farkı nedir?",
        a: "RevenueCat, ücretsiz katmanın üzerinde gelirden pay alan, barındırılan ticari bir hizmettir. openpurr ise kendiniz çalıştırdığınız bir yazılımdır: satın alma kayıtlarınız, erişim haklarınız ve mağaza kimlik bilgileriniz kendi veritabanınızda durur, gelir payı veya işlem başına ücret yoktur. RevenueCat bugün paywall'lar, deneyler ve analiz entegrasyonları gibi daha fazla özellik sunuyor. openpurr ise temel abonelik backend'ine odaklanır.",
      },
      {
        q: "RevenueCat'ten geçmek için satın alma kodumu yeniden yazmam gerekir mi?",
        a: "Hayır. openpurr resmi ve değiştirilmemiş Purchases SDK ile çalışır. configure çağrısından önce SDK'nın proxy URL'sini openpurr sunucunuza ayarlarsınız ve satın alma kodunuzun geri kalanı aynı kalır. Sunucunuzu ileride uygulama güncellemesi olmadan taşıyabilmek için size ait özel bir alan adı kullanın.",
      },
      {
        q: "Mevcut müşterilerimi RevenueCat'ten nasıl taşırım?",
        a: "İçe aktararak. RevenueCat'ten bir geçiş dışa aktarımı isteyin; openpurr import her müşterinin satın almalarını Apple ve Google'dan alır ve aynı uygulama kullanıcı kimliklerine atar. Uygulamanızın yeni sürümü de her müşterinin satın almalarını bir kez gönderir ve kullanıcılar uygulamayı güncellerken iki backend de güncel kalır, böylece kimse erişimini kaybetmez.",
        link: "Nasıl geçiş yapılır",
      },
      {
        q: "openpurr hangi platformları ve mağazaları destekliyor?",
        a: "openpurr, iOS, Android, Flutter ve React Native için Purchases SDK'yı, App Store ve Google Play'deki satın almalarla birlikte destekler. Amazon ve web üzerinden ödeme şimdilik kapsam dışıdır.",
      },
      {
        q: "openpurr'ın maliyeti nedir?",
        a: "openpurr, Apache 2.0 lisansıyla ücretsiz ve açık kaynaktır. Yalnızca üzerinde çalıştığı altyapı için ödeme yaparsınız. Lite sürümü Cloudflare'in ücretsiz planında çalışacak şekilde tasarlandı, böylece küçük bir uygulama onu hiç ödemeden çalıştırabilir. Standard sürümü kendi bulutunuzda container'larda çalışır, dolayısıyla maliyeti bulut faturanızdır.",
      },
      {
        q: "Verilerim nerede saklanıyor?",
        a: "Kendi veritabanınızda. Lite sürümü, Cloudflare hesabınızdaki Cloudflare D1'i kullanır. Standard sürümü GCP veya AWS üzerinde Postgres kullanır. Verilerinizi sorgulayabilir, yedekleyebilir ve dışa aktarabilirsiniz; uygulamanızla müşterileriniz arasında hiçbir dış hizmet yer almaz.",
      },
      {
        q: "openpurr, RevenueCat gibi webhook gönderiyor mu?",
        a: "Evet. openpurr, RevenueCat biçimindeki olayları HMAC-SHA256 ile imzalayarak backend'inize gönderir ve yaklaşık 72 saat boyunca yeniden dener; bu yüzden mevcut webhook işleyicileriniz çok az değişiklik gerektirir ya da hiç gerektirmez.",
      },
      {
        q: "RevenueCat'in yapıp openpurr'ın yapmadığı neler var?",
        a: "Paywall'lar, üçüncü taraf analiz entegrasyonları, Customer Center, sanal para birimleri, web üzerinden ödeme, Amazon, reklam olayları ve ticari destek sözleşmesi şimdilik kapsam dışıdır. Fiyat deneyleri yol haritasındadır. Bunlara bugün ihtiyacınız varsa ticari bir platform size daha uygun olur.",
      },
      {
        q: "openpurr canlı kullanıma hazır mı?",
        a: "Henüz değil. openpurr erken aşamada: Lite sürümü üzerinde çalışılıyor, Standard sürümü daha sonra gelecek. Yol haritasını GitHub'da takip edin ve sizin için önemli bir şey varsa bir issue açın.",
      },
      {
        q: "openpurr'ın RevenueCat ile bir bağlantısı var mı?",
        a: "Hayır. openpurr bağımsız, açık kaynak bir projedir; RevenueCat, Inc. ile bağlantılı değildir ve RevenueCat, Inc. tarafından desteklenmemektedir. RevenueCat'in MIT lisanslı resmi Purchases SDK'sı ile çalışır.",
      },
    ],
  },
  structured: {
    description:
      "Kendi sunucunuzda çalışan, açık kaynak bir RevenueCat alternatifi: App Store ve Google Play uygulama içi satın almaları ve abonelikleri için, resmi ve değiştirilmemiş Purchases SDK ile çalışan bir backend. Satın almaları doğrular, erişim haklarını takip eder, mağaza bildirimlerini alır, webhook gönderir ve abonelik metriklerini grafiklerle gösterir.",
    subCategory: "Uygulama içi satın alma ve abonelik backend'i",
    features: [
      "iOS, Android, Flutter ve React Native için resmi RevenueCat Purchases SDK ile çalışır",
      "StoreKit 2 ve Google Play satın alma doğrulaması",
      "App Store Server Notifications V2 ve Google Play Real-time Developer Notifications",
      "HMAC-SHA256 ile imzalanan, RevenueCat biçiminde webhook'lar",
      "MRR, churn ve denemeden dönüşüm dahil 16 abonelik grafiği",
      "MCP sunucusu, CLI ve Claude becerileri",
    ],
  },
};
