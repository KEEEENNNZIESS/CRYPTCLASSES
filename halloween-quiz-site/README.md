# CryptClass — Halloween Quiz (v1.1.0)

Proyek full-stack untuk website kuis kelas bertema Halloween. Aplikasi memakai **Node.js + Express + PostgreSQL**; antarmuka dibangun dengan HTML/CSS/JavaScript tanpa framework frontend. Data peserta, jawaban, nilai, log audit, sesi admin, dan gambar yang diunggah disimpan di database, bukan hanya di browser.

> **Status pemeriksaan:** pemeriksaan sintaks `server.js` dan `public/app.js` serta 5 tes unit penilaian lulus di lingkungan pembuatan. Tes integrasi dengan PostgreSQL dan browser belum bisa dijalankan di lingkungan pembuatan ini. Jadi, paket ini adalah source code lengkap untuk konfigurasi/deploy dan pengujian lanjutan—bukan klaim bahwa aplikasi sudah di-deploy atau siap dipakai menilai kelas tanpa tes staging.

## Pilihan tercepat: jalankan lokal dengan Docker

Persyaratan: Docker Desktop atau Docker Engine dengan Docker Compose.

1. Ekstrak ZIP.
2. Buka terminal di folder yang berisi `docker-compose.yml`.
3. Jalankan:

   ```bash
   docker compose up --build
   ```

4. Buka <http://localhost:3000>.
5. Klik **ADMIN**. Pada penggunaan pertama, buat PIN admin dan kode pemulihan. Simpan kode pemulihan secara privat; kode ini tidak dapat ditampilkan lagi oleh website.
6. Buat kuis, isi soal serta kunci, simpan, lalu buka kuis dari halaman detail.

Database lokal disimpan di Docker volume `cryptclass_pgdata`; data tetap ada setelah container dimulai ulang. Untuk menghentikan aplikasi, tekan `Ctrl+C`; untuk memulai lagi gunakan `docker compose up`. Jangan gunakan kredensial bawaan di `docker-compose.yml` untuk server internet.

## Jalankan tanpa Docker

Persyaratan: Node.js 24 LTS dan PostgreSQL 14+ yang sudah berjalan.

1. Salin `.env.example` menjadi `.env`.
2. Isi `DATABASE_URL` dengan connection string PostgreSQL. Contoh lokal: `postgres://postgres:password@localhost:5432/cryptclass`.
3. Buat nilai `SESSION_SECRET` acak panjang. Contoh perintah:

   ```bash
   node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
   ```

4. Atur `PGSSL=true` bila penyedia database mewajibkan SSL. Untuk localhost biasa, pakai `PGSSL=false`. Gunakan `COOKIE_SECURE=true` hanya ketika aplikasi berjalan melalui HTTPS.
5. Jalankan:

   ```bash
   npm install
   npm test
   npm start
   ```

6. Buka <http://localhost:3000> lalu lakukan setup admin di menu **ADMIN**.

Skema database dan tabel sesi dibuat otomatis saat server mulai. Aplikasi memakai Node.js 24 LTS. Dependensi spreadsheet dipasang dari tarball resmi SheetJS agar tidak memakai salinan lama di registry npm publik; pastikan instalasi berhasil dan cek versinya menggunakan `npm ls xlsx`. Jangan pernah mengunggah `.env` atau membagikan connection string database.

## Deploy ke hosting

Aplikasi dapat dijalankan pada hosting Node.js yang mendukung sesi server, koneksi keluar ke PostgreSQL, dan variabel environment. Database harus menjadi database PostgreSQL terkelola yang dapat diakses oleh aplikasi web. Contoh alur deploy:

1. Buat repository Git dan unggah seluruh isi proyek ini (kecuali `.env` serta `node_modules`).
2. Buat aplikasi web Node.js dari repository dengan build command `npm install` dan start command `npm start`.
3. Buat database PostgreSQL dan isi `DATABASE_URL` di pengaturan hosting.
4. Atur `NODE_ENV=production`, `PGSSL=true`, `COOKIE_SECURE=true`, dan `SESSION_SECRET` acak yang berbeda dari contoh lokal.
5. Pastikan health check `GET /api/health` berhasil, lalu buka URL HTTPS aplikasi. Pada halaman ADMIN, buat PIN serta kode pemulihan.

`render.yaml` disertakan sebagai contoh konfigurasi Render. Penyedia hosting dan database dapat mengenakan biaya atau memiliki batasan koneksi/kapasitas; cek paket dan batas penggunaan sebelum deploy. `DATABASE_URL` sengaja tidak diisi di repository.

## Fitur yang tersedia

