# Analisis Model Transaction

## 📋 Overview
Model `Transaction.js` adalah class dengan static methods yang menangani semua operasi database untuk transaksi keuangan. Model ini menggunakan JOIN dengan tabel `categories` untuk mendapatkan informasi kategori.

---

## 🔍 Struktur Methods

### 1. **Query Methods**
- `findById(id)` - Mencari transaksi berdasarkan ID
- `findAll(options)` - Mencari semua transaksi dengan berbagai filter
- `count(options)` - Menghitung total transaksi untuk pagination

### 2. **CRUD Methods**
- `create({ userId, type, categoryId, amount, note, transactionDate })` - Membuat transaksi baru
- `update(id, data)` - Update transaksi (partial update)
- `softDelete(id)` - Soft delete (set status_deleted = true)
- `restore(id)` - Restore dari soft delete
- `hardDelete(id)` - Permanent delete

### 3. **Summary Method**
- `getSummary({ userId, startDate, endDate, includeDeleted })` - Menghitung pemasukan/pengeluaran

---

## ⚠️ Issues & Observations

### 1. **Pagination Default Limit (Line 27)**
```javascript
limit = 20
```
**Masalah:**
- Default limit 20 bisa menyebabkan data tidak lengkap di dashboard
- Dashboard controller harus override dengan `limit: 10000` sebagai workaround

**Dampak:**
- Di `dashboardController.js`, semua call `Transaction.findAll` harus explicit set `limit: 10000`
- Jika lupa set limit, data bisa tidak lengkap

**Rekomendasi:**
- Tambahkan opsi `limit: null` untuk "no limit" atau "unlimited"
- Atau buat method khusus `findAllUnlimited()` untuk dashboard

---

### 2. **Category Filter - Case Sensitive (Line 54)**
```javascript
if (category) {
  sql += ' AND c.name = ?';
  params.push(category);
}
```
**Masalah:**
- Filter menggunakan exact match (`=`) yang case-sensitive
- Jika frontend kirim "Makanan" tapi database ada "makanan", tidak akan match

**Dampak:**
- Filter category bisa gagal jika ada perbedaan case

**Rekomendasi:**
- Gunakan `LOWER(c.name) = LOWER(?)` untuk case-insensitive
- Atau gunakan `LIKE` dengan wildcard jika perlu partial match

---

### 3. **Date Filtering - Timezone Issue (Line 58-65)**
```javascript
if (startDate) {
  sql += ' AND t.transaction_date >= ?';
  params.push(startDate);
}

if (endDate) {
  sql += ' AND t.transaction_date <= ?';
  params.push(endDate);
}
```
**Masalah:**
- Jika `transaction_date` adalah DATETIME (bukan DATE), filter `<=` bisa miss data di hari yang sama
- Contoh: `transaction_date = '2025-11-30 17:00:00'` dan filter `endDate = '2025-11-30'` bisa tidak match karena `'2025-11-30 17:00:00' <= '2025-11-30'` = false

**Dampak:**
- Data bisa tidak muncul di dashboard jika ada perbedaan timezone atau format datetime

**Rekomendasi:**
- Gunakan `DATE(t.transaction_date)` untuk extract date part saja
- Atau pastikan `transaction_date` selalu DATE type, bukan DATETIME
- Atau gunakan `DATE(t.transaction_date) <= DATE(?)` untuk comparison

---

### 4. **JOIN dengan Categories - Always Required**
```javascript
SELECT t.*, c.name as category_name, c.type as category_type
FROM transactions t
JOIN categories c ON t.category_id = c.id
```
**Masalah:**
- Semua query selalu JOIN dengan categories
- Jika category dihapus atau tidak ada, transaksi tidak akan muncul (INNER JOIN)

**Dampak:**
- Transaksi dengan category yang sudah dihapus tidak akan muncul di hasil query
- Bisa jadi masalah jika ada data orphan

**Rekomendasi:**
- Pertimbangkan LEFT JOIN jika ingin tetap tampilkan transaksi meski category sudah dihapus
- Atau pastikan ada cascade delete/restore untuk category

---

### 5. **Sort Order - Hardcoded (Line 69-73)**
```javascript
if (sort === 'terbaru') {
  sql += ' ORDER BY t.transaction_date DESC, t.created_at DESC';
} else {
  sql += ' ORDER BY t.transaction_date ASC, t.created_at ASC';
}
```
**Masalah:**
- Hanya support 2 sort options: 'terbaru' dan lainnya
- Tidak fleksibel untuk sort by amount, category, dll

**Dampak:**
- Terbatas untuk kebutuhan sorting yang lebih kompleks

**Rekomendasi:**
- Tambahkan parameter `sortBy` dan `sortOrder` untuk lebih fleksibel
- Atau buat enum/constant untuk sort options

---

### 6. **Transaction.create - Expects categoryId**
```javascript
static async create({ userId, type, categoryId, amount, note, transactionDate })
```
**Status: ✅ Sudah Benar**
- Controller sudah handle dengan mencari category by name dulu, lalu convert ke ID
- Model tetap clean dengan menggunakan ID (foreign key)

---

### 7. **Soft Delete Implementation**
```javascript
static async softDelete(id) {
  const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
  await query(
    'UPDATE transactions SET status_deleted = true, deleted_at = ? WHERE id = ?',
    [now, id]
  );
}
```
**Masalah:**
- Format datetime manual dengan `toISOString().slice(0, 19).replace('T', ' ')`
- Tidak konsisten dengan format yang mungkin digunakan di tempat lain

**Rekomendasi:**
- Gunakan helper function untuk format datetime
- Atau gunakan MySQL function `NOW()` langsung di query

---

## ✅ Strengths

1. **Clean Separation of Concerns**
   - Model hanya handle database operations
   - Business logic ada di controller

2. **Comprehensive CRUD**
   - Support soft delete dan restore
   - Support hard delete untuk admin

3. **Flexible Filtering**
   - Support multiple filters (type, category, date range)
   - Support pagination

4. **Summary Method**
   - Built-in method untuk calculate summary
   - Efficient dengan single query

---

## 🔧 Recommended Improvements

### Priority 1 (High)
1. **Fix Date Filtering**
   - Gunakan `DATE()` function untuk extract date part
   - Pastikan konsisten dengan format date di database

2. **Add Unlimited Option**
   - Tambahkan opsi untuk bypass pagination limit
   - Atau buat method khusus untuk dashboard

### Priority 2 (Medium)
3. **Case-Insensitive Category Filter**
   - Update filter untuk case-insensitive

4. **Flexible Sorting**
   - Tambahkan parameter untuk sort by field dan order

### Priority 3 (Low)
5. **LEFT JOIN Option**
   - Tambahkan opsi untuk LEFT JOIN jika category dihapus

6. **Datetime Helper**
   - Buat helper function untuk format datetime konsisten

---

## 📊 Usage Statistics

**Dipergunakan di:**
- `transactionController.js` - CRUD operations
- `dashboardController.js` - 5x calls dengan limit 10000
- `exportController.js` - Export data

**Total Calls:**
- `findAll`: ~7 calls
- `create`: 1 call
- `update`: 1 call
- `getSummary`: 1 call

---

## 🎯 Conclusion

Model Transaction sudah cukup baik dengan struktur yang clean dan comprehensive CRUD operations. Namun ada beberapa improvement yang bisa dilakukan terutama untuk:
1. Date filtering yang lebih robust
2. Pagination yang lebih fleksibel
3. Category filter yang case-insensitive

Semua issues ini tidak critical tapi bisa improve user experience dan maintainability.

