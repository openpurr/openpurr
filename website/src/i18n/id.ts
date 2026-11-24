// Indonesian copy. Follows en.ts; see the notes there. Uses "Anda"; common dev terms (store, webhook, entitlement, backend, dashboard, churn, open source) stay English.
import type { Dict } from "./en";

export const id: Dict = {
  meta: {
    title: "openpurr: alternatif RevenueCat open source yang di-host sendiri",
    description:
      "openpurr adalah alternatif RevenueCat open source yang di-host sendiri. Tetap pakai Purchases SDK Anda, arahkan ke server sendiri, tanpa bagi hasil pendapatan.",
    ogImageAlt: "openpurr: alternatif RevenueCat open source yang di-host sendiri, di samping dashboard grafik langganannya",
  },
  header: {
    home: "Beranda openpurr",
    nav: { features: "Fitur", editions: "Edisi", roadmap: "Roadmap", faq: "FAQ", migrate: "Migrasi" },
    language: "Bahasa",
  },
  footer: {
    tagline: "Infrastruktur pembelian open source yang Anda jalankan sendiri.",
    roadmap: "Roadmap",
    contributing: "Berkontribusi",
    sponsor: "Sponsor",
    contact: "Kontak",
    privacy: "Privasi (bahasa Inggris)",
    disclaimer:
      "openpurr adalah proyek independen. Proyek ini tidak berafiliasi dengan atau didukung oleh RevenueCat, Inc. App Store adalah merek dagang Apple Inc. Google Play adalah merek dagang Google LLC.",
    copyright: "Hak cipta {year} kontributor openpurr.",
    cookieSettings: "Pengaturan cookie",
  },
  consent: {
    label: "Persetujuan cookie",
    text: "Kami ingin memakai cookie Google Analytics untuk menghitung kunjungan dan melihat halaman mana yang berguna. Tidak ada cookie yang dipasang kecuali Anda menyetujuinya, dan Anda bisa mengubah pilihan kapan saja di Pengaturan cookie.",
    privacy: "Privasi (bahasa Inggris)",
    decline: "Tolak",
    accept: "Terima",
  },
  snippet: {
    tabs: "Platform SDK",
    note: "Satu baris. SDK yang sama, kode pembelian yang sama.",
  },
  home: {
    hero: {
      title: '<span class="accent">Alternatif RevenueCat</span> open source yang <span class="nowrap">di-host sendiri</span>',
      lede: "Kendalikan infrastruktur pembelian Anda sendiri, tanpa membagi pendapatan, dan tanpa bergantung pada layanan komersial. Tetap pakai Purchases SDK yang sudah Anda gunakan: cukup ganti satu URL, bukan kode pembelian Anda.",
      star: "Beri bintang di GitHub",
      how: "Cara kerjanya",
      runsOn: "Berjalan di",
      shotAlt:
        "Dashboard openpurr Lite yang menampilkan pergerakan MRR selama 12 bulan, langganan aktif, churn, pelanggan baru, uji coba baru, dan uji coba aktif",
    },
    why: {
      eyebrow: "Untuk siapa",
      title: "Untuk developer aplikasi yang lebih suka menjalankannya sendiri",
      lede: "openpurr bekerja dengan SDK resmi tanpa modifikasi. Beralih cukup dimulai dengan mengganti satu URL, bukan menulis ulang kode pembelian Anda.",
      reasons: [
        {
          title: "Data Anda, server Anda",
          body: "Catatan pembelian, entitlement, dan kredensial store disimpan di database yang Anda jalankan, kueri, cadangkan, dan ekspor sendiri. Tidak ada layanan luar di antara aplikasi Anda dan pelanggan Anda.",
        },
        {
          title: "Tanpa bagi hasil pendapatan",
          body: "Tidak ada persentase dari pendapatan dan tidak ada biaya per transaksi. Edisi Lite dirancang agar muat di paket gratis Cloudflare, sehingga aplikasi kecil bisa menjalankannya tanpa biaya.",
        },
        {
          title: "Tidak bergantung pada vendor",
          body: "Kodenya open source dengan lisensi Apache 2.0. Baca kodenya, ubah sesuai kebutuhan, dan pindahkan antara Cloudflare dan cloud Anda sendiri.",
        },
      ],
    },
    how: {
      eyebrow: "Cara kerjanya",
      title: "Server Anda menggantikan posisi vendor",
      lede: "Aplikasi Anda tetap memakai Purchases SDK open source yang sudah disertakannya. SDK berkomunikasi dengan openpurr. openpurr berkomunikasi dengan store, menyimpan status langganan, dan memberi tahu backend Anda apa yang berubah.",
      flowLabel: "Alur permintaan",
      app: "Aplikasi Anda",
      sdkLicense: "Resmi, tanpa modifikasi, berlisensi MIT",
      sdkPlatforms: "iOS, Android, Flutter, atau React Native",
      coreWhere: "Di Cloudflare Workers atau cloud Anda sendiri",
      appStoreApi: "Server API dan notifikasi",
      playApi: "Developer API dan RTDN",
      backend: "Backend Anda",
      backendHooks: "Webhook bertanda tangan",
      steps: [
        {
          title: "Deploy",
          body: "Jalankan openpurr Lite di akun Cloudflare Anda sendiri. Setup terpandu, <code>pnpm run setup</code>, membuat database, men-deploy kedua Workers, dan membuat akun pemilik Anda.",
        },
        {
          title: "Arahkan SDK",
          body: "Atur URL proxy sebelum <code>configure</code>. Gunakan domain kustom milik Anda agar bisa pindah di kemudian hari.",
        },
        {
          title: "Hubungkan store",
          body: "Tambahkan kredensial store dan URL notifikasi Anda. Pemeriksaan setup, <code>openpurr doctor</code>, memverifikasinya dan menjelaskan cara memperbaiki apa pun yang masih kurang.",
        },
      ],
    },
    features: {
      eyebrow: "Apa yang dilakukannya",
      title: "Backend langganan, tanpa fitur tambahan yang tidak Anda pakai",
      items: [
        {
          title: "Pembelian dan notifikasi store",
          body: "Memvalidasi transaksi StoreKit 2 dan pembelian Google Play, mengembalikan CustomerInfo dan entitlement yang diharapkan SDK, serta menjaga perpanjangan, pengembalian dana, dan masa tenggang tetap terbaru dari notifikasi App Store dan Google Play.",
        },
        {
          title: "Webhook",
          body: "Mengirim event berformat RevenueCat ke backend Anda, ditandatangani dengan HMAC-SHA256 dan dicoba ulang selama sekitar 72 jam.",
        },
        {
          title: "Grafik",
          body: "16 grafik: pendapatan, MRR dan ARR, pergerakan MRR dan langganan, langganan aktif dan berbayar, status langganan, churn, uji coba dan konversi uji coba, pelanggan baru, pengembalian dana dan rasio pengembalian dana, serta pembelian satu kali. Filter berdasarkan aplikasi, store, produk, dan lingkungan, dengan pendapatan dikonversi ke USD.",
        },
        {
          title: "Eksperimen harga",
          body: "Tampilkan offering yang berbeda kepada pelanggan baru di aplikasi Anda, lalu bandingkan konversi dan pendapatan per pelanggan, beserta peluang setiap varian mengungguli kontrol. Tanpa update aplikasi.",
        },
        {
          title: "Autentikasi dan audit",
          body: "SDK key dan secret key, login operator dengan kode autentikator opsional, peran, token akses, dan log audit.",
        },
        {
          title: "Server MCP dan skill Claude",
          body: "Tanyakan kepada asisten AI mengapa seorang pelanggan memiliki atau tidak memiliki entitlement, cari data pembelian, atau minta dipandu melalui setup App Store Connect dan Play Console.",
        },
      ],
    },
    editions: {
      eyebrow: "Dua edisi",
      title: "Mulai dari kecil, naik kelas tanpa update aplikasi",
      lede: "Kedua edisi lolos rangkaian uji kesesuaian yang sama. Jika aplikasi Anda mengarah ke domain kustom milik Anda, pindah dari Lite ke Standard tidak memerlukan rilis aplikasi baru.",
      lite: {
        badge: "Untuk aplikasi indie",
        price: "$0",
        priceNote: "di paket gratis Cloudflare",
        items: [
          "TypeScript di Cloudflare Workers dan D1",
          "Ringan dan murah dijalankan",
          "Peringatan penggunaan sebelum Anda mencapai batas paket gratis",
        ],
      },
      standard: {
        badge: "Segera hadir",
        price: "Tagihan cloud Anda",
        priceNote: "tidak lebih",
        items: ["Go dan Postgres dalam container", "GCP atau AWS", "Untuk portofolio aplikasi yang lebih besar"],
      },
    },
    savings: {
      eyebrow: "Biaya",
      title: "Yang Anda simpan dibandingkan RevenueCat",
      lede: "Paket Pro RevenueCat gratis di bawah $2.500 pendapatan terlacak per bulan, lalu mengenakan 1% dari seluruhnya. Lite berjalan di paket gratis Cloudflare, dan di Workers Paid, mulai $5 per bulan, saat aplikasi Anda sudah melampauinya.",
      revenue: "Pendapatan bulanan",
      rc: "RevenueCat",
      op: "openpurr Lite",
      saved: "Hemat per tahun",
      perMonth: "{amount} per bulan",
      free: "Paket gratis Cloudflare",
      paid: "Cloudflare Workers Paid",
      chartLabel: "Biaya bulanan menurut pendapatan bulanan: biaya RevenueCat naik seiring pendapatan, biaya openpurr Lite tetap mendekati nol",
      gapLegend: "Yang Anda simpan",
      tableSummary: "Bandingkan di tingkat pendapatan lain",
      colRevenue: "Pendapatan bulanan",
      colRc: "RevenueCat, per bulan",
      colOp: "openpurr Lite, per bulan",
      colSaved: "Hemat per tahun",
      methodSummary: "Cara kami memperkirakannya",
      pricingLink: "Ke mana larinya 1% RevenueCat? →",
      method: [
        "RevenueCat: harga daftar paket Pro, 1% dari pendapatan bulanan terlacak mulai $2.500. Pendapatan terlacak menghitung paket tahunan dan pembelian sekali bayar pada bulan pembayarannya, jadi bisa lebih tinggi dari MRR. Akun besar bisa menegosiasikan harga Enterprise.",
        "openpurr Lite: harga Cloudflare untuk Workers dan D1. Kami mengasumsikan sekitar $1,50 pendapatan bulanan dan sekitar 10 permintaan SDK per hari per pengguna aktif harian. Dengan asumsi itu, 100.000 permintaan per hari di paket gratis cukup hingga sekitar {paidFrom} pendapatan bulanan, dengan ruang cadangan. Di atasnya kami menghitung Workers Paid: $5 per bulan, ditambah $0,30 per juta permintaan di atas 10 juta.",
        "Tidak termasuk: waktu Anda untuk menjalankannya. Biaya toko aplikasi sama saja di kedua pilihan.",
        "Harga diperiksa pada {date}. openpurr tidak berafiliasi dengan RevenueCat.",
      ],
    },
    fit: {
      eyebrow: "Terus terang saja",
      title: "Mungkin belum cocok untuk Anda",
      lede: "Jika Anda membutuhkan pembuat paywall, integrasi analitik pihak ketiga, atau kontrak dukungan, platform komersial sudah menyediakannya saat ini.",
      outTitle: "Belum termasuk untuk saat ini",
      tags: ["Paywall", "Event iklan", "Customer Center", "Mata uang virtual", "Penagihan web", "Amazon", "Integrasi analitik"],
    },
    roadmap: {
      eyebrow: "Roadmap",
      title: "Ke mana arahnya",
      lede: "Urutannya sudah pasti, tetapi tidak ada tanggal. Jika ada yang penting bagi Anda, sampaikan di sebuah issue.",
      status: { done: "Selesai", wip: "Sedang dikerjakan", planned: "Direncanakan", later: "Anda yang menentukan" },
      phases: [
        {
          phase: "Lite",
          items: [
            "Rilis terbaru: {version}",
            "Dirancang untuk paket gratis Cloudflare",
            "App Store dan Google Play",
            "Webhook, dashboard, dan admin",
            "Beberapa aplikasi dalam satu deployment",
            "Eksperimen harga",
            "Server MCP, CLI, dan skill Claude",
            "Berikutnya: pengujian di perangkat, lalu 1.0",
          ],
        },
        {
          phase: "Standard",
          items: [
            "Go dan Postgres dalam container",
            "GCP dulu, lalu AWS",
            "Rangkaian uji kesesuaian yang sama dengan Lite",
            "Pindah dari Lite tanpa update aplikasi",
          ],
        },
        {
          phase: "Dibentuk oleh komunitas",
          items: ["Identitas pengguna akhir yang terverifikasi", "Fitur tambahan Standard untuk tim yang lebih besar", "Aplikasi seluler untuk grafik, dengan peringatan saat pembelian berhenti", "Peringatan yang sama di Slack, Discord, dan Telegram", "Apa pun yang Anda minta di issue"],
        },
      ],
      more: "Baca roadmap lengkapnya (bahasa Inggris) →",
    },
    cta: {
      title: "Bantu membentuknya",
      body: "Bantuan yang paling berguna saat ini adalah masukan: asumsi yang keliru tentang SDK atau store, dan kasus khusus di dunia nyata seputar perpanjangan, pengembalian dana, dan masa tenggang.",
      star: "Beri bintang di GitHub",
      issue: "Buka issue",
      coffee: "Traktir kami kopi",
    },
  },
  faq: {
    eyebrow: "FAQ",
    title: "openpurr sebagai alternatif RevenueCat",
    lede: "Apa yang berubah saat Anda menjalankan backend langganan sendiri, dan apa yang tidak.",
    items: [
      {
        q: "Apa itu openpurr?",
        a: "openpurr adalah alternatif RevenueCat yang open source dan di-host sendiri. openpurr adalah backend untuk pembelian dalam aplikasi dan langganan yang bekerja dengan RevenueCat Purchases SDK resmi. openpurr memvalidasi pembelian App Store dan Google Play, melacak entitlement, menerima notifikasi store, mengirim webhook ke backend Anda, dan menampilkan grafik metrik langganan utama Anda, semuanya di infrastruktur yang Anda kendalikan.",
      },
      {
        q: "Apa bedanya openpurr dengan RevenueCat?",
        a: "RevenueCat adalah layanan komersial yang di-host, yang mengambil bagian dari pendapatan di atas batas paket gratisnya. openpurr adalah perangkat lunak yang Anda jalankan sendiri: catatan pembelian, entitlement, dan kredensial store Anda tersimpan di database Anda sendiri, dan tidak ada bagi hasil pendapatan maupun biaya per transaksi. Saat ini RevenueCat menawarkan lebih banyak fitur, seperti paywall dan integrasi analitik. openpurr berfokus pada backend langganan inti.",
      },
      {
        q: "Apakah saya harus menulis ulang kode pembelian untuk beralih dari RevenueCat?",
        a: "Tidak. openpurr bekerja dengan Purchases SDK resmi tanpa modifikasi. Anda mengatur URL proxy SDK ke server openpurr Anda sebelum memanggil configure, dan sisa kode pembelian Anda tetap sama. Arahkan ke domain kustom milik Anda agar nanti Anda bisa pindah server tanpa update aplikasi.",
      },
      {
        q: "Bagaimana cara memindahkan pelanggan saya yang sudah ada dari RevenueCat?",
        a: "Dengan mengimpornya. Minta ekspor migrasi dari RevenueCat, lalu openpurr import mengambil pembelian setiap pelanggan dari Apple dan Google dan memberikannya ke app user ID yang sama. Versi baru aplikasi Anda juga mengirim pembelian setiap pelanggan satu kali, dan kedua backend tetap sinkron selama pengguna memperbarui aplikasi, sehingga tidak ada yang kehilangan akses.",
        link: "Cara migrasi",
      },
      {
        q: "Bisakah saya pindah dari Adapty?",
        a: "Bisa, dengan update aplikasi. SDK Adapty tidak bisa diarahkan ke server lain, jadi update tersebut menggantinya dengan Purchases SDK, yang bekerja dengan openpurr. Produk Anda di store tetap sama. openpurr mengimpor pelanggan App Store Anda dari ekspor event Adapty, versi baru aplikasi Anda memindahkan pelanggan lainnya saat pertama kali dijalankan, dan kedua backend tetap sinkron selama pengguna memperbarui aplikasi.",
        link: "Baca panduan Adapty",
        linkTo: "adapty",
      },
      {
        q: "Platform dan store apa saja yang didukung openpurr?",
        a: "openpurr mendukung Purchases SDK untuk iOS, Android, Flutter, dan React Native, dengan pembelian dari App Store dan Google Play. Amazon dan penagihan web belum termasuk untuk saat ini.",
      },
      {
        q: "Berapa biaya openpurr?",
        a: "openpurr gratis dan open source dengan lisensi Apache 2.0. Anda hanya membayar infrastruktur tempatnya berjalan. Edisi Lite dirancang untuk berjalan di paket gratis Cloudflare, sehingga aplikasi kecil bisa menjalankannya tanpa biaya. Edisi Standard berjalan dalam container di cloud Anda sendiri, jadi biayanya adalah tagihan cloud Anda.",
      },
      {
        q: "Di mana data saya disimpan?",
        a: "Di database Anda sendiri. Edisi Lite memakai Cloudflare D1 di akun Cloudflare Anda. Edisi Standard memakai Postgres di GCP atau AWS. Anda bisa mengkueri, mencadangkan, dan mengekspornya, dan tidak ada layanan luar di antara aplikasi Anda dan pelanggan Anda.",
      },
      {
        q: "Apakah openpurr mengirim webhook seperti RevenueCat?",
        a: "Ya. openpurr mengirim event berformat RevenueCat ke backend Anda, ditandatangani dengan HMAC-SHA256 dan dicoba ulang selama sekitar 72 jam, sehingga handler webhook yang sudah ada hanya perlu sedikit perubahan atau tidak sama sekali.",
      },
      {
        q: "Apa yang dilakukan RevenueCat tetapi tidak dilakukan openpurr?",
        a: "Paywall, integrasi analitik pihak ketiga, Customer Center, mata uang virtual, penagihan web, Amazon, event iklan, dan kontrak dukungan komersial belum termasuk untuk saat ini. Eksperimen harga sudah tersedia bawaan. Jika Anda membutuhkan yang lainnya sekarang, platform komersial lebih cocok.",
      },
      {
        q: "Apakah openpurr siap untuk produksi?",
        a: "Belum. openpurr masih tahap awal: edisi Lite sedang dikerjakan dan edisi Standard menyusul. Ikuti roadmap di GitHub, dan buka issue jika ada yang penting bagi Anda.",
      },
      {
        q: "Apakah openpurr berafiliasi dengan RevenueCat?",
        a: "Tidak. openpurr adalah proyek open source independen yang tidak berafiliasi dengan atau didukung oleh RevenueCat, Inc. openpurr bekerja dengan Purchases SDK resmi dari RevenueCat, yang berlisensi MIT.",
      },
    ],
  },
  structured: {
    description:
      "Alternatif RevenueCat yang open source dan di-host sendiri: backend untuk pembelian dalam aplikasi dan langganan App Store dan Google Play yang bekerja dengan Purchases SDK resmi tanpa modifikasi. openpurr memvalidasi pembelian, melacak entitlement, menerima notifikasi store, mengirim webhook, dan menampilkan grafik metrik langganan.",
    subCategory: "Backend pembelian dalam aplikasi dan langganan",
    features: [
      "Bekerja dengan RevenueCat Purchases SDK resmi untuk iOS, Android, Flutter, dan React Native",
      "Validasi pembelian StoreKit 2 dan Google Play",
      "App Store Server Notifications V2 dan Google Play Real-time Developer Notifications",
      "Webhook berformat RevenueCat yang ditandatangani dengan HMAC-SHA256",
      "16 grafik langganan, termasuk MRR, churn, dan konversi uji coba",
      "Eksperimen harga pada offering, dengan hasil per varian",
      "Server MCP, CLI, dan skill Claude",
    ],
  },
};
