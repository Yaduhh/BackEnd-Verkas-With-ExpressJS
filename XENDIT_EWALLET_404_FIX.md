# Fix Error 404 untuk E-Wallet Xendit

## 🔍 Analisa Error

Dari error log yang muncul:
```
❌ Xendit E-Wallet API Error: {
  status: 404,
  error_code: 'NOT_FOUND',
  message: 'The requested resource was not found'
}
```

**Endpoint yang digunakan:** `https://api.xendit.co/ewallets/linkaja`

## 🛠️ Perbaikan yang Sudah Dilakukan

### 1. Fallback Endpoint (v2 → v1)
- Sekarang mencoba endpoint v2 dulu: `/v2/ewallets/linkaja`
- Jika 404, fallback ke v1: `/ewallets/linkaja`
- Logging lebih detail untuk tracking

### 2. Format Request Body
- Format phone number (remove +, spaces, dashes)
- Validasi amount sebagai number
- Callback dan redirect URL opsional

### 3. Error Handling
- Error message lebih spesifik
- Menunjukkan endpoint mana yang sudah dicoba
- Saran solusi yang jelas

## 🚨 Kemungkinan Penyebab 404

### 1. E-Wallet Tidak Tersedia di Test Mode
**Kemungkinan besar ini masalahnya!**

Beberapa E-Wallet mungkin **tidak tersedia di test mode**, meskipun sudah **Activated** di dashboard.

**Solusi:**
- Coba gunakan **Virtual Account** dulu (lebih reliable di test mode)
- Atau hubungi Xendit support untuk aktivasi khusus test mode

### 2. Endpoint Format Berbeda
Xendit mungkin menggunakan format endpoint yang berbeda untuk E-Wallet.

**Sudah diperbaiki:** Sekarang mencoba v2 dan v1 endpoint.

### 3. Format Request Body Salah
Mungkin ada field yang wajib tapi belum dikirim.

**Sudah diperbaiki:** Format request body sudah disesuaikan.

## 📋 Langkah Troubleshooting

### 1. Cek di Xendit Dashboard

1. Login ke https://dashboard.xendit.co/
2. **Settings** → **Channel Pembayaran**
3. Cek apakah **LinkAja** benar-benar **Activated**
4. Cek apakah ada **restriction** atau **limitation** untuk test mode

### 2. Test dengan Virtual Account Dulu

Virtual Account biasanya lebih reliable di test mode:

```javascript
// Coba Virtual Account dulu
payment_method: "virtual_account"
virtual_account_bank: "BCA"
```

### 3. Cek API Logs di Dashboard

1. **Developer** → **API Logs** di Xendit Dashboard
2. Lihat request yang gagal
3. Cek error message dari Xendit

### 4. Test dengan E-Wallet Lain

Coba E-Wallet lain untuk isolasi masalah:
- OVO
- DANA
- ShopeePay

Jika yang lain berhasil, berarti LinkAja memang tidak tersedia di test mode.

### 5. Hubungi Xendit Support

Jika semua sudah dicoba tapi masih 404:

**Email:** support@xendit.co
**Subject:** E-Wallet LinkAja 404 Error di Test Mode

**Isi email:**
```
Halo Xendit Support,

Saya mengalami error 404 NOT_FOUND saat mencoba create E-Wallet LinkAja payment.

Detail:
- Account: [email Anda]
- Error: 404 NOT_FOUND
- Endpoint: /ewallets/linkaja
- Mode: Test Mode
- Channel Status: Activated di dashboard

Mohon bantuan untuk:
1. Aktifkan E-Wallet LinkAja untuk test mode
2. Atau berikan alternatif endpoint/format yang benar

Terima kasih.
```

## 💡 Rekomendasi

### Untuk Development/Test Mode:
1. **Gunakan Virtual Account** - lebih reliable
2. **E-Wallet OVO/DANA** - biasanya lebih support di test mode
3. **LinkAja/ShopeePay** - mungkin perlu aktivasi khusus

### Untuk Production:
- Semua E-Wallet seharusnya sudah tersedia
- Pastikan sudah verifikasi bisnis
- Pastikan semua channel sudah activated

## 🔄 Setelah Perbaikan

Setelah update kode:
1. **Restart backend server**
2. **Test lagi dengan E-Wallet**
3. **Cek console log** untuk melihat:
   - Endpoint mana yang dicoba (v2 atau v1)
   - Response dari Xendit
   - Error detail jika masih gagal

## 📝 Catatan

- Error 404 untuk E-Wallet di test mode **biasa terjadi**
- Virtual Account lebih recommended untuk development
- Production mode biasanya tidak ada masalah

---

**Jika masih error setelah semua perbaikan, kemungkinan besar E-Wallet LinkAja memang tidak tersedia di test mode Anda. Gunakan Virtual Account atau hubungi Xendit support.** 🎯

