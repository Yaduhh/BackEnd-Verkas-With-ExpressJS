# Cara Mengaktifkan QRIS di Xendit

## Masalah
Error: `REQUEST_FORBIDDEN_ERROR` - QRIS payment requires special permissions

## Solusi

### Opsi 1: Aktifkan QRIS di Xendit Dashboard (Recommended)

1. **Login ke Xendit Dashboard**
   - Kunjungi: https://dashboard.xendit.co/
   - Login dengan akun Xendit Anda

2. **Akses Settings**
   - Klik menu **Settings** di sidebar kiri
   - Pilih **Products** atau **Payment Methods**

3. **Aktifkan QRIS**
   - Cari opsi **QRIS** atau **QR Code**
   - Klik **Enable** atau **Activate**
   - Ikuti proses verifikasi jika diperlukan

4. **Verifikasi API Key Permissions**
   - Masuk ke **Settings** → **API Keys**
   - Pastikan API key Anda memiliki permission untuk QRIS
   - Jika tidak ada, buat API key baru dengan permission QRIS

5. **Hubungi Xendit Support (Jika Tidak Tersedia)**
   - Jika opsi QRIS tidak muncul di dashboard
   - Kirim email ke: support@xendit.co
   - Atau chat via dashboard
   - Minta untuk mengaktifkan fitur QRIS untuk akun Anda

### Opsi 2: Gunakan Metode Pembayaran Lain (Sementara)

Jika QRIS tidak tersedia atau memerlukan waktu untuk diaktifkan, Anda bisa:

1. **Gunakan Virtual Account** (Sudah berfungsi)
   - BCA, BNI, BRI, Mandiri, Permata
   - Tidak perlu permission khusus

2. **Gunakan E-Wallet** (Sudah berfungsi)
   - OVO, DANA, LinkAja, ShopeePay
   - Tidak perlu permission khusus

3. **Sembunyikan QRIS dari UI** (Sementara)
   - Hapus opsi QRIS dari PaymentScreen
   - Atau disable tombol QRIS sampai permission aktif

### Opsi 3: Update Code untuk Handle QRIS Error dengan Lebih Baik

Tambahkan handling di frontend untuk menampilkan pesan yang lebih user-friendly jika QRIS tidak tersedia.

---

## Checklist

- [ ] Login ke Xendit Dashboard
- [ ] Cek Settings → Products untuk QRIS
- [ ] Aktifkan QRIS jika tersedia
- [ ] Verifikasi API Key permissions
- [ ] Hubungi Xendit Support jika perlu
- [ ] Test QRIS payment setelah diaktifkan

---

## Catatan

- **Test Key**: Beberapa fitur mungkin tidak tersedia dengan test key
- **Production Key**: QRIS biasanya tersedia di production key
- **Verification**: Xendit mungkin memerlukan verifikasi bisnis untuk QRIS
- **Time**: Proses aktivasi bisa memakan waktu 1-3 hari kerja

---

## Kontak Xendit Support

- **Email**: support@xendit.co
- **Phone**: +62 21 5084 1500
- **Chat**: Via Xendit Dashboard
- **Documentation**: https://docs.xendit.co/

---

## Alternatif: Disable QRIS Sementara

Jika QRIS tidak critical, Anda bisa disable sementara dengan:

1. Update `PaymentScreen.tsx` - hapus opsi QRIS
2. Atau tambahkan check di backend untuk return error yang lebih friendly
3. Tampilkan pesan: "QRIS sedang tidak tersedia, silakan gunakan Virtual Account atau E-Wallet"

