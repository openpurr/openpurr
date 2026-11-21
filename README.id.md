<!-- translated-from: README.md sha256:8dbb0e93d652582d -->
<h1 align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset=".github/assets/openpurr-logo-dark.png">
    <img src=".github/assets/openpurr-logo.png" alt="openpurr" width="400">
  </picture>
</h1>

<!-- languages -->
<p align="center"><a href="README.md">English</a> · <a href="README.de.md">Deutsch</a> · <a href="README.es.md">Español</a> · <a href="README.fr.md">Français</a> · <a href="README.it.md">Italiano</a> · <a href="README.nl.md">Nederlands</a> · <a href="README.pl.md">Polski</a> · <a href="README.pt-BR.md">Português (Brasil)</a> · <a href="README.tr.md">Türkçe</a> · <b>Bahasa Indonesia</b> · <a href="README.vi.md">Tiếng Việt</a> · <a href="README.ar.md">العربية</a> · <a href="README.hi.md">हिन्दी</a> · <a href="README.ja.md">日本語</a> · <a href="README.ko.md">한국어</a> · <a href="README.zh-CN.md">简体中文</a> · <a href="README.zh-TW.md">繁體中文</a></p>
<!-- /languages -->

Backend alternatif RevenueCat yang open source dan di-host sendiri.

Dengan Purchases SDK open source dari RevenueCat, arahkan `Purchases.proxyURL` aplikasi Anda ke server Anda sendiri. openpurr memvalidasi pembelian App Store dan Google Play, melacak entitlement, menerima notifikasi store, mengirim webhook ke backend Anda, dan menampilkan grafik metrik langganan utama Anda. Semuanya berjalan di infrastruktur yang Anda kendalikan.

openpurr adalah proyek independen. Proyek ini tidak berafiliasi dengan atau didukung oleh RevenueCat, Inc.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset=".github/assets/openpurr-dashboard-demo-dark.webp">
  <img src=".github/assets/openpurr-dashboard-demo.webp" alt="Grafik di dashboard openpurr Lite, diklik satu per satu dengan tooltip: MRR, Pergerakan MRR, Pendapatan, Langganan aktif, Churn">
</picture>

## Untuk siapa

Developer aplikasi yang:

- **Ingin mengendalikan infrastruktur pembelian sendiri.** Catatan pembelian, entitlement, dan kredensial store Anda berada di server yang Anda jalankan, dalam database yang bisa Anda kueri, cadangkan, dan ekspor. Tidak ada layanan luar di antara aplikasi Anda dan pelanggan Anda.
- **Tidak ingin membagi persentase pendapatan.** openpurr tidak mengambil bagi hasil pendapatan dan tidak memungut biaya per transaksi. Edisi Lite dirancang agar muat di paket gratis Cloudflare, sehingga aplikasi kecil bisa menjalankannya tanpa biaya.
- **Tidak ingin bergantung pada layanan komersial.** Kodenya open source: Anda bisa membaca kodenya, mengubahnya, dan memindahkannya antara Cloudflare dan cloud Anda sendiri.

