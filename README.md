# Arus Money Tracker

Arus adalah PWA untuk pencatatan keuangan pribadi dalam rupiah. **Masuk dengan Google** dari layar awal untuk membuka data rekening dan transaksi yang disimpan per akun. Setelah login dan sinkronisasi pertama, aplikasi dapat memakai salinan data akun di perangkat saat koneksi terputus.

## Jalankan lokal

Dari direktori ini, jalankan `node dev.mjs`, lalu buka `http://127.0.0.1:4173`. Node.js diperlukan untuk menjalankan server lokal. Frontend disajikan langsung dari `dist/`.

## Aktifkan sinkronisasi dan login Google

1. Siapkan proyek Supabase. Jalankan migrasi `supabase/migrations/202611180001_arus.sql` melalui SQL Editor atau `supabase db push` dari proyek yang sudah ditautkan.
2. Buat kredensial **OAuth Client ID** bertipe **Web application** di Google Cloud. Masukkan origin Arus seperti `https://arus-money-tracker.lovabledish4.chatgpt.site` pada **Authorized JavaScript origins**. Tambahkan `https://<project-ref>.supabase.co/auth/v1/callback` pada **Authorized redirect URIs**.
3. Aktifkan penyedia Google di Supabase Auth dan isi Client ID serta Client Secret di sana. Di **Auth → URL Configuration**, atur **Site URL** ke alamat Arus. Tambahkan alamat lokal ke daftar redirect jika akan menguji login lokal. Jika consent screen Google dalam status Testing, tambahkan akun penguji yang diperlukan.
4. Isi `supabaseUrl` dan `supabaseKey` di `dist/config.mjs` memakai URL proyek dan **publishable key** (atau legacy anon key). Publikasikan ulang frontend. Simpan service-role key dan OAuth Client Secret di layanan backend.
5. Jika masih memiliki catatan lokal di versi lama, unduh backup JSON dari versi itu. Masuk dengan Google di versi baru, lalu pulihkan file melalui Pengaturan. Pemulihan mengganti data akun aktif dan meminta konfirmasi.

## Aktifkan Google Drive

Aktifkan **Google Drive API** di proyek Google Cloud yang sama. Tambahkan `https://www.googleapis.com/auth/drive.file` ke konfigurasi izin Google dan isi `googleClientId` di `dist/config.mjs`. Pengguna memberi izin dari Pengaturan saat menyimpan atau memulihkan file. File JSON tersimpan di Drive pengguna.

## Aktifkan Telegram

1. Buat bot dengan `@BotFather`. Isi `telegramUsername` di `dist/config.mjs` menggunakan username tanpa `@`.
2. Deploy Supabase Edge Function dengan `supabase functions deploy telegram --no-verify-jwt`. Endpoint melakukan pemeriksaan pengguna Supabase untuk permintaan dari aplikasi dan memeriksa secret header untuk webhook Telegram.
3. Atur `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`, dan `ARUS_ORIGINS` sebagai secrets di Edge Functions. `ARUS_ORIGINS` berisi origin Arus, dipisahkan dengan koma jika ada beberapa origin. Gunakan secret webhook acak yang terdiri dari huruf, angka, `-`, dan `_`.
4. Daftarkan webhook dengan Telegram Bot API `setWebhook`. Kirim JSON dengan `url` bernilai `https://<project-ref>.supabase.co/functions/v1/telegram`, `secret_token` yang sama dengan secret webhook, dan `allowed_updates` berisi `["message", "callback_query"]`. Simpan token BotFather di secret store atau variabel lingkungan saat mendaftarkan webhook.
5. Masuk ke Arus, tambah rekening dan kategori, lalu pilih **Pengaturan → Hubungkan Telegram**. Di percakapan privat, tekan **Start**, kirim `makan 25000 cash`, dan pilih **Simpan**. Pengeluaran akan muncul setelah aplikasi menyinkronkan data.

## Format data

- CSV berisi transaksi yang sesuai dengan filter. XLSX juga menyertakan ringkasan dan saldo rekening saat ini.
- Backup JSON menyimpan semua transaksi, rekening, kategori, dan logo kustom. Logo kustom diunggah dari PNG, JPG, atau WebP berukuran maksimal 5 MB dan diperkecil sebelum disinkronkan. Simpan file backup di lokasi yang hanya bisa Anda akses.
- Saldo dihitung dari saldo awal dan transaksi sampai hari ini. Perhitungan periode harian memakai zona waktu Asia/Jakarta.
- Logo katalog berasal dari [idn-finlogos](https://github.com/hafidznoor/idn-finlogos), dikurasi oleh Hafidz Noor Fauzi, dan digunakan tanpa modifikasi berdasarkan lisensi [CC BY-NC 4.0](https://creativecommons.org/licenses/by-nc/4.0/). Logo BCA merupakan merek terdaftar milik PT Bank Central Asia Tbk. Merek lainnya tetap milik pemilik masing-masing.
"# arus" 
