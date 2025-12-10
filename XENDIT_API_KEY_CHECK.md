# Cara Cek Izin API Key Xendit

## ⚠️ Masalah: 404 NOT_FOUND meskipun Channel sudah Activated

Jika semua channel sudah **Activated** di dashboard tapi masih dapat error 404, kemungkinan masalahnya adalah **API Key tidak punya izin Write**.

## 🔍 Langkah Cek Izin API Key

### 1. Login ke Xendit Dashboard

1. Kunjungi: https://dashboard.xendit.co/
2. Login dengan akun Anda

### 2. Cek API Keys

1. Klik **Settings** (ikon gear) di sidebar kiri
2. Pilih **API Keys**
3. Cari API Key yang Anda gunakan (yang ada di `.env` sebagai `XENDIT_SECRET_KEY`)

### 3. Cek Izin (Permissions)

Untuk setiap API Key, ada kolom **Permissions** atau **Izin**:

**Jenis Izin:**
- **None** ❌ = Tidak ada akses
- **Read** ⚠️ = Hanya bisa baca (tidak bisa create payment)
- **Write** ✅ = Bisa baca dan tulis (bisa create payment)

### 4. Pastikan Izin Write untuk:

✅ **Virtual Account** → Harus **Write**
✅ **E-Wallet** → Harus **Write**
✅ **QRIS** → Harus **Write**

### 5. Jika Izin = None atau Read

**Solusi:**

1. **Edit API Key:**
   - Klik API Key yang ingin diubah
   - Ubah izin untuk Virtual Account, E-Wallet, QRIS menjadi **Write**
   - Simpan perubahan

2. **Atau Buat API Key Baru:**
   - Klik **Create API Key**
   - Pilih izin **Write** untuk semua produk yang dibutuhkan
   - Copy Secret Key baru
   - Update di `.env`:
     ```
     XENDIT_SECRET_KEY=xnd_development_xxxxxxxxxxxxx
     ```
   - Restart backend server

## 📋 Checklist

- [ ] Login ke dashboard.xendit.co
- [ ] Settings → API Keys
- [ ] Cari API Key yang digunakan
- [ ] Cek izin Virtual Account = **Write** ✅
- [ ] Cek izin E-Wallet = **Write** ✅
- [ ] Cek izin QRIS = **Write** ✅
- [ ] Jika bukan Write, edit atau buat API Key baru
- [ ] Update `.env` dengan Secret Key yang benar
- [ ] Restart backend server
- [ ] Test create payment lagi

## 🚨 Jika Masih Error

Jika setelah set izin Write masih error:

1. **Cek API Key Environment:**
   ```bash
   # Di backend, cek apakah API key ter-load
   console.log(config.xendit.secretKey);
   ```

2. **Test API Key dengan curl:**
   ```bash
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

3. **Cek API Logs di Dashboard:**
   - Settings → **API Logs** atau **Developer** → **API Logs**
   - Lihat request yang gagal
   - Cek error message dari Xendit

4. **Hubungi Xendit Support:**
   - Email: support@xendit.co
   - Sertakan:
     - Email akun Xendit
     - API Key yang digunakan (masked)
     - Error message lengkap
     - Screenshot dari API Logs

## 💡 Tips

- **Test Mode:** Pastikan menggunakan API Key yang dimulai dengan `xnd_development_`
- **Production Mode:** Pastikan menggunakan API Key yang dimulai dengan `xnd_production_`
- **Jangan share API Key** ke publik atau commit ke git
- **Rotate API Key** secara berkala untuk keamanan

---

**Setelah set izin Write, seharusnya sudah bisa create payment!** 🎉