openpurr juga cocok jika Anda sudah memakai SDK RevenueCat dan ingin tetap memakainya. openpurr bekerja dengan SDK resmi tanpa modifikasi, jadi beralih cukup dimulai dengan mengganti satu URL, bukan menulis ulang kode pembelian Anda. Untuk memindahkan pelanggan yang sudah ada, lihat [Pindah dari RevenueCat](https://openpurr.org/id/migrate-from-revenuecat/).

**Mungkin belum cocok untuk Anda** jika Anda membutuhkan pembuat paywall, eksperimen A/B, integrasi analitik pihak ketiga, atau kontrak dukungan. Platform komersial sudah menyediakannya saat ini. Lihat [roadmap](ROADMAP.md) (bahasa Inggris) untuk fitur yang akan datang.

## Apa yang dilakukannya

- **Pembelian:** memvalidasi transaksi StoreKit 2 dan pembelian Google Play, lalu mengembalikan `CustomerInfo` dan entitlement yang diharapkan SDK.
- **Notifikasi store:** menerima App Store Server Notifications V2 dan Google Play Real-time Developer Notifications.
- **Webhook:** mengirim event berformat RevenueCat ke backend Anda, ditandatangani dengan HMAC-SHA256 dan dicoba ulang selama sekitar 72 jam.
- **Grafik:** 16 grafik di dashboard, bisa difilter menurut proyek, aplikasi, store, produk, dan lingkungan, serta diunduh sebagai CSV:
  - **Pendapatan:** pendapatan, refund, tingkat refund, dan pembelian non-langganan.
  - **Pendapatan berulang:** MRR, ARR, dan pergerakan MRR.
  - **Langganan:** langganan aktif, langganan berbayar, pergerakan langganan, status langganan, dan churn.
  - **Uji coba:** uji coba aktif, uji coba baru, dan pergerakan uji coba.
  - **Pelanggan:** pelanggan baru.
- **Autentikasi:** SDK key dan secret key, login operator (kata sandi dengan kode autentikator opsional; Cloudflare Access direncanakan), peran, dan log audit.
- **Server MCP dan skill Claude:** asisten AI bisa mencari pelanggan, menjelaskan mengapa seseorang memiliki atau tidak memiliki entitlement, dan memandu Anda melalui setup App Store dan Play Console.

**Belum termasuk untuk saat ini:** paywall, event iklan, Customer Center, mata uang virtual, penagihan web, Amazon, dan integrasi analitik pihak ketiga. Eksperimen harga sudah tersedia: lihat [panduannya](docs/price-experiments.md) (bahasa Inggris).

## Dua edisi

| | Lite | Standard |
|---|---|---|
| Bahasa | TypeScript | Go |
| Berjalan di | Cloudflare Workers + D1 | Container + Postgres di GCP atau AWS |
| Biaya | Dirancang agar muat di paket gratis Cloudflare | Tagihan cloud Anda |
| Untuk | Aplikasi indie: ringan dan murah dijalankan | Portofolio aplikasi yang lebih besar (segera hadir) |

Kedua edisi lolos rangkaian uji kesesuaian yang sama di `spec/`. Anda bisa pindah dari Lite ke Standard tanpa merilis update aplikasi, selama aplikasi Anda mengarah ke domain kustom milik Anda.

## Kompatibilitas SDK

Sejak hari pertama, openpurr memakai SDK resmi tanpa modifikasi (semuanya berlisensi MIT):

| SDK | Cara mengarahkannya ke openpurr |
|---|---|
| iOS | `Purchases.proxyURL = URL(string: "https://purchases.example.com")` |
| Android | `Purchases.proxyURL = URL("https://purchases.example.com")` |
| Flutter, React Native | `Purchases.setProxyURL("https://purchases.example.com")` |

Atur URL proxy sebelum memanggil `configure`. Biarkan verifikasi entitlement pada nilai default-nya (nonaktif), karena respons bertanda tangan bergantung pada kunci milik RevenueCat sendiri.

**Keterbatasan yang diketahui di Android:** SDK mengirim lalu lintas diagnostik, paywall, dan iklan langsung ke tiga host RevenueCat, bahkan saat URL proxy sudah diatur. openpurr mematikan diagnostik melalui remote config. Jangan gunakan paywall atau iklan RevenueCatUI di Android bersama openpurr.

## Rencana struktur repo

```
spec/       language-neutral contract: OpenAPI, JSON schemas, fixtures, conformance suite
lite/       Lite edition: lightweight, for indie apps on Cloudflare Workers (TypeScript)
standard/   Standard edition: for larger app portfolios on AWS or GCP (Go, coming soon)
cli/        `npx @openpurr/cli` (works with either edition)
skills/     Claude Code plugin
examples/   sample apps
infra/      Terraform/OpenTofu modules for GCP, AWS and DigitalOcean
```

## Memulai

Lite ada di versi 0.1.0, rilis pertamanya, jadi bersiaplah untuk perubahan sebelum 1.0. Untuk mencobanya di akun Cloudflare Anda sendiri (paket gratis sudah cukup), dengan Node 22.12 atau yang lebih baru:

```sh
git clone https://github.com/openpurr/openpurr && cd openpurr
npx pnpm install
cd lite && npx wrangler login
npx pnpm run setup      # database, both Workers, operator secret and your owner account
```

Setup aman dijalankan ulang jika berhenti di tengah jalan. Di akhir, setup memberikan tautan ke dashboard, yang terbuka di langkah menambahkan aplikasi pertama Anda: bundle ID dan nama package-nya, lalu produk, entitlement, dan offering. Satu deployment bisa menjalankan beberapa aplikasi sebagai proyek terpisah, masing-masing dengan pelanggannya sendiri. Setelah itu:

- **Periksa setup Anda:** jalankan `npx @openpurr/cli login`, lalu `npx @openpurr/cli doctor`. Perintah ini melaporkan apa yang kurang dan cara memperbaiki setiap item.
- **Dapatkan peringatan penggunaan:** tambahkan token API Cloudflare dengan izin Account Analytics: Read sebagai secret `CLOUDFLARE_ANALYTICS_TOKEN`, dan dashboard akan memperingatkan Anda sebelum batas harian paket gratis menghentikan permintaan.
- **Cadangkan data Anda:** `npx pnpm db:backup` mengekspor database ke sebuah file. D1 juga menyimpan riwayat 7 hari di paket gratis (30 hari di Workers Paid).
- **Deploy di setiap push:** fork repo ini dan tambahkan detail Cloudflare Anda sebagai repository secret. [`lite-deploy.yml`](.github/workflows/lite-deploy.yml) mencantumkan daftarnya.

Memakai Claude Code? [Plugin openpurr](plugin/) (bahasa Inggris) memandu langkah yang sama, ditambah setup App Store Connect dan Play Console.

## Berkontribusi

Lihat [CONTRIBUTING.md](CONTRIBUTING.md) (bahasa Inggris). Saat ini bantuan yang paling berguna adalah masukan di issue: asumsi yang keliru tentang SDK atau store, dan kasus khusus dari dunia nyata.

Untuk hal lainnya, kirim email ke [hello@openpurr.org](mailto:hello@openpurr.org).

## Riwayat Bintang

<a href="https://www.star-history.com/?repos=openpurr%2Fopenpurr&type=timeline&legend=bottom-right">
 <picture>
   <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/chart?repos=openpurr/openpurr&type=date&theme=dark&legend=bottom-right" />
   <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/chart?repos=openpurr/openpurr&type=date&legend=bottom-right" />
   <img alt="Grafik riwayat bintang" src="https://api.star-history.com/chart?repos=openpurr/openpurr&type=date&legend=bottom-right" />
 </picture>
</a>

## Lisensi

[Apache License 2.0](LICENSE). Hak cipta 2026 kontributor openpurr.
