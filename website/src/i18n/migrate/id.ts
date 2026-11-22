// Indonesian copy of the migration page. Follows en.ts; see the notes there.
import type { MigrateDict } from "./en";

export const migrateId: MigrateDict = {
  meta: {
    title: "Panduan migrasi RevenueCat ke openpurr, langkah demi langkah",
    description:
      "Pindahkan aplikasi Anda dari RevenueCat ke openpurr, alternatif RevenueCat open source: tetap pakai Purchases SDK, impor semua pelanggan, dan akses mereka aman.",
    ogImageAlt:
      "Pindah dari RevenueCat ke openpurr tanpa kehilangan satu pelanggan pun: tetap pakai Purchases SDK, impor setiap pelanggan, dan versi aplikasi lama tetap berfungsi.",
  },
  hero: {
    crumb: "Migrasi dari RevenueCat",
    eyebrow: "Panduan migrasi",
    headline: "Pindah dari RevenueCat ke openpurr tanpa kehilangan satu pelanggan pun",
    lede: "Tetap pakai Purchases SDK yang sudah digunakan aplikasi Anda. Impor pelanggan yang sudah ada dari ekspor RevenueCat: openpurr mengambil sendiri setiap pembelian dari Apple dan Google. Versi aplikasi lama tetap berfungsi selama pengguna memperbarui aplikasi.",
    guide: "Baca panduan langkah demi langkah (bahasa Inggris)",
    steps: "Lihat langkah-langkahnya",
    updated: "Diperbarui {date}",
  },
  summary: {
    title: "Ringkasnya",
    items: [
      "openpurr adalah alternatif RevenueCat open source yang di-host sendiri. openpurr bekerja dengan RevenueCat Purchases SDK resmi tanpa modifikasi.",
      "Aplikasi Anda menambahkan satu baris (URL proxy SDK) dan satu panggilan <code>syncPurchases</code> satu kali. Sisa kode pembelian Anda tetap sama.",
      "<code>openpurr import</code> memindahkan pelanggan yang sudah ada dari ekspor RevenueCat. Pembeliannya sendiri diambil dari Apple dan Google, bukan disalin.",
      "Aplikasi App Store bisa memakai Scheduled Data Export dari RevenueCat. Google Play membutuhkan ekspor migrasi dari RevenueCat Support, satu-satunya ekspor yang berisi purchase token.",
      "Kedua backend tetap terbarui sampai sebagian besar pengguna sudah memperbarui aplikasi, sehingga tidak ada yang kehilangan akses.",
      "Di paket gratis Cloudflare, impor menangani sekitar 2.500 pelanggan per hari. Di Workers Paid, impor besar selesai dalam hitungan jam.",
    ],
  },
  how: {
    eyebrow: "Cara kerjanya",
    title: "Cara kerja migrasi dari RevenueCat",
    lede: "openpurr tidak menyalin catatan pembelian dari RevenueCat. openpurr hanya perlu tahu siapa pemilik setiap pembelian, lalu bertanya ke store, persis seperti saat aplikasi Anda mengirim pembelian.",
    ways: [
      {
        title: "Impor",
        body: "Ekspor RevenueCat menunjukkan app user mana yang memiliki pembelian store yang mana. <code>openpurr import</code> menanyakan setiap pembelian ke Apple dan Google, lalu mencatat jawaban store untuk pengguna tersebut. Semua pelanggan dipindahkan sekaligus, termasuk mereka yang tidak pernah membuka aplikasi lagi.",
      },
      {
        title: "Update aplikasi",
        body: "Versi baru mengarahkan Purchases SDK ke openpurr dan mengirim pembelian setiap pelanggan satu kali dengan <code>syncPurchases</code>. Cara ini menjangkau siapa pun yang terlewat oleh ekspor, dan siapa pun yang membeli setelah ekspor dibuat.",
      },
      {
        title: "Dua backend, untuk sementara",
        body: "Versi aplikasi lama tetap berkomunikasi dengan RevenueCat sampai pengguna memperbarui aplikasi. RevenueCat meneruskan notifikasi Apple ke openpurr, dan subscription Pub/Sub kedua melakukan hal yang sama untuk Google, sehingga keduanya tetap terbarui.",
      },
    ],
  },
  app: {
    eyebrow: "Di aplikasi Anda",
    title: "Apa yang berubah di aplikasi Anda",
    lede: "Atur URL proxy sebelum configure, dan kirim pembelian setiap pelanggan satu kali. Dua perubahan yang sama berlaku di Android, Flutter, dan React Native; panduan berisi kode untuk masing-masing.",
    codeLabel: "Contoh Swift: URL proxy dan sinkronisasi satu kali",
    proxyComment: "Sebelum configure(): satu-satunya baris yang ditambahkan kebanyakan aplikasi",
    syncComment: "Sekali per instalasi: kirim pembelian pelanggan ini ke openpurr",
  },
  import: {
    eyebrow: "Impor",
    title: "Mengimpor pelanggan dari RevenueCat",
    lede: "CLI openpurr membaca kolom RevenueCat apa adanya: app user ID, ID transaksi App Store, purchase token Google Play, dan atribut seperti <code>$email</code>.",
    codeLabel: "Terminal: mengimpor ekspor RevenueCat",
    dryRunComment: "Cek baris pertama: bertanya ke Apple dan Google, tidak menulis apa pun",
    importComment: "Impor semua. Hentikan kapan saja; jalankan lagi untuk melanjutkan.",
    safeguards: [
      ["Tidak ada yang kehilangan akses", "Pembelian yang sudah dikirim aplikasi untuk seorang pelanggan tetap menjadi miliknya; impor tidak pernah memindahkannya."],
      ["Tidak ada webhook ganda", "Pembelian yang diimpor bukan pembelian baru, jadi openpurr tidak mengirim event untuknya."],
      ["Grafik yang jujur", "Pelanggan yang diimpor diberi tanggal sesuai pembelian pertamanya, bukan dihitung sebagai pelanggan baru pada hari impor."],
      ["Aplikasi Anda tetap berjalan", "Di paket gratis Cloudflare, impor berhenti di 90% batas harian dan melanjutkan keesokan harinya."],
      ["Hentikan dan lanjutkan", "Progres disimpan. Mengimpor baris yang sama dua kali tidak mengubah apa pun, jadi ekspor yang lebih baru bisa dijalankan lagi."],
      ["Coba dulu", "Dry run bertanya ke store dan melaporkan apa yang akan terjadi, tanpa menulis apa pun."],
    ] as [string, string][],
  },
  steps: {
    eyebrow: "Langkah demi langkah",
    title: "Cara migrasi dari RevenueCat dalam tujuh langkah",
    lede: "Kedua backend tetap berjalan sampai Anda siap beralih, sehingga pelanggan di versi aplikasi lama tetap memiliki akses.",
    items: [
      {
        title: "Siapkan openpurr",
        body: "Deploy openpurr Lite ke akun Cloudflare Anda, berikan akses API App Store dan Google Play, lalu buat ulang produk, entitlement, dan offering Anda dengan identifier yang sama. Anda bahkan bisa tetap memakai public SDK key RevenueCat Anda.",
      },
      {
        title: "Jaga kedua backend tetap terbarui",
        body: "Atur openpurr sebagai Apple Server Notification Forwarding URL di RevenueCat, dan tambahkan push subscription openpurr ke topik notifikasi Play Anda.",
      },
      {
        title: "Dapatkan ekspor Anda",
        body: "Khusus App Store: Scheduled Data Export dari RevenueCat sudah berisi yang dibutuhkan. Untuk Google Play, minta ekspor migrasi ke RevenueCat Support, karena hanya ekspor itu yang berisi purchase token. Panduan berisi contoh permintaan yang bisa Anda salin.",
      },
      { title: "Impor", body: "Jalankan <code>openpurr import</code>, dengan dry run terlebih dahulu. Masalah pada baris tertentu masuk ke laporan dan tidak menghentikan impor." },
      { title: "Rilis update aplikasi", body: "Tambahkan URL proxy dan <code>syncPurchases</code> satu kali. Rilis setelah impor selesai." },
      {
        title: "Periksa",
        body: "<code>openpurr doctor</code> memeriksa setup. Cari pelanggan yang Anda kenal, dan bandingkan langganan aktif dengan grafik RevenueCat.",
      },
      {
        title: "Selesaikan peralihan",
        body: "Setelah sebagian besar pelanggan memperbarui aplikasi, arahkan Apple dan Google langsung ke openpurr, aktifkan webhook openpurr, dan matikan webhook RevenueCat.",
      },
    ],
    source: "Sumber:",
    sourceNotifications: "RevenueCat: notifikasi server Apple (bahasa Inggris)",
    sourceExports: "RevenueCat: mengekspor data atau bermigrasi (bahasa Inggris)",
    more: "Semua perintah dan pengaturan ada di panduan lengkap (bahasa Inggris) →",
  },
  moves: {
    eyebrow: "Apa yang dipindahkan",
    title: "Apa yang ikut pindah dari RevenueCat, dan apa yang tidak",
    rows: [
      ["Langganan dan pembelian, beserta perpanjangan, pengembalian dana, masa tenggang, dan kedaluwarsa", "Ya, diambil dari Apple dan Google"],
      ["Siapa pemilik setiap pembelian", "Ya, dari ekspor RevenueCat"],
      ["App user ID, termasuk yang anonim", "Ya, tanpa perubahan"],
      ["Atribut pelanggan ($email, $displayName, dan atribut Anda sendiri)", "Ya, dari Audience export"],
      ["Produk, entitlement, dan offering", "Anda membuatnya ulang, dengan identifier yang sama"],
      ["Riwayat grafik sebelum peralihan", "Sebagian: simpan CSV grafik RevenueCat sebagai arsip Anda"],
      ["Eksperimen", "Anda membuatnya ulang: openpurr menjalankan eksperimen harga pada offering Anda"],
      ["Paywall, integrasi, Customer Center", "Tidak: openpurr tidak memilikinya"],
    ] as [string, string][],
  },
  faq: {
    eyebrow: "FAQ",
    title: "FAQ migrasi dari RevenueCat",
    items: [
      {
        q: "Apakah saya harus mengubah kode pembelian saya?",
        a: "Tidak. openpurr bekerja dengan RevenueCat Purchases SDK resmi tanpa modifikasi. Update aplikasi menambahkan URL proxy sebelum configure, dan satu panggilan syncPurchases satu kali. getOfferings, purchase, restorePurchases, logIn, dan lainnya tetap seperti semula.",
      },
      {
        q: "Apakah saya butuh bantuan RevenueCat untuk migrasi?",
        a: "Untuk aplikasi App Store, tidak: Scheduled Data Export dari RevenueCat sudah berisi ID transaksi yang dibutuhkan openpurr. Untuk Google Play, ya: menurut dokumentasi RevenueCat, hanya ekspor migrasi yang disiapkan oleh RevenueCat Support yang berisi purchase token yang dibutuhkan Google.",
      },
      {
        q: "Bagaimana dengan pelanggan yang tidak pernah memperbarui aplikasi?",
        a: "Impor mencakup mereka: pembelian mereka diambil dari Apple dan Google dan diberikan ke app user ID yang sama. Selama mereka masih memakai versi aplikasi lama, versi tersebut berkomunikasi dengan RevenueCat, karena itulah kedua backend tetap terbarui sampai sebagian besar pengguna memperbarui aplikasi.",
      },
      {
        q: "Berapa lama proses impor?",
        a: "Setiap pelanggan membutuhkan sekitar 30 penulisan baris database. Di paket gratis Cloudflare, itu berarti sekitar 2.500 pelanggan per hari, dan impor berhenti sendiri di batas harian lalu melanjutkan keesokan harinya. Di Workers Paid ($5 per bulan), impor besar selesai dalam hitungan jam.",
      },
      {
        q: "Apakah data saya disalin dari RevenueCat?",
        a: "Hanya pemetaan app user ke pembelian store, ditambah atribut jika Anda mengimpornya. Pembeliannya sendiri datang langsung dari Apple dan Google, sehingga openpurr mencatat kondisi terkini menurut store, termasuk perpanjangan dan pengembalian dana.",
      },
    ],
  },
  cta: {
    title: "Siap beralih?",
    body: "Panduan ini membahas setiap langkah. Jika ada bagian setup Anda yang tidak cocok, buka issue: migrasi menentukan apa yang dibangun berikutnya.",
    guide: "Baca panduannya (bahasa Inggris)",
    github: "openpurr di GitHub",
    issue: "Buka issue",
  },
};
