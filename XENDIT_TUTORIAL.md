# Tutorial Implementasi Xendit Payment Gateway

Tutorial lengkap untuk mengintegrasikan Xendit Payment Gateway ke aplikasi VERKAS.

## 📋 Daftar Isi

1. [Persiapan](#1-persiapan)
2. [Setup Xendit Account](#2-setup-xendit-account)
3. [Install Dependencies](#3-install-dependencies)
4. [Konfigurasi Environment](#4-konfigurasi-environment)
5. [Struktur File yang Dibuat](#5-struktur-file-yang-dibuat)
6. [Testing](#6-testing)
7. [Webhook Setup](#7-webhook-setup)
8. [Troubleshooting](#8-troubleshooting)

---

## 1. Persiapan

Pastikan Anda sudah memiliki:
- ✅ Node.js terinstall
- ✅ MySQL database running
- ✅ Backend VERKAS sudah berjalan
- ✅ Akun Xendit (development atau production)

---

## 2. Setup Xendit Account

### 2.1 Daftar Akun Xendit

1. Kunjungi [https://dashboard.xendit.co/register](https://dashboard.xendit.co/register)
2. Daftar dengan email dan password
3. Verifikasi email Anda

### 2.2 Dapatkan API Keys

1. Login ke [Xendit Dashboard](https://dashboard.xendit.co/)
2. Pilih **Settings** → **API Keys**
3. Copy **Secret Key** dan **Public Key**
   - Development: `xnd_development_...`
   - Production: `xnd_production_...`

### 2.3 Setup Webhook Token

1. Di dashboard, pilih **Settings** → **Webhooks**
2. Buat webhook token baru atau gunakan yang sudah ada
3. Copy token untuk digunakan di environment variable

---

## 3. Install Dependencies

Jalankan command berikut di folder `BACKEND_VERKAS`:

```bash
npm install xendit-node
```

Atau jika menggunakan yarn:

```bash
yarn add xendit-node
```

---

## 4. Konfigurasi Environment

### 4.1 Update File `.env`

Buka file `.env` di folder `BACKEND_VERKAS` dan tambahkan:

```env
# Xendit Configuration
XENDIT_SECRET_KEY=xnd_development_xxxxxxxxxxxxxxxxxxxxx
XENDIT_PUBLIC_KEY=xnd_public_development_xxxxxxxxxxxxxxxxxxxxx
XENDIT_WEBHOOK_TOKEN=your_webhook_token_here
```

**⚠️ PENTING:**
- Ganti `xnd_development_...` dengan Secret Key Anda dari Xendit Dashboard
- Ganti `xnd_public_development_...` dengan Public Key Anda
- Ganti `your_webhook_token_here` dengan webhook token Anda

### 4.2 Untuk Production

Saat deploy ke production:
- Gunakan Production API Keys (bukan Development)
- Update `XENDIT_SECRET_KEY` dan `XENDIT_PUBLIC_KEY` dengan production keys
- Setup webhook URL di Xendit Dashboard untuk production

---

## 5. Struktur File yang Dibuat

### 5.1 File yang Sudah Dibuat

```
BACKEND_VERKAS/
├── services/
│   └── xenditService.js          # Service untuk handle Xendit API
├── controllers/
│   └── paymentController.js      # Updated dengan Xendit endpoints
├── routes/
│   └── paymentRoutes.js          # Updated dengan Xendit routes
├── config/
│   └── config.js                 # Updated dengan Xendit config
└── package.json                  # Updated dengan xendit-node dependency
```

### 5.2 Endpoint yang Tersedia

#### Create Xendit Payment
```
POST /api/payments/:id/xendit/create
```

**Request Body:**
```json
{
  "payment_method": "virtual_account", // atau "ewallet" atau "qris"
  "virtual_account_bank": "BCA",        // untuk VA: BCA, BNI, BRI, MANDIRI, PERMATA
  "ewallet_type": "OVO",               // untuk E-Wallet: OVO, DANA, LINKAJA, SHOPEEPAY
  "customer_name": "John Doe",
  "customer_email": "john@example.com",
  "customer_phone": "081234567890"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Virtual Account created successfully",
  "data": {
    "payment": { ... },
    "xendit": {
      "id": "va_xxx",
      "account_number": "1234567890",
      "bank_code": "BCA",
      "expires_at": "2024-01-02T12:00:00Z",
      "status": "PENDING"
    }
  }
}
```

#### Get Xendit Payment Status
```
GET /api/payments/xendit/:xenditId/status
```

#### Verify Xendit Payment
```
POST /api/payments/:id/xendit/verify
```

#### Webhook Handler
```
POST /api/payments/xendit/webhook
```

---

## 6. Testing

### 6.1 Test Virtual Account

1. **Buat payment via API:**
```bash
curl -X POST http://localhost:3000/api/payments/1/xendit/create \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{
    "payment_method": "virtual_account",
    "virtual_account_bank": "BCA",
    "customer_name": "Test User",
    "customer_email": "test@example.com"
  }'
```

2. **Response akan berisi nomor Virtual Account**
3. **Simulasi pembayaran di Xendit Dashboard:**
   - Login ke Xendit Dashboard
   - Pilih **Virtual Accounts** → pilih VA yang dibuat
   - Klik **Simulate Payment** untuk testing

### 6.2 Test E-Wallet

1. **Buat payment:**
```bash
curl -X POST http://localhost:3000/api/payments/1/xendit/create \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{
    "payment_method": "ewallet",
    "ewallet_type": "OVO",
    "customer_phone": "081234567890"
  }'
```

2. **Response akan berisi `checkout_url`**
3. **Buka URL tersebut di browser untuk test payment**

### 6.3 Test QRIS

1. **Buat payment:**
```bash
curl -X POST http://localhost:3000/api/payments/1/xendit/create \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{
    "payment_method": "qris"
  }'
```

2. **Response akan berisi `qr_string`**
3. **Scan QR code dengan aplikasi e-wallet**

---

## 7. Webhook Setup

### 7.1 Setup Webhook di Xendit Dashboard

1. Login ke [Xendit Dashboard](https://dashboard.xendit.co/)
2. Pilih **Settings** → **Webhooks**
3. Klik **Add Webhook**
4. Isi form:
   - **Webhook URL**: `https://your-domain.com/api/payments/xendit/webhook`
   - **Events**: Pilih semua payment events (Payment, Virtual Account, E-Wallet, QRIS)
   - **Status**: Active

### 7.2 Untuk Development (ngrok)

Karena webhook memerlukan public URL, gunakan ngrok untuk development:

1. **Install ngrok:**
```bash
npm install -g ngrok
# atau download dari https://ngrok.com/
```

2. **Jalankan ngrok:**
```bash
ngrok http 3000
```

3. **Copy HTTPS URL** (contoh: `https://abc123.ngrok.io`)

4. **Update webhook URL di Xendit:**
   - URL: `https://abc123.ngrok.io/api/payments/xendit/webhook`

5. **Update callback URL di code:**
   - Edit `BACKEND_VERKAS/controllers/paymentController.js`
   - Ganti `callbackUrl` dengan ngrok URL

### 7.3 Test Webhook

1. **Buat payment via API**
2. **Simulasi payment di Xendit Dashboard**
3. **Cek logs backend** untuk melihat webhook diterima
4. **Verifikasi payment status** sudah update ke "paid"

---

## 8. Troubleshooting

### 8.1 Error: "Invalid API Key"

**Solusi:**
- Pastikan `XENDIT_SECRET_KEY` di `.env` sudah benar
- Pastikan menggunakan Secret Key (bukan Public Key)
- Untuk development, gunakan Development Key
- Untuk production, gunakan Production Key

### 8.2 Error: "Webhook verification failed"

**Solusi:**
- Pastikan `XENDIT_WEBHOOK_TOKEN` di `.env` sudah benar
- Pastikan webhook token di Xendit Dashboard sama dengan di `.env`
- Cek header `x-callback-token` di webhook request

### 8.3 Payment tidak ter-update setelah dibayar

**Solusi:**
- Cek webhook URL sudah benar di Xendit Dashboard
- Pastikan webhook URL accessible dari internet (gunakan ngrok untuk dev)
- Cek logs backend untuk melihat apakah webhook diterima
- Verifikasi webhook token sudah benar

### 8.4 Virtual Account tidak muncul

**Solusi:**
- Pastikan bank code sudah benar (BCA, BNI, BRI, MANDIRI, PERMATA)
- Cek apakah bank tersebut aktif di Xendit Dashboard
- Pastikan amount sudah sesuai (minimal sesuai requirement Xendit)

### 8.5 E-Wallet checkout URL tidak bekerja

**Solusi:**
- Pastikan `callbackUrl` dan `redirectUrl` sudah benar
- Untuk development, gunakan ngrok URL
- Pastikan URL accessible dari internet
- Cek apakah e-wallet type sudah didukung (OVO, DANA, LINKAJA, SHOPEEPAY)

---

## 9. Flow Pembayaran Lengkap

### 9.1 Flow Virtual Account

1. User klik "Bayar dengan Xendit" di frontend
2. User pilih "Virtual Account" dan bank
3. Frontend call `POST /api/payments/:id/xendit/create`
4. Backend create VA di Xendit
5. Backend return nomor VA ke frontend
6. Frontend display nomor VA
7. User transfer ke nomor VA
8. Xendit kirim webhook ke backend
9. Backend update payment status ke "paid"
10. Backend activate subscription
11. Frontend polling status (optional) atau terima notifikasi

### 9.2 Flow E-Wallet

1. User klik "Bayar dengan Xendit" di frontend
2. User pilih "E-Wallet" dan jenis e-wallet
3. Frontend call `POST /api/payments/:id/xendit/create`
4. Backend create e-wallet payment di Xendit
5. Backend return `checkout_url` ke frontend
6. Frontend buka `checkout_url` di browser/app
7. User complete payment di e-wallet app
8. Xendit kirim webhook ke backend
9. Backend update payment status ke "paid"
10. Backend activate subscription

### 9.3 Flow QRIS

1. User klik "Bayar dengan Xendit" di frontend
2. User pilih "QRIS"
3. Frontend call `POST /api/payments/:id/xendit/create`
4. Backend create QRIS di Xendit
5. Backend return `qr_string` ke frontend
6. Frontend display QR code
7. User scan QR code dengan e-wallet app
8. User complete payment
9. Xendit kirim webhook ke backend
10. Backend update payment status ke "paid"
11. Backend activate subscription

---

## 10. Best Practices

### 10.1 Security

- ✅ **Jangan commit** `.env` file ke git
- ✅ Gunakan **environment variables** di production
- ✅ **Verify webhook signature** sebelum process
- ✅ **Validate amount** sebelum update payment status
- ✅ **Log semua webhook** untuk audit

### 10.2 Error Handling

- ✅ Handle semua error dari Xendit API
- ✅ Return error message yang jelas ke frontend
- ✅ Log error untuk debugging
- ✅ Retry mechanism untuk webhook (optional)

### 10.3 Testing

- ✅ Test semua payment methods
- ✅ Test webhook dengan berbagai status
- ✅ Test error scenarios
- ✅ Test dengan amount yang berbeda
- ✅ Test expiration handling

---

## 11. Production Checklist

Sebelum deploy ke production:

- [ ] Update API keys ke Production keys
- [ ] Setup webhook URL di Xendit Dashboard (production)
- [ ] Test semua payment methods
- [ ] Verify webhook working
- [ ] Setup monitoring untuk webhook
- [ ] Setup error alerting
- [ ] Document production webhook URL
- [ ] Test dengan real payment (small amount)

---

## 12. Support & Resources

- **Xendit Documentation**: [https://docs.xendit.co/](https://docs.xendit.co/)
- **Xendit Dashboard**: [https://dashboard.xendit.co/](https://dashboard.xendit.co/)
- **Xendit Support**: support@xendit.co
- **API Reference**: [https://developers.xendit.co/api-reference/](https://developers.xendit.co/api-reference/)

---

## 13. Contoh Request/Response

### Create Virtual Account

**Request:**
```bash
POST /api/payments/1/xendit/create
Authorization: Bearer YOUR_TOKEN
Content-Type: application/json

{
  "payment_method": "virtual_account",
  "virtual_account_bank": "BCA",
  "customer_name": "John Doe",
  "customer_email": "john@example.com"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Virtual Account created successfully",
  "data": {
    "payment": {
      "id": 1,
      "amount": 100000,
      "status": "pending",
      "transaction_id": "va_abc123",
      "payment_provider": "xendit"
    },
    "xendit": {
      "id": "va_abc123",
      "account_number": "1234567890",
      "bank_code": "BCA",
      "expires_at": "2024-01-02T12:00:00Z",
      "status": "PENDING"
    }
  }
}
```

---

**Selamat! Xendit Payment Gateway sudah terintegrasi! 🎉**

Jika ada pertanyaan atau masalah, silakan cek dokumentasi Xendit atau hubungi support.

