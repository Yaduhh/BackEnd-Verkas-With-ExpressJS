# Panduan Xendit Test Mode & Troubleshooting

## Masalah yang Sering Terjadi di Test Mode

### 1. Virtual Account: NOT_FOUND Error

**Kemungkinan Penyebab:**
- Virtual Account belum diaktifkan di Xendit Dashboard
- Test key tidak support Virtual Account
- Endpoint atau format request salah

**Solusi:**
1. **Cek Xendit Dashboard:**
   - Login ke https://dashboard.xendit.co/
   - Settings → Products → Virtual Accounts
   - Pastikan Virtual Accounts sudah **Enabled**

2. **Cek API Key:**
   - Settings → API Keys
   - Pastikan menggunakan **Secret Key** (bukan Public Key)
   - Untuk test, gunakan Development Key

3. **Test dengan Postman/curl:**
   ```bash
   curl -X POST https://api.xendit.co/virtual_accounts \
     -H "Authorization: Basic <base64(secret_key:)>" \
     -H "Content-Type: application/json" \
     -d '{
       "external_id": "test_va_001",
       "bank_code": "BCA",
       "name": "Test User",
       "expected_amount": 100000,
       "is_single_use": true
     }'
   ```

### 2. E-Wallet: 500 Internal Server Error

**Kemungkinan Penyebab:**
- E-Wallet belum diaktifkan
- Test mode tidak support semua e-wallet
- Format request salah
- Phone number format salah

**Solusi:**
1. **Aktifkan E-Wallet di Dashboard:**
   - Settings → Products → E-Wallets
   - Enable: OVO, DANA, LinkAja, ShopeePay

2. **Cek Phone Number Format:**
   - Harus format Indonesia: `081234567890` (tanpa +62)
   - Minimal 10 digit, maksimal 13 digit

3. **Test dengan Postman:**
   ```bash
   curl -X POST https://api.xendit.co/ewallets/ovo \
     -H "Authorization: Basic <base64(secret_key:)>" \
     -H "Content-Type: application/json" \
     -d '{
       "reference_id": "test_ewallet_001",
       "amount": 100000,
       "phone": "081234567890"
     }'
   ```

### 3. QRIS: REQUEST_FORBIDDEN_ERROR

**Kemungkinan Penyebab:**
- QRIS memerlukan permission khusus
- Belum diaktifkan di dashboard
- Perlu verifikasi bisnis

**Solusi:**
- Hubungi Xendit Support untuk aktivasi QRIS
- Email: support@xendit.co
- Atau disable QRIS sementara (sudah dilakukan)

## Checklist untuk Test Mode

### ✅ Yang Perlu Dicek:

1. **API Key:**
   - [ ] Menggunakan Development/Test Secret Key
   - [ ] Key sudah di-copy dengan benar (tidak ada spasi)
   - [ ] Key masih aktif (tidak expired)

2. **Dashboard Settings:**
   - [ ] Virtual Accounts enabled
   - [ ] E-Wallets enabled (OVO, DANA, dll)
   - [ ] Webhook configured (optional untuk test)

3. **Request Format:**
   - [ ] `external_id` unik setiap request
   - [ ] `amount` dalam format number (bukan string)
   - [ ] `expiration_date` dalam format ISO 8601
   - [ ] `phone` dalam format Indonesia (081234567890)

4. **Environment:**
   - [ ] `.env` file sudah diisi dengan benar
   - [ ] Server sudah restart setelah update `.env`
   - [ ] Database connection OK

## Test dengan Xendit Dashboard

### Simulasi Virtual Account Payment:

1. Login ke Xendit Dashboard
2. Pilih **Virtual Accounts** → pilih VA yang dibuat
3. Klik **Simulate Payment** untuk test
4. Payment akan otomatis ter-update via webhook

### Simulasi E-Wallet Payment:

1. Buat payment via API
2. Dapatkan `checkout_url` dari response
3. Buka URL di browser/app
4. Complete payment di e-wallet app (test mode)
5. Payment akan ter-update via webhook

## Common Errors & Solutions

### Error: "The requested resource was not found"

**Solusi:**
- Cek apakah produk sudah diaktifkan di dashboard
- Cek endpoint URL sudah benar
- Cek API key sudah benar

### Error: "Internal Server Error" (500)

**Solusi:**
- Biasanya masalah di sisi Xendit
- Coba lagi setelah beberapa saat
- Cek status Xendit: https://status.xendit.co/
- Hubungi support jika persist

### Error: "API key is forbidden"

**Solusi:**
- Cek permission API key di dashboard
- Pastikan menggunakan Secret Key (bukan Public Key)
- Cek apakah produk sudah diaktifkan

### Error: "Invalid request parameters"

**Solusi:**
- Cek format `amount` (harus number, bukan string)
- Cek format `phone` (081234567890, tanpa +62)
- Cek format `expiration_date` (ISO 8601)
- Cek `external_id` unik dan tidak duplikat

## Tips untuk Development

1. **Gunakan Test Amount:**
   - Virtual Account: minimal sesuai requirement bank
   - E-Wallet: minimal sesuai requirement e-wallet

2. **Unique External ID:**
   - Gunakan timestamp: `PAYMENT_${id}_${Date.now()}`
   - Jangan reuse external_id yang sudah digunakan

3. **Logging:**
   - Enable detailed logging untuk debug
   - Log request body dan response
   - Log error details

4. **Error Handling:**
   - Handle semua error dengan pesan yang jelas
   - Berikan fallback jika API gagal
   - Log error untuk debugging

## Kontak Support

Jika masih error setelah cek semua di atas:

- **Email**: support@xendit.co
- **Phone**: +62 21 5084 1500
- **Chat**: Via Xendit Dashboard
- **Documentation**: https://docs.xendit.co/

## Next Steps

1. ✅ Cek semua checklist di atas
2. ✅ Test dengan Postman/curl untuk verify API key
3. ✅ Aktifkan produk di dashboard
4. ✅ Test lagi dari aplikasi
5. ✅ Hubungi support jika masih error

---

**Catatan:** Test mode memiliki beberapa keterbatasan. Beberapa fitur mungkin tidak tersedia atau memerlukan aktivasi khusus. Untuk testing penuh, pertimbangkan menggunakan production key (dengan hati-hati).

