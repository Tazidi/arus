# Arus Money Tracker

Arus adalah aplikasi pencatatan keuangan pribadi dalam rupiah. Masuk dengan Google untuk mengakses rekening, transaksi, dan laporan Anda. Data dipisahkan per akun.

**[Buka Arus di Vercel](https://arus-eta.vercel.app/)**

## Fitur

- Catat pemasukan, gaji, pengeluaran, dan transfer antar rekening. Nominal seperti `10000` otomatis tampil sebagai `10.000` saat diketik.
- Kelola rekening bank, e-wallet, uang tunai, dan tabungan. Pilih logo dari katalog atau tambahkan nama penyedia dan logo sendiri.
- Pilih kategori pengeluaran seperti **Makan** atau **Transportasi**. Kelompok seperti **Kebutuhan** dan **Keinginan** tersedia sebagai filter opsional di ringkasan.
- Pilih tema **Sistem**, **Gelap**, atau **Terang** dan bahasa **Indonesia** atau **Inggris** di **Pengaturan → Tampilan**.
- Lihat total saldo, sisa gaji, dan grafik arus kas mingguan untuk bulan terpilih atau bulanan untuk tahun terpilih. Klik grafik untuk melihat transaksi yang terkait.
- Catat pinjaman dan tagihan bulanan di menu **Tagihan**. Lihat sisa pinjaman, jatuh tempo, dan riwayat pembayaran. Pembayaran yang dicatat masuk ke transaksi pengeluaran.
- Sinkronkan data lewat Supabase. Aplikasi dapat membuka salinan data akun saat offline setelah login dan sinkronisasi pertama.
- Ekspor transaksi ke Excel atau CSV. Unduh backup JSON, atau simpan dan pulihkan backup melalui Google Drive.
- Catat transaksi, cek saldo, dan lihat ringkasan bulanan dari menu bot Telegram.

## Cara menggunakan web

1. Buka [Arus](https://arus-eta.vercel.app/) dan pilih **Masuk dengan Google**.
2. Buka **Rekening → Tambah rekening**, pilih jenis rekening, lalu isi nama dan saldo awal. Untuk penyedia baru, pilih **Ketik penyedia sendiri**. Logo kustom mendukung PNG, JPG, dan WebP hingga 5 MB.
3. Pilih **Tambah transaksi**, lalu isi nominal dan jenis transaksi. Tandai pemasukan sebagai gaji atau pengeluaran sebagai **Dari gaji** jika ingin mengikutkannya dalam perhitungan sisa gaji.
4. Buka **Ringkasan** untuk memilih periode dan menelusuri grafik. Buka **Transaksi** untuk memfilter data dan mengekspornya, atau **Pengaturan** untuk membuat backup.

## Cara menggunakan Telegram

Di Arus, buka **Pengaturan → Hubungkan Telegram**, lalu tekan **Start** di chat pribadi dengan [@Arus1_bot](https://t.me/Arus1_bot). Setelah tertaut, ketik `/menu`. Misalnya, pilih **Catat Pemasukan**, balas pesan bot dengan `BCA 500.000`, lalu tekan **Simpan** pada pratinjau.

Jika kategori belum dikenali tetapi rekening dan nominal jelas, pilih **Pilih kategori** atau **Simpan untuk ditinjau** di Telegram. Untuk meninjau nanti, buka **Transaksi → Perlu kategori** di web dan simpan transaksi dengan kategori yang dipilih.

| Untuk | Contoh pesan langsung |
|---|---|
| Pengeluaran | `makan tunai 25.000` |
| Pengeluaran dari gaji | `makan tunai 25.000 dari gaji` |
| Pemasukan | `pemasukan BCA 500.000` |
| Gaji | `gaji BCA 8.000.000` |
| Catat transfer antar rekening | `transfer BCA > tunai 100.000` |
| Saldo per rekening | `/saldo` |
| Ringkasan bulan ini | `/ringkasan` |

Gunakan nama rekening dan kategori yang ada di Arus. Transaksi masuk setelah Anda menekan **Simpan**. Saldo dan ringkasan bot mengikuti data di Supabase.

## Pengembangan dan deployment

- Jalankan `node dev.mjs` dari direktori proyek, lalu buka `http://127.0.0.1:4173`. Jalankan `node --test` untuk menguji proyek.
- Frontend statis ada di `dist/`. Pengaturan Vercel menggunakan preset **Other**, direktori output `dist`, dan perintah build kosong.
- Untuk mengaktifkan Supabase, Google Drive, dan Telegram pada instalasi baru, ikuti [tutorial aktivasi](TUTORIAL.md). Untuk memperbarui bot yang sudah aktif, jalankan [migrasi transaksi Telegram](supabase/migrations/202611180002_telegram_transactions.sql) jika belum dipasang. Terbitkan frontend terbaru terlebih dahulu, lalu jalankan [migrasi tinjau kategori Telegram](supabase/migrations/202611180003_telegram_category_review.sql) dan terapkan ulang [Edge Function telegram](supabase/functions/telegram/index.ts) di Supabase.

Logo katalog berasal dari [idn-finlogos](https://github.com/hafidznoor/idn-finlogos), dikurasi oleh Hafidz Noor Fauzi dan digunakan tanpa modifikasi dengan lisensi [CC BY-NC 4.0](https://creativecommons.org/licenses/by-nc/4.0/). Logo BCA merupakan merek terdaftar milik PT Bank Central Asia Tbk. Merek lainnya tetap milik pemilik masing-masing.
