# Checklist: Payment Table untuk Xendit

## ✅ Status: SUDAH BISA HANDLE XENDIT

Table `payments` sudah siap untuk handle Xendit payment dengan struktur berikut:

### Field yang Sudah Ada (Cukup untuk Basic)

1. **`payment_provider`** VARCHAR(50)
   - Menyimpan provider payment: `'xendit'`, `'manual'`, dll
   - ✅ Sudah digunakan di controller

2. **`transaction_id`** VARCHAR(255)
   - Menyimpan Xendit transaction ID (VA ID, E-Wallet ID, QRIS ID)
   - ✅ Sudah digunakan untuk webhook lookup
   - ✅ Sudah ada index untuk performa

3. **`payment_method`** ENUM
   - Menyimpan metode: `'bank_transfer'`, `'e_wallet'`, `'manual'`
   - ✅ Sudah digunakan

4. **`status`** ENUM
   - Status payment: `'pending'`, `'paid'`, `'failed'`, `'refunded'`
   - ✅ Sudah digunakan

5. **`paid_at`** DATETIME
   - Waktu pembayaran selesai
   - ✅ Sudah digunakan

### Field Tambahan (Optional - untuk Optimasi)

Migration `015_add_xendit_fields_to_payments.js` menambahkan field untuk menyimpan data Xendit langsung di database (tidak perlu call API setiap kali):

1. **`xendit_account_number`** VARCHAR(50)
   - Nomor Virtual Account (untuk VA)
   - Bisa langsung ditampilkan tanpa call API

2. **`xendit_bank_code`** VARCHAR(20)
   - Kode bank (BCA, BNI, BRI, dll)
   - Untuk display info bank

3. **`xendit_checkout_url`** TEXT
   - URL checkout untuk E-Wallet
   - Bisa langsung digunakan tanpa call API

4. **`xendit_qr_string`** TEXT
   - QR code string untuk QRIS
   - Bisa langsung ditampilkan

5. **`xendit_expires_at`** DATETIME
   - Waktu kadaluarsa payment
   - Untuk validasi expiration

## Cara Menggunakan

### 1. Run Migration (Jika Belum)

```bash
cd BACKEND_VERKAS
npm run migrate
```

Migration akan menambahkan field-field Xendit jika belum ada.

### 2. Data Otomatis Tersimpan

Saat create Xendit payment, data akan otomatis tersimpan:
- Virtual Account: `xendit_account_number`, `xendit_bank_code`, `xendit_expires_at`
- E-Wallet: `xendit_checkout_url`
- QRIS: `xendit_qr_string`, `xendit_expires_at`

### 3. Query Data

```sql
-- Get payment dengan Xendit details
SELECT 
  id,
  amount,
  payment_provider,
  transaction_id,
  xendit_account_number,
  xendit_bank_code,
  xendit_checkout_url,
  xendit_qr_string,
  xendit_expires_at,
  status
FROM payments
WHERE payment_provider = 'xendit';
```

## Keuntungan Menyimpan Data Xendit di Database

1. **Lebih Cepat**: Tidak perlu call Xendit API setiap kali tampilkan data
2. **Offline Access**: Data tetap tersedia meski Xendit API down
3. **Audit Trail**: Data tersimpan untuk keperluan audit
4. **Reduced API Calls**: Mengurangi beban ke Xendit API

## Catatan

- Field-field Xendit adalah **optional** (NULL allowed)
- Jika field tidak ada, sistem tetap bisa bekerja dengan call API
- Migration sudah handle jika field sudah ada (tidak akan error)

## Testing

Setelah run migration, test dengan:
1. Create Virtual Account payment
2. Cek database: field `xendit_account_number` dan `xendit_bank_code` harus terisi
3. Create E-Wallet payment
4. Cek database: field `xendit_checkout_url` harus terisi

## Kesimpulan

✅ **Table payments SUDAH BISA handle Xendit**
- Field dasar sudah ada dan digunakan
- Field tambahan (optional) sudah ditambahkan via migration
- Controller sudah update untuk save data Xendit
- Model sudah punya method untuk update Xendit details

**Tinggal run migration untuk field tambahan (optional):**
```bash
npm run migrate
```

