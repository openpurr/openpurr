<!-- translated-from: README.md sha256:7fe66f74f9217d9d -->
<h1 align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset=".github/assets/openpurr-logo-dark.png">
    <img src=".github/assets/openpurr-logo.png" alt="openpurr" width="400">
  </picture>
</h1>

<!-- languages -->
<p align="center"><a href="README.md">English</a> · <a href="README.de.md">Deutsch</a> · <a href="README.es.md">Español</a> · <a href="README.fr.md">Français</a> · <a href="README.it.md">Italiano</a> · <a href="README.nl.md">Nederlands</a> · <a href="README.pl.md">Polski</a> · <a href="README.pt-BR.md">Português (Brasil)</a> · <b>Türkçe</b> · <a href="README.id.md">Bahasa Indonesia</a> · <a href="README.vi.md">Tiếng Việt</a> · <a href="README.ar.md">العربية</a> · <a href="README.hi.md">हिन्दी</a> · <a href="README.ja.md">日本語</a> · <a href="README.ko.md">한국어</a> · <a href="README.zh-CN.md">简体中文</a> · <a href="README.zh-TW.md">繁體中文</a></p>
<!-- /languages -->

Kendi sunucunuzda çalışan, açık kaynak bir RevenueCat alternatifi backend.

RevenueCat'in açık kaynak Purchases SDK'larını kullanarak uygulamanızın `Purchases.proxyURL` ayarını kendi sunucunuza yönlendirirsiniz. openpurr, App Store ve Google Play satın almalarını doğrular, erişim haklarını takip eder, mağaza bildirimlerini alır, backend'inize webhook gönderir ve temel abonelik metriklerinizi grafiklerle gösterir. Sizin kontrol ettiğiniz altyapıda çalışır.

openpurr bağımsız bir projedir. RevenueCat, Inc. ile bağlantılı değildir ve RevenueCat, Inc. tarafından desteklenmemektedir.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset=".github/assets/openpurr-dashboard-demo-dark.webp">
  <img src=".github/assets/openpurr-dashboard-demo.webp" alt="openpurr Lite panelindeki grafikler, ipuçlarıyla tek tek: MRR, MRR hareketi, Gelir, Aktif abonelikler, Churn">
</picture>

## Kimler için

Şu uygulama geliştiricileri için:

- **Satın alma altyapısını kendisi yönetmek isteyenler.** Satın alma kayıtlarınız, erişim haklarınız ve mağaza kimlik bilgileriniz sizin çalıştırdığınız sunucularda, sorgulayabileceğiniz, yedekleyebileceğiniz ve dışa aktarabileceğiniz bir veritabanında durur. Uygulamanızla müşterileriniz arasında hiçbir dış hizmet yer almaz.
- **Gelirinden pay vermek istemeyenler.** openpurr'da gelir payı ve işlem başına ücret yoktur. Lite sürümü Cloudflare'in ücretsiz planına sığacak şekilde tasarlandı, böylece küçük bir uygulama onu hiç ödemeden çalıştırabilir.
- **Ticari bir hizmete bağımlı kalmak istemeyenler.** Açık kaynaktır: kodu okuyabilir, değiştirebilir ve Cloudflare ile kendi bulutunuz arasında taşıyabilirsiniz.

