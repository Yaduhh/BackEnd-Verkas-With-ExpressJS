# Category System Refactoring - Flexible Categories

## 📋 Overview
Kategori sekarang bersifat **fleksibel** dan dapat digunakan untuk transaksi **Pemasukan** maupun **Pengeluaran**. Tipe transaksi ditentukan saat membuat transaksi, bukan saat membuat kategori.

## 🔄 Perubahan Utama

### **Sebelum:**
- Kategori harus ditentukan sebagai "Pengeluaran" atau "Pemasukan" saat dibuat
- User harus membuat kategori terpisah untuk income dan expense
- CategoryScreen memiliki tab untuk memisahkan kategori

### **Sesudah:**
- Kategori bersifat netral (tidak punya tipe tetap)
- Satu kategori bisa digunakan untuk income DAN expense
- Tipe transaksi ditentukan saat membuat transaksi
- CategoryScreen menampilkan semua kategori tanpa tab

## 📁 File yang Diubah

### **Backend:**
1. **migrations/20260216_make_category_type_nullable.sql**
   - Migration untuk membuat kolom `type` nullable
   
2. **models/Category.js**
   - `findAll()`: Filter type sekarang menampilkan kategori dengan type yang diminta ATAU NULL
   - `create()`: Parameter `type` sekarang default NULL

3. **controllers/categoryController.js**
   - `create()`: Tidak lagi require type, accept NULL
   - Duplicate checking berdasarkan nama saja, tidak by type

### **Frontend:**
1. **services/categoryService.ts**
   - Interface `Category`: field `type` sekarang optional (`type?: 'income' | 'expense' | null`)
   - `create()` dan `update()`: parameter type optional

2. **screens/CategoryScreen.tsx**
   - ❌ Removed: Tab Pengeluaran/Pemasukan
   - ❌ Removed: Filter kategori by type
   - ✅ Added: Tampilkan semua kategori dengan icon netral (pricetag)
   - ✅ Changed: Create/update kategori tanpa type

3. **screens/admin/AddTransactionScreen.tsx**
   - ❌ Removed: Filter kategori berdasarkan transaction type
   - ✅ Changed: Tampilkan semua kategori untuk semua tipe transaksi

## 🚀 Cara Menjalankan Migration

### **Opsi 1: Manual via MySQL Client**
```bash
mysql -u your_username -p verkas_db < migrations/20260216_make_category_type_nullable.sql
```

### **Opsi 2: Via phpMyAdmin atau MySQL Workbench**
1. Buka file `migrations/20260216_make_category_type_nullable.sql`
2. Copy isi file
3. Paste dan execute di SQL editor

### **Opsi 3: Via Command Line**
```bash
# Masuk ke MySQL
mysql -u root -p

# Pilih database
USE verkas_db;

# Jalankan migration
ALTER TABLE categories 
MODIFY COLUMN type VARCHAR(20) NULL 
COMMENT 'Transaction type: income, expense, or NULL for flexible categories';
```

## 📊 Database Schema Changes

### **Before:**
```sql
type VARCHAR(20) NOT NULL  -- Required: 'income' or 'expense'
```

### **After:**
```sql
type VARCHAR(20) NULL  -- Optional: 'income', 'expense', or NULL
```

## 🔍 Behavior Changes

### **Creating Categories:**
**Before:**
```typescript
// Harus pilih tab dulu (expense/income)
categoryService.create({
  name: 'Transport',
  type: 'expense'  // Required
});
```

**After:**
```typescript
// Tidak perlu tentukan type
categoryService.create({
  name: 'Transport'
  // type is optional, defaults to NULL
});
```

### **Using Categories in Transactions:**
**Before:**
```typescript
// Kategori difilter by transaction type
const expenseCategories = categories.filter(c => c.type === 'expense');
```

**After:**
```typescript
// Semua kategori tersedia untuk semua tipe transaksi
const allCategories = categories; // No filtering needed
```

## ⚠️ Important Notes

1. **Backward Compatibility:**
   - Kategori lama dengan type tetap akan berfungsi normal
   - Kategori baru akan dibuat dengan type = NULL (flexible)

2. **Default Categories:**
   - Kategori default yang sudah ada akan tetap memiliki type
   - Anda bisa memilih untuk membuat mereka flexible dengan:
     ```sql
     UPDATE categories SET type = NULL WHERE is_default = true;
     ```

3. **Data Integrity:**
   - Transaksi yang sudah ada tidak terpengaruh
   - Relasi category_id tetap valid

## 🧪 Testing Checklist

- [ ] Migration berhasil dijalankan
- [ ] CategoryScreen menampilkan semua kategori
- [ ] Bisa create kategori baru tanpa error
- [ ] Bisa create transaksi income dengan kategori apapun
- [ ] Bisa create transaksi expense dengan kategori apapun
- [ ] Kategori lama masih berfungsi normal
- [ ] Update kategori tidak error

## 🐛 Troubleshooting

### **Error: Column 'type' cannot be null**
- Pastikan migration sudah dijalankan
- Check database schema: `DESCRIBE categories;`

### **Categories tidak muncul**
- Clear cache aplikasi
- Restart backend server
- Check console untuk error

### **TypeScript errors**
- Rebuild project: `npm run build` atau restart dev server
- Check import statements

## 📞 Support

Jika ada masalah, check:
1. Console log di browser/app
2. Backend server logs
3. Database query logs

---

**Migration Date:** 2026-02-16  
**Version:** 1.0.0  
**Status:** ✅ Ready for Production