- Satu admin dengan setup awal, PIN di-hash, kode pemulihan, rate limit login, sesi server yang persisten, dan pencabutan sesi admin saat PIN dipulihkan.
- Buat/edit/duplikat/buka/tutup/arsipkan/hapus kuis. Kode kuis dipilih admin dan harus unik.
- Metadata wajib: judul, mata pelajaran, deskripsi/instruksi, kelas, tanggal, dan guru.
- Satu tipe soal untuk setiap kuis: pilihan ganda dengan tepat lima opsi, pilihan jamak, benar/salah, matching, atau ordering.
- Kunci jawaban tidak dikirim ke browser peserta. Semua penilaian dilakukan server, dengan bobot sama dan nilai 0–100.
- Pilihan jamak mendapat kredit parsial berdasarkan jumlah opsi benar yang dipilih; opsi salah tidak mengurangi poin dan skor per soal dibatasi maksimal satu poin. Matching dinilai berdasarkan jumlah pasangan benar, ordering berdasarkan elemen di posisi benar.
- Peserta masuk dengan kode dan nama, tanpa akun. Nama duplikat ditolak dalam satu kuis; token sesi yang tersimpan di perangkat membantu melanjutkan percobaan.
- Autosave ke server. Saat offline, jawaban yang belum terkirim disimpan sementara pada browser dan akan dicoba dikirim saat online lagi. Indikator membedakan status lokal dan server. **Jawaban yang belum sampai server tidak dapat dijamin jika admin menutup kuis lebih dahulu.**
- Kuis tanpa timer, konfirmasi sebelum mengirim, late join saat kuis terbuka, dan reset oleh admin dengan riwayat percobaan lama tetap ada.
- Mini-game memory matching wajib sebelum hasil tampil; game tidak memengaruhi nilai akademik.
- Dashboard, leaderboard khusus admin, analisis salah/kosong dengan sample size, daftar peserta termasuk yang belum selesai, jawaban peserta, serta riwayat percobaan.
- Ekspor CSV, XLSX, dan PDF dengan pilihan laporan nilai/jawaban/analisis.
- Impor soal dari CSV/Excel dan tempel teks bernomor dengan pratinjau. Baris dengan error tidak dapat diterapkan; perbaiki sumber file/teks lalu pratinjau ulang.
- Gambar soal lewat HTTPS atau unggahan JPG/PNG/WebP/GIF ke database.
- Backup JSON manual lengkap: kuis, soal, kunci, peserta, jawaban, nilai, media, dan audit. Pemulihan menampilkan pratinjau dan meminta konfirmasi; pemulihan mengganti data kuis/hasil saat ini, tetapi tidak mengganti kredensial admin.
- Tampilan responsif bertema Haunted Mansion: background malam berhantu, jaring laba-laba, laba-laba bergelantungan, panel gothic ungu gelap, aksen pumpkin orange, sidebar admin responsif, dan dukungan `prefers-reduced-motion`.

## Format impor

Unduh template CSV dari halaman edit kuis agar kolom cocok dengan jenis soal.

- **Pilihan ganda/jamak:** `prompt`, `image_url`, `option_a`, `option_b`, `option_c`, `option_d`, `option_e`, `answer_key`. Kunci contoh `C` atau `A,C`.
- **Benar/salah:** `prompt`, `image_url`, `answer_key` bernilai `BENAR` atau `SALAH`.
- **Matching:** `prompt`, `image_url`, `left_items`, `right_items`, `answer_key`. Pisahkan item memakai `;`; kunci contoh `1=2;2=1;3=3`.
- **Ordering:** `prompt`, `image_url`, `items`, `answer_key`. Pisahkan elemen dengan `;`; kunci adalah urutan indeks 1-based, contoh `3,1,2`.

Paste teks memakai nomor soal (`1. ...`), opsi `A. ...` hingga `E. ...`, dan `Kunci: ...`. Untuk matching, gunakan `Kiri: item1; item2`, `Kanan: ...`, dan `Kunci: 1=2;2=1`. Untuk ordering, gunakan `Items: item1; item2; item3` dan `Kunci: 2,1,3`.

## Aturan operasional penting

- Saat kuis terbuka, perubahan soal/kunci berlaku untuk semua peserta. Kunci/soal yang berubah akan memicu penilaian ulang terhadap percobaan yang sudah dikirim. Peserta yang masih bekerja menerima perubahan saat halaman mereka menyegarkan status dari server.
- Saat kuis ditutup, percobaan aktif dikunci dan dinilai dari jawaban yang telah diterima server. Peserta yang tidak aktif lebih dari 90 detik memicu peringatan konfirmasi saat penutupan.
- Kuis yang sudah ditutup tidak dapat diedit atau dibuka ulang; admin dapat melihat/mengekspor, mengarsipkan, menduplikasi, atau menghapusnya.
- Menghapus peserta akan menghapus data/riwayatnya tanpa membuat catatan penghapusan, sesuai spesifikasi privasi yang dipilih. Tindakan ini tidak bisa dibatalkan.
- Backup memuat nama, jawaban, nilai, token sesi peserta yang telah di-hash, dan audit. Simpan file backup di tempat aman karena berisi data kelas.
- Sesi admin memiliki masa cookie panjang untuk mendekati kebijakan “sampai logout/dicabut”; logout atau pemulihan PIN mencabut sesi yang relevan. Perangkat bersama tetap sebaiknya logout setelah selesai.