RevenueCat SDK'larını zaten kullanıyor ve onları korumak istiyorsanız da iyi bir seçenektir. openpurr resmi ve değiştirilmemiş SDK'larla çalışır, bu yüzden geçiş, satın alma kodunuzu yeniden yazmakla değil, tek bir URL'yi değiştirmekle başlar. Mevcut müşterilerinizi taşımak için [RevenueCat'ten geçiş](https://openpurr.org/tr/migrate-from-revenuecat/) sayfasına bakın.

Paywall oluşturucular, A/B deneyleri, üçüncü taraf analiz entegrasyonları veya bir destek sözleşmesi gerekiyorsa **openpurr (henüz) size göre olmayabilir**. Ticari platformlar bunları bugün sunuyor. Neler geleceğini [yol haritasında](ROADMAP.md) (İngilizce) görebilirsiniz.

## Neler yapar

- **Satın almalar:** StoreKit 2 işlemlerini ve Google Play satın almalarını doğrular, SDK'nın beklediği `CustomerInfo`'yu ve erişim haklarını döndürür.
- **Mağaza bildirimleri:** App Store Server Notifications V2 ve Google Play Real-time Developer Notifications'ı alır.
- **Webhook'lar:** RevenueCat biçimindeki olayları backend'inize gönderir; olaylar HMAC-SHA256 ile imzalanır ve yaklaşık 72 saat boyunca yeniden denenir.
- **Grafikler:** panelde 16 grafik; proje, uygulama, mağaza, ürün ve ortama göre filtrelenebilir ve CSV olarak indirilebilir:
  - **Gelir:** gelir, iadeler, iade oranı ve abonelik dışı satın almalar.
  - **Yinelenen gelir:** MRR, ARR ve MRR hareketi.
  - **Abonelikler:** aktif abonelikler, ücretli abonelikler, abonelik hareketi, abonelik durumu ve churn.
  - **Deneme süreleri:** aktif deneme süreleri, yeni deneme süreleri ve deneme süresi hareketi.
  - **Müşteriler:** yeni müşteriler.
- **Kimlik doğrulama:** SDK anahtarları ve gizli anahtarlar, operatör girişi (isteğe bağlı doğrulayıcı kodlarıyla parola; Cloudflare Access planlanıyor), roller ve bir denetim günlüğü.
- **MCP sunucusu ve Claude becerileri:** bir yapay zekâ asistanı müşterileri arayabilir, birinin neden bir erişim hakkına sahip olduğunu ya da olmadığını açıklayabilir ve App Store ile Play Console kurulumunda size adım adım yol gösterebilir.

**Şimdilik kapsam dışı:** paywall'lar, reklam olayları, Customer Center, sanal para birimleri, web üzerinden ödeme, Amazon ve üçüncü taraf analiz entegrasyonları. Fiyat deneyleri [yol haritasında](ROADMAP.md#later-) (İngilizce).

## İki sürüm

| | Lite | Standard |
|---|---|---|
| Dil | TypeScript | Go |
| Çalıştığı yer | Cloudflare Workers + D1 | GCP veya AWS'de container'lar + Postgres |
| Maliyet | Cloudflare'in ücretsiz planına sığacak şekilde tasarlandı | Bulut faturanız |
| Kimin için | Bağımsız uygulamalar: hafif ve çalıştırması ucuz | Daha büyük uygulama portföyleri (yakında) |

İki sürüm de `spec/` içindeki aynı uyumluluk test paketinden geçer. Uygulamanız size ait özel bir alan adını gösterdiği sürece, uygulama güncellemesi yayınlamadan Lite'tan Standard'a geçebilirsiniz.

## RevenueCat'e kıyasla cebinizde kalan

RevenueCat'in Pro planı aylık 2.500 $ izlenen gelirin altında ücretsizdir, sonrasında gelirin tamamının %1'ini alır. Lite, Cloudflare'in ücretsiz planında çalışır; uygulamanız bunu aştığında ayda 5 $'dan başlayan Workers Paid ile devam eder.

<a href="https://openpurr.org/tr/#savings">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset=".github/assets/openpurr-savings-dark.webp">
    <img src=".github/assets/openpurr-savings.webp" alt="Tasarruf hesaplayıcı: aylık gelir 250.000 $'a çıkarken RevenueCat'in aylık maliyeti artar, openpurr Lite'ınki sıfıra yakın kalır">
  </picture>
</a>

| Aylık gelir | RevenueCat, aylık | openpurr Lite, aylık | Yıllık tasarruf |
|---|--:|--:|--:|
| $2.000 | $0 | $0 | **$0** |
| $5.000 | $50 | $0 | **$600** |
| $10.000 | $100 | $0 | **$1.200** |
| $25.000 | $250 | $5 | **$2.940** |
| $50.000 | $500 | $5 | **$5.939** |
| $100.000 | $1.000 | $9 | **$11.896** |
| $250.000 | $2.500 | $20 | **$29.764** |

Tahminlerdir; fiyatlar 21 Kasım 2026 tarihinde kontrol edildi. Günlük aktif kullanıcı başına yaklaşık 1,50 $ aylık gelir ve günde 10 SDK isteği varsayılır; buna göre Workers Paid'e geçiş aylık yaklaşık $11.250 civarındadır. [Kendi rakamlarınızla deneyin](https://openpurr.org/tr/#savings).

## SDK uyumluluğu

İlk günden itibaren resmi ve değiştirilmemiş SDK'lar kullanılır (hepsi MIT lisanslı):

| SDK | openpurr'a nasıl yönlendirilir |
|---|---|
| iOS | `Purchases.proxyURL = URL(string: "https://purchases.example.com")` |
| Android | `Purchases.proxyURL = URL("https://purchases.example.com")` |
| Flutter, React Native | `Purchases.setProxyURL("https://purchases.example.com")` |

Proxy URL'sini `configure` çağrısından önce ayarlayın. Erişim hakkı doğrulamasını varsayılan ayarında (kapalı) bırakın, çünkü imzalı yanıtlar RevenueCat'in kendi anahtarına dayanır.

**Android'de bilinen eksik:** SDK, proxy URL'si ayarlı olsa bile tanılama, paywall ve reklam trafiğini doğrudan üç RevenueCat sunucusuna gönderir. openpurr, tanılamayı uzaktan yapılandırma ile kapatır. Android'de openpurr ile RevenueCatUI paywall'larını veya reklamları kullanmayın.

## Planlanan depo yapısı

```
spec/       language-neutral contract: OpenAPI, JSON schemas, fixtures, conformance suite
lite/       Lite edition: lightweight, for indie apps on Cloudflare Workers (TypeScript)
standard/   Standard edition: for larger app portfolios on AWS or GCP (Go, coming soon)
cli/        `npx @openpurr/cli` (works with either edition)
skills/     Claude Code plugin
examples/   sample apps
infra/      Terraform/OpenTofu modules for GCP, AWS and DigitalOcean
```

## Başlarken

Lite, ilk sürümü olan 0.1.0'da; bu yüzden 1.0'dan önce değişiklikler bekleyin. Kendi Cloudflare hesabınızda (ücretsiz plan yeterli), Node 22.12 veya üzeriyle denemek için:

```sh
git clone https://github.com/openpurr/openpurr && cd openpurr
npx pnpm install
cd lite && npx wrangler login
npx pnpm run setup      # database, both Workers, operator secret and your owner account
```

Kurulum yarıda kesilirse güvenle yeniden çalıştırılabilir. Kurulum, panele giden bir bağlantıyla biter; panel ilk uygulamanızı eklemekle açılır: önce bundle ID'si ve paket adı, ardından ürünler, erişim hakları ve teklifler (offerings). Tek bir kurulum, her biri kendi müşterilerine sahip ayrı projeler olarak birden fazla uygulamayı çalıştırabilir. Sonrasında:

- **Kurulumunuzu kontrol edin:** `npx @openpurr/cli login`, ardından `npx @openpurr/cli doctor` komutunu çalıştırın. Neyin eksik olduğunu ve her birinin nasıl düzeltileceğini raporlar.
- **Kullanım uyarıları alın:** Account Analytics: Read yetkisine sahip bir Cloudflare API token'ını `CLOUDFLARE_ANALYTICS_TOKEN` gizli değeri olarak ekleyin; panel, ücretsiz planın günlük sınırları istekleri durdurmadan önce sizi uyarır.
- **Verilerinizi yedekleyin:** `npx pnpm db:backup` veritabanını bir dosyaya aktarır. D1 ayrıca ücretsiz planda 7 günlük geçmiş tutar (Workers Paid'de 30 gün).
- **Her push'ta dağıtın:** depoyu fork'layın ve Cloudflare bilgilerinizi depo gizli değerleri (secrets) olarak ekleyin. [`lite-deploy.yml`](.github/workflows/lite-deploy.yml) bunları listeler.

Claude Code mu kullanıyorsunuz? [openpurr eklentisi](plugin/) (İngilizce) aynı adımlarda, ayrıca App Store Connect ve Play Console kurulumunda size yol gösterir.

## Katkıda bulunma

[CONTRIBUTING.md](CONTRIBUTING.md) (İngilizce) dosyasına bakın. Şu anda en faydalı yardım, issue'larda geri bildirimdir: SDK'lar veya mağazalar hakkındaki yanlış varsayımlar ve gerçek hayattan uç durumlar.

Diğer her konu için [hello@openpurr.org](mailto:hello@openpurr.org) adresine e-posta gönderin.

## Yıldız geçmişi

<a href="https://www.star-history.com/?repos=openpurr%2Fopenpurr&type=timeline&legend=bottom-right">
 <picture>
   <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/chart?repos=openpurr/openpurr&type=date&theme=dark&legend=bottom-right" />
   <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/chart?repos=openpurr/openpurr&type=date&legend=bottom-right" />
   <img alt="Yıldız geçmişi grafiği" src="https://api.star-history.com/chart?repos=openpurr/openpurr&type=date&legend=bottom-right" />
 </picture>
</a>

## Lisans

[Apache License 2.0](LICENSE). Telif hakkı 2026 openpurr katkıda bulunanları.
