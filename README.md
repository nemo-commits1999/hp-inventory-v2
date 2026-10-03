# HP Inventory Pro

Versi yang lebih modern dan lebih nyaman dipakai daripada versi lama.

## Fitur utama
- Dashboard ringkas dan penuh statistik
- Pinjam / Kembali / Maintenance terpisah
- Master barang dan karyawan
- Laporan dan export CSV
- Backup & restore data JSON
- Kode sandi aplikasi
- Tema terang / dark slate / joker
- Simpan ke file JSON agar data tidak mudah hilang
- Pindah data antar browser / PC dengan backup

## Cara jalankan
1. Pastikan Python sudah terinstal di komputer.
2. Buka terminal di folder project.
3. Jalankan:

   python server.py

4. Browser akan terbuka otomatis ke:

   http://127.0.0.1:8477

## Struktur file
- index.html
- style.css
- app.js
- server.py

## Catatan penting
- Data utama disimpan di browser localStorage.
- Untuk memindahkan data ke komputer lain, gunakan menu Pengaturan > Backup Sekarang atau Simpan ke File.
- Jika browser tidak mendukung `showSaveFilePicker`, fitur Simpan ke File akan otomatis non-aktif.