## Tes minimum sebelum digunakan di kelas

- Jalankan `npm test` untuk tes unit scoring.
- Buat kuis uji untuk setiap jenis soal; verifikasi benar, salah, kosong, kredit parsial, serta nilai maksimum 100.
- Coba impor valid dan impor dengan error; pastikan file bermasalah tidak langsung diterapkan.
- Uji dua browser/perangkat dengan nama berbeda dan dua percobaan memakai nama sama.
- Putuskan koneksi salah satu perangkat, ubah jawaban, nyalakan koneksi lagi dan pastikan indikator kembali “Tersimpan di server”.
- Tutup kuis saat ada peserta aktif/offline; periksa peringatan, status terkunci, dan nilai.
- Uji reset percobaan, duplikasi, pengarsipan, penghapusan data, ekspor semua format, backup, dan pemulihan backup di database uji sebelum mengandalkan data sesungguhnya.
- Untuk kelas 41–60 peserta, lakukan simulasi beban di staging terlebih dahulu. Kapasitas akhirnya bergantung pada batas koneksi dan sumber daya hosting/database.


## Editor soal campuran (v1.2)
Setiap kuis sekarang dapat berisi campuran tipe soal. Di editor, klik **+ TAMBAH SOAL**, pilih jenis pertanyaan pada dialog, lalu isi pertanyaan dan kuncinya. Ulangi proses tersebut untuk menambah soal dengan tipe berbeda. Pilihan ganda dan pilihan jamak tetap memiliki lima opsi A–E; ini bukan batas jumlah pertanyaan. Jumlah pertanyaan per kuis tetap maksimal 300.

Database yang sudah pernah dipakai dimigrasikan otomatis saat server mulai: setiap soal lama menerima tipe soal dari kuis lamanya. Jangan hapus volume Docker jika ingin mempertahankan data yang sudah tersimpan.


## Spooky Halloween visual assets

This revision includes locally bundled atmospheric scenery, corner cobwebs, a hanging spider illustration, and a pumpkin brand mark under `public/assets/`. The design preview is in `docs/design-preview.png`. These assets are original decorative artwork and are loaded locally; no third-party image host is required.


## Haunted Mansion UI (2026-10-29)

Halaman kini memakai treatment visual yang lebih dekat ke referensi UI Halloween: background haunted night, glow oranye, jaring di sudut panel, sidebar admin fungsional pada desktop dan navigasi horizontal pada layar kecil. File dekorasi lokal ada di `public/assets/`. Sidebar hanya mengarahkan ke view yang sudah tersedia; tidak menambah halaman palsu atau mengubah alur scoring.


## Haunted Deluxe Visual Upgrade (29 Oct 2026)

The Deluxe visual layer adds local artwork and decorative effects without changing quiz grading, persistence, API contracts, or database schema.

### Local visual assets
- `public/assets/haunted-mansion-generated.webp` — original cinematic night backdrop composed from generated concept art and a custom night-scene layer.
- `public/assets/bat-sprite.svg` — four-frame bat wing sprite, animated with CSS steps.
- `public/assets/ghost-sprite.svg` — four-frame floating ghost sprite.
- `public/assets/hanging-spider.svg` — detailed hanging spider illustration used by two independently animated ornaments.
- `public/assets/pumpkin-fire.svg` — glowing pumpkin illustration for brand/sidebar/card decoration.
- `public/assets/ember-dust.png` — locally generated ember texture.
- `public/fx.js` — creates local ember particles, subtle card glow tracking, and view-entry transitions.

### Motion and accessibility
Fog layers drift slowly, bats cross the scene, the ghost floats, spiders sway, ember particles rise, and buttons/progress bars receive subtle light sweeps. The effects are decorative only; no external scripts or audio are added. `prefers-reduced-motion: reduce` disables the ambient motion. Mobile layouts reduce the number and intensity of the effects.

### Apply the update safely
1. Back up the existing project folder.
2. Copy this project into the existing CryptClass project, keeping the original `.env` file.
3. Run `docker compose -p cryptclass-v12 up --build -d` from the project folder.
4. Open `http://localhost:3000` and hard-refresh with `Ctrl+Shift+R`.

Do not run `docker compose down -v` for a visual update; that command may remove the database volume.
