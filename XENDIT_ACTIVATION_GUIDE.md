# Panduan Aktivasi Xendit untuk Test Mode

## ⚠️ Masalah: 404 NOT_FOUND Error

Error ini terjadi karena **produk Xendit belum diaktifkan** di dashboard Anda.

## 🔧 Solusi: Aktifkan Produk di Xendit Dashboard

### Langkah 1: Login ke Xendit Dashboard

1. Kunjungi: https://dashboard.xendit.co/
2. Login dengan akun Xendit Anda

### Langkah 2: Aktifkan Virtual Account

1. Klik **Settings** (ikon gear) di sidebar kiri
2. Pilih **Products** atau **Payment Methods**
3. Cari **Virtual Accounts**
4. Klik **Enable** atau **Activate**
5. Ikuti proses verifikasi jika diperlukan

**Bank yang Tersedia:**
- BCA
- BNI
- BRI
- Mandiri
- Permata

### Langkah 3: Aktifkan E-Wallet

1. Di halaman **Settings → Products**
2. Cari **E-Wallets**
3. Enable masing-masing:
   - ✅ OVO
   - ✅ DANA
   - ✅ LinkAja
   - ✅ ShopeePay

### Langkah 4: Verifikasi API Key

1. Masuk ke **Settings → API Keys**
2. Pastikan menggunakan **Secret Key** (bukan Public Key)
3. Untuk test: gunakan **Development Key**
4. Copy Secret Key dan paste ke `.env`:
   ```
   XENDIT_SECRET_KEY=xnd_development_xxxxxxxxxxxxx
   ```

### Langkah 5: Test Lagi

Setelah aktivasi:
1. Restart backend server
2. Coba create payment lagi
3. Seharusnya sudah berfungsi

## 🚨 Jika Masih Error Setelah Aktivasi

### Opsi 1: Hubungi Xendit Support

**Email:** support@xendit.co
**Phone:** +62 21 5084 1500
**Chat:** Via Xendit Dashboard

**Pesan yang bisa dikirim:**
```
Halo Xendit Support,

Saya mengalami error 404 NOT_FOUND saat mencoba create Virtual Account dan E-Wallet payment.

Detail:
- Account: [email Anda]
- Error: NOT_FOUND
- Endpoint: /virtual_accounts dan /ewallets/ovo

Mohon bantuan untuk:
1. Aktifkan Virtual Account untuk akun saya
2. Aktifkan E-Wallet (OVO, DANA, LinkAja, ShopeePay) untuk akun saya

Terima kasih.
```

### Opsi 2: Gunakan Manual Payment Sementara

Sementara menunggu aktivasi:
1. Gunakan fitur **"Konfirmasi Manual"** yang sudah ada
2. User transfer manual
3. Admin konfirmasi manual di dashboard

### Opsi 3: Cek Status Akun

1. Login ke dashboard
2. Cek **Account Status**
3. Pastikan akun sudah **verified**
4. Beberapa fitur mungkin perlu verifikasi bisnis

## 📋 Checklist Aktivasi

- [ ] Login ke Xendit Dashboard
- [ ] Settings → Products → Virtual Accounts → **Enabled**
- [ ] Settings → Products → E-Wallets → **Enabled** (OVO, DANA, LinkAja, ShopeePay)
- [ ] Settings → API Keys → Copy **Secret Key**
- [ ] Update `.env` dengan Secret Key yang benar
- [ ] Restart backend server
- [ ] Test create payment lagi

## 🔍 Verifikasi API Key

Test API key dengan curl:

```bash
# Test Virtual Account
curl -X POST https://api.xendit.co/virtual_accounts \
  -H "Authorization: Basic $(echo -n 'YOUR_SECRET_KEY:' | base64)" \
  -H "Content-Type: application/json" \
  -d '{
    "external_id": "test_va_001",
    "bank_code": "BCA",
    "name": "Test User",
    "expected_amount": 100000,
    "is_single_use": true
  }'
```

Jika berhasil, akan return data Virtual Account.
Jika error 404, berarti produk belum diaktifkan.

## 💡 Tips

1. **Test Mode Limitations:**
   - Beberapa fitur mungkin tidak tersedia di test mode
   - Virtual Account biasanya tersedia
   - E-Wallet mungkin terbatas

2. **Production Mode:**
   - Semua fitur tersedia
   - Perlu verifikasi bisnis
   - Gunakan Production Secret Key

3. **Support:**
   - Xendit support biasanya responsif
   - Email: support@xendit.co
   - Response time: 1-2 hari kerja

## 📞 Kontak Xendit

- **Email:** support@xendit.co
- **Phone:** +62 21 5084 1500
- **Chat:** Via Dashboard
- **Documentation:** https://docs.xendit.co/

---

**Setelah aktivasi, semua payment method seharusnya sudah berfungsi!** 🎉

