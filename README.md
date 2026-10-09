# Schedule Personil + Cover Shift

Versi Google Apps Script + Google Sheets (tanpa Supabase). Antarmuka web responsif untuk Android.

## Isi
- `Code.gs`: backend, autentikasi PIN, validasi jadwal, persetujuan cover, audit log.
- `Index.html`: web app, pratinjau impor Excel/CSV dan deteksi format otomatis.
- `appsscript.json`: manifest Apps Script.

## Penting
Kode ini disiapkan untuk spreadsheet:
https://docs.google.com/spreadsheets/d/1D9VyUWlNaQC0ktI74ebL7lUFjdIjX36r20nbf395HW0/

Belum ada deployment otomatis dari GitHub. File harus dimasukkan ke proyek Google Apps Script yang terhubung ke spreadsheet, lalu dideploy sebagai Web App.

## Setup
1. Buka spreadsheet di atas dengan akun Google pemiliknya.
2. Dari menu spreadsheet pilih **Ekstensi → Apps Script**. Jika menu tidak tampak di Android, buka Chrome menu ⋮ lalu aktifkan **Situs desktop**.
3. Ganti isi file `Code.gs` dengan kode dari repositori ini.
4. Tambahkan file HTML bernama **Index** (tanpa ekstensi) lalu salin isi `Index.html`.
5. Di Project Settings, pastikan zona waktu sesuai lokasi operasional (misalnya Asia/Jakarta).
6. Simpan proyek. Jalankan fungsi `setupApp` dari editor, berikan izin yang diminta.
7. Jalankan `setAdminPinFromEditor`, lalu buat PIN admin minimal 8 karakter. PIN tidak disimpan sebagai teks biasa.
8. Klik **Deploy → New deployment → Web app**. Pilih **Execute as: Me**. Untuk akses, pilih opsi yang sesuai kebijakan organisasi. Jika memilih akses publik, URL dapat dibuka siapa saja; PIN tetap diperlukan, tetapi jangan menganggap akses publik sebagai pembatasan jaringan.
9. Salin URL Web App dan buka di Chrome Android.

## Struktur sheet yang dibuat
- `PERSONNEL`: master personel.
- `BASE_SCHEDULE`: jadwal dasar, kunci personel + tanggal.
- `COVER_REQUESTS`: permintaan, keputusan, dan riwayat cover.
- `USERS`: akun login. Menambah personel tidak otomatis membuat akun.
- `AUDIT_LOG`: catatan tindakan penting.

## Impor Excel
Dukungan format daftar `Nama,Tanggal,Shift` dan format matriks dengan nama personel di kolom pertama dan tanggal sebagai header. Semua baris divalidasi sebelum penulisan. Bila ada kesalahan, batch tidak ditulis. Jadwal yang diimpor diperbarui pada `BASE_SCHEDULE`; data cover disimpan terpisah di `COVER_REQUESTS`.

## Catatan sebelum operasional
Ini adalah starter build yang perlu diuji di spreadsheet salinan terlebih dahulu. Uji login admin/personel, impor file nyata, konflik jadwal, approval cover, dan akses dari beberapa ponsel sebelum dipakai operasional. Untuk lingkungan kerja sensitif, gunakan akun Google organisasi dan batasi akses Web App sesuai kebijakan perusahaan.
