SCHEDULE PERSONIL + COVER SHIFT — ENGINE V2 (upgrade arsitektur)

ISI PAKET
- index.html            Frontend (UI lama dipertahankan; kini hanya MENAMPILKAN hasil server).
- Code.gs               Backend API Apps Script (auth, data, impor, cover, audit).
- Engine.gs             BARU. Mesin jadwal murni: rotasi 12 hari, cover, konflik, coverage, rencana impor, rantai audit.
                        Satu sumber kebenaran, dipakai backend dan diuji langsung di Node.
- tests/run_tests.js    112 pengujian otomatis (Node >= 16, tanpa dependensi).
- tests/hasil_tes.txt   Keluaran asli eksekusi tes. tests/hasil_uji_mutasi.txt: bukti tes menangkap bug (11/11 mutan tertangkap).

TEMUAN PADA KODE ASLI (ZIP ROTASI_FIX)
1. KRITIS: validIsoDate_() dipanggil di apiImportSchedule dan apiRequestCover tetapi TIDAK PERNAH didefinisikan
   (README lama mengklaim sudah ada). Impor dan pengajuan cover akan ReferenceError di produksi. Diperbaiki.
2. Mesin rotasi hanya ada di browser. Server tidak tahu jadwal efektif, jadi cover bisa disetujui untuk shift
   yang salah, pengganti yang sedang bertugas, atau pemilik yang sedang Off. Kini mesin ada di server.
3. Impor Excel bermasalah: sel tanggal Excel dibaca sebagai teks m/d/yy (tahun 2 digit) sehingga matriks gagal,
   dan "02/03/2026" diam-diam dibaca bulan/hari. Kini: sel Date dibaca langsung, orientasi hari/bulan dideteksi
   dari isi file (ambigu = hari/bulan), tahun 2 digit didukung, dan ada fallback CSV tanpa library Excel.
4. Impor menulis baris ke-N satu per satu (appendRow) dan bisa menimpa jadwal historis tanpa konfirmasi/cadangan.
5. Tidak ada kunci pada pengajuan/review cover/simpan personel: dua admin bersamaan bisa menghasilkan data ganda.
6. Audit log bisa diubah/dihapus tanpa jejak; login tanpa batas percobaan; setupApp() dijalankan di tiap login.
7. Edit personel tanpa mengisi jabatan menghapus jabatan lama.

YANG BARU
- Rotasi: master 1-12 Okt 2026 + siklus 12 hari, dihitung di server (aritmetika UTC, bebas zona waktu).
  masterStart/cycleLength sengaja tidak bisa diubah lewat konfigurasi.
- Validasi cover di server: pemilik harus bertugas, shift cover = shift pemilik, pengganti harus Off,
  tidak ada cover ganda/pengganti sibuk. Saat approve divalidasi ulang (kondisi bisa berubah).
- Saran pengganti otomatis (apiSuggestCover): hanya yang memenuhi syarat, urut beban cover 30 hari (adil), peringatan bila berisiko.
- Konflik: DOUBLE_ASSIGNMENT (error), QUICK_TURNAROUND (S8 lalu M8), MAX_CONSECUTIVE (>7 hari). Tampil di panel bulan.
- Coverage: jumlah personel per shift per hari (baris bawah matriks), merah bila di bawah minimum. Cover disetujui ikut dihitung.
- Proteksi data: impor tidak pernah menimpa master; tanggal setelah 12 Okt 2026 dikelola mesin (tidak ditulis, selisih dilaporkan);
  dry-run server sebelum menulis; koreksi histori butuh konfirmasi eksplisit + cadangan otomatis (BACKUP_BASE_*, simpan 5);
  tulis massal (batch); LockService di semua operasi tulis.
- Master personel baru: apiSetMaster (insert-only; master yang sudah ada tidak bisa diubah lewat aplikasi).
- Audit log berantai SHA-256 (+ AUDIT_HEAD di Script Properties): edit, sisip, hapus baris (termasuk baris terakhir) terdeteksi.
  Tombol verifikasi di Admin; menu "Verifikasi audit log" di spreadsheet. Sheet AUDIT_LOG lama dimigrasi otomatis (tambah 2 kolom).
- Login: kunci 15 menit setelah 5 PIN salah, pembanding waktu-konstan.
- Ekspor CSV bulan aktif. Semua fitur lama dipertahankan (login, matriks, detail tanggal, riwayat cover, review admin, akun, impor).

ASUMSI YANG PERLU ANDA KONFIRMASI (default, bisa diubah lewat Script Property ENGINE_CONFIG, JSON)
- Minimum coverage: M8>=1, P8>=1, S8>=1 per hari. Contoh ubah: {"coverageMin":{"M8":2,"P8":2,"S8":1}}
- Transisi terlarang: S8 -> M8. Maksimum hari kerja berturut-turut: 7. Hanya "Off" dianggap tidak bekerja.
- Aturan cover baru lebih ketat dari versi lama (pengganti harus sedang Off). Jika kebijakan Anda berbeda, ubah di Engine.gs validateCover.

PERUBAHAN PERILAKU
- Impor tanggal setelah 12 Okt 2026 tidak lagi disimpan (sebelumnya disimpan tetapi diabaikan tampilan). Selisih dengan rotasi dilaporkan.
- Pengajuan cover yang melanggar aturan ditolak server dengan alasan jelas.

BATAS VERIFIKASI (JUJUR)
- Semua tes berjalan lokal dengan tiruan layanan Google (Spreadsheet, Cache, Lock, Properties) di memori.
  BELUM diuji di deployment Apps Script live, jaringan sungguhan, atau file Excel asli di browser.
- Kecepatan impor 2000 baris diuji pada tiruan; kecepatan Sheets sungguhan bisa berbeda.
- Hash PIN tetap SHA-256 + salt (tidak diubah); perlindungan utama adalah penguncian percobaan login.
- Sesi menyimpan role di cache sampai 6 jam; menonaktifkan akun tidak memutus sesi yang sedang berjalan.
- index.html masih memuat SheetJS dari CDN jsDelivr untuk .xlsx; tanpa internet gunakan .csv.
- Tes frontend memakai DOM tiruan (render, deteksi format impor); tampilan visual di browser belum dicek.

MENJALANKAN TES
  node tests/run_tests.js

DEPLOYMENT
1. Cadangkan spreadsheet dan project Apps Script aktif.
2. Di project Apps Script: tempel Code.gs (ganti), TAMBAH file baru Engine.gs, HTML bernama index.
3. Jalankan setupApp() (migrasi AUDIT_LOG otomatis). Entri audit lama ditandai "lama tanpa hash"; rantai mulai dari entri baru.
4. Deploy versi baru setelah memeriksa header sheet dan data master. Untuk personel baru, isi master lewat Admin > Master rotasi.
