# Tutorial aktivasi Arus Money Tracker

Ikuti urutan Supabase dan login Google, Google Drive, lalu Telegram. Anda bisa mengerjakan ketiganya lewat dashboard. Pendaftaran webhook Telegram memakai satu blok PowerShell.

Alamat produksi Arus adalah `https://arus-eta.vercel.app`. Gunakan domain Vercel Anda sendiri jika membuat deployment terpisah.

## 1. Supabase dan login Google

1. Di [Dashboard Supabase](https://supabase.com/dashboard), klik **New project**. Pilih organisasi, beri nama `arus`, dan simpan password database di tempat aman.
2. Setelah proyek siap, klik **Connect**. Catat **Project URL** (`https://….supabase.co`) dan **Publishable key** (`sb_publishable_…`). [Panduan API key](https://supabase.com/docs/guides/getting-started/api-keys)
3. Buka **SQL Editor → New query**. Jalankan [migrasi tabel Arus](supabase/migrations/202611180001_arus.sql) satu kali, lalu jalankan [migrasi menu Telegram](supabase/migrations/202611180002_telegram_transactions.sql). Jika tabel Arus sudah pernah dibuat, cukup jalankan migrasi menu Telegram. Jalankan juga [migrasi tinjau kategori Telegram](supabase/migrations/202611180003_telegram_category_review.sql). Buka **Table Editor** untuk mengecek tabel `ledgers`.
4. Buat proyek di [Google Cloud Console](https://console.cloud.google.com/). Di **Google Auth Platform → Branding**, isi nama aplikasi `Arus` dan email Anda. Untuk akun Gmail pribadi, pilih **Audience → External**. Jika aplikasi berstatus **Testing**, tambahkan email yang akan dipakai di **Test users**. [Panduan consent screen](https://developers.google.com/workspace/guides/configure-oauth-consent)
5. Buka **Google Auth Platform → Clients → Create client**, lalu pilih **Web application**. Isi kolom berikut dan simpan. Catat **Client ID** dan **Client Secret**.

   | Kolom | Isi |
   |---|---|
   | **Authorized JavaScript origins** | `https://arus-eta.vercel.app` |
   | **Authorized redirect URIs** | Salin URL callback dari pengaturan provider Google di Supabase. Biasanya `https://<project-ref>.supabase.co/auth/v1/callback`. |

6. Di Supabase, buka **Authentication → Sign In / Providers → Google**. Aktifkan provider Google, masukkan **Client ID** dan **Client Secret**, lalu simpan. Di **Authentication → URL Configuration**, isi **Site URL** dengan alamat Arus di atas. [Panduan login Google](https://supabase.com/docs/guides/auth/social-sign-in/auth-google)

## 2. Google Drive

1. Gunakan **proyek Google Cloud yang sama**. Buka **APIs & Services → Library**, cari **Google Drive API**, lalu klik **Enable**. [Google Drive API Library](https://console.cloud.google.com/apis/library/drive.googleapis.com)
2. Di **Google Auth Platform → Data Access → Add or remove scopes**, tambahkan `https://www.googleapis.com/auth/drive.file`, lalu simpan. Gunakan **Client ID yang sama** dari bagian pertama. Arus akan meminta izin saat fitur backup Drive digunakan. [Panduan izin Google Drive](https://developers.google.com/workspace/drive/api/guides/api-specific-auth)

## 3. Bot Telegram

1. Buka [@BotFather](https://t.me/BotFather) di Telegram dan kirim `/newbot`. Ikuti petunjuk untuk mengisi nama dan username yang berakhiran `bot`. Simpan token yang diberikan. [Panduan bot Telegram](https://core.telegram.org/bots/tutorial)
2. Di Supabase, buka **Edge Functions → Deploy a new function → Via Editor**. Beri nama `telegram`, ganti seluruh isi `index.ts` dengan [kode Edge Function Arus](supabase/functions/telegram/index.ts), lalu klik **Deploy function**.
3. Di tab **Details** fungsi `telegram`, matikan **Verify JWT**. Telegram mengirim secret webhook, dan kode Arus memeriksanya. Kode yang sama memvalidasi sesi pengguna untuk permintaan dari aplikasi. [Panduan deploy](https://supabase.com/docs/guides/functions/quickstart-dashboard) · [Pengaturan Verify JWT](https://supabase.com/kb/troubleshooting/edge-function-401-error-response)
4. Jalankan `[guid]::NewGuid().ToString('N')` sekali di PowerShell untuk membuat secret webhook. Buka **Edge Functions → Secrets** di Supabase dan tambahkan tiga nilai berikut. [Panduan Supabase Secrets](https://supabase.com/docs/guides/functions/secrets)

   | Nama | Nilai |
   |---|---|
   | `TELEGRAM_BOT_TOKEN` | Token dari BotFather |
   | `TELEGRAM_WEBHOOK_SECRET` | Kode acak yang baru dibuat |
   | `ARUS_ORIGINS` | `https://arus-eta.vercel.app` |

5. Tempel blok berikut ke **PowerShell**, lalu jawab tiga prompt. Gunakan **Project URL Supabase** dari bagian pertama dan **secret webhook** yang sama persis dengan yang disimpan di Supabase. Hasil sukses menampilkan `ok : True`. [Dokumentasi setWebhook](https://core.telegram.org/bots/api#setwebhook)

   ```powershell
   $arusUrl = (Read-Host 'Project URL Supabase').Trim().TrimEnd('/')
   $arusToken = [System.Net.NetworkCredential]::new('', (Read-Host 'Token BotFather' -AsSecureString)).Password
   $arusSecret = [System.Net.NetworkCredential]::new('', (Read-Host 'Secret webhook' -AsSecureString)).Password

   try {
       Invoke-RestMethod -Method Post `
           -Uri "https://api.telegram.org/bot$arusToken/setWebhook" `
           -ContentType 'application/json' `
           -Body (@{
               url = "$arusUrl/functions/v1/telegram"
               secret_token = $arusSecret
               allowed_updates = @('message', 'callback_query')
           } | ConvertTo-Json -Compress) -ErrorAction Stop
   } catch {
       Write-Warning 'Pendaftaran gagal. Periksa koneksi, Project URL, token, dan secret webhook.'
   } finally {
       Remove-Variable -Name arusToken, arusSecret
   }
   ```

## Hubungkan dan uji Arus

Kirim **Project URL Supabase**, **Publishable key**, **Google OAuth Client ID**, dan **username bot tanpa `@`** ke Codex agar konfigurasi Arus bisa diisi dan dipublikasikan ulang. Simpan **Client Secret**, **token bot**, **secret webhook**, dan **password database** di pengaturan layanan terkait atau pengelola kata sandi.

Setelah publikasi selesai, buka [Arus Money Tracker](https://arus-eta.vercel.app/) dan uji satu per satu.

1. **Login.** Pilih **Masuk dengan Google** dari layar awal. Gunakan akun yang ditambahkan sebagai penguji jika OAuth masih berstatus **Testing**.
2. **Drive.** Pilih **Pengaturan → Google Drive → Simpan ke Drive**, beri izin, lalu cek apakah file `arus-backup-YYYY-MM-DD.json` muncul di Drive.
3. **Telegram.** Tambahkan rekening **Cash** di Arus. Pilih **Pengaturan → Hubungkan Telegram** jika akun belum tertaut. Di chat privat, kirim `/menu`, pilih **Catat Pengeluaran**, lalu balas `makan tunai 25.000` dan tekan **Simpan**. Coba juga `kopi tunai 25.000` saat kategori Kopi belum ada, pilih **Simpan untuk ditinjau**, lalu kategorikan lewat **Transaksi → Perlu kategori**. Untuk menguji pemasukan, pilih **Catat Pemasukan**, lalu balas `tunai 100.000` dan simpan. Pilih **Saldo** untuk mengecek hasilnya. Contoh singkat lainnya ada di [panduan Arus](README.md#cara-menggunakan-telegram).
