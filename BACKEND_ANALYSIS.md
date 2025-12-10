# Analisis Backend - VERKAS Financial App

## 📋 Overview
Backend untuk aplikasi keuangan VERKAS dengan Express.js, database migration system, dan API untuk dashboard keuangan.

---

## 🗄️ Database Schema Analysis

### 1. **Users Table**
**Kebutuhan dari:** `LoginScreen.tsx`, `App.tsx` (role: owner/admin)

```sql
users
├── id (UUID/INTEGER PRIMARY KEY)
├── email (VARCHAR UNIQUE NOT NULL)
├── password_hash (VARCHAR NOT NULL) -- hashed dengan bcrypt
├── name (VARCHAR)
├── role (ENUM: 'owner', 'admin') NOT NULL
├── status_deleted (BOOLEAN DEFAULT false) -- Soft delete flag
├── deleted_at (TIMESTAMP NULL) -- Soft delete timestamp (audit trail)
├── created_at (TIMESTAMP)
└── updated_at (TIMESTAMP)
```

**Indexes:**
- `email` (UNIQUE) -- Note: email unique hanya untuk non-deleted users
- `role`
- `status_deleted` -- Untuk quick filter active users
- `deleted_at` -- Untuk audit trail & sorting

**Soft Delete Notes:**
- User yang di-delete tidak bisa login (`status_deleted = true`)
- Email tetap unique (hanya untuk active users)
- Bisa restore user jika diperlukan
- `status_deleted` untuk quick check, `deleted_at` untuk audit trail

---

### 2. **Categories Table**
**Kebutuhan dari:** `CategoryScreen.tsx`, `AddTransactionScreen.tsx`

```sql
categories
├── id (UUID/INTEGER PRIMARY KEY)
├── name (VARCHAR NOT NULL)
├── type (ENUM: 'income', 'expense') NOT NULL
├── user_id (INTEGER/FOREIGN KEY) -- NULL untuk kategori default
├── is_default (BOOLEAN DEFAULT false) -- kategori default sistem
├── status_deleted (BOOLEAN DEFAULT false) -- Soft delete flag
├── deleted_at (TIMESTAMP NULL) -- Soft delete timestamp (audit trail)
├── created_at (TIMESTAMP)
└── updated_at (TIMESTAMP)
```

**Indexes:**
- `user_id`
- `type`
- `status_deleted` -- Untuk quick filter active categories
- `deleted_at` -- Untuk audit trail & sorting
- `(name, type, user_id, status_deleted)` (UNIQUE) -- prevent duplicate (hanya untuk active)

**Soft Delete Notes:**
- Category yang di-delete tidak muncul di dropdown (`status_deleted = true`)
- Transaksi lama tetap bisa reference category yang sudah di-delete (untuk data integrity)
- Default categories (is_default=true) tidak bisa di-delete
- Bisa restore category jika diperlukan
- `status_deleted` untuk quick check, `deleted_at` untuk audit trail

**Default Categories:**
- **Expense:** Makanan, Minuman, Transport, Tagihan, Belanja, Kesehatan, Hiburan, Pendidikan, Hadiah, Lainnya
- **Income:** Gaji, Bonus, Side Job, Investasi

---

### 3. **Transactions Table**
**Kebutuhan dari:** `AdminDashboardScreen.tsx`, `AddTransactionScreen.tsx`

```sql
transactions
├── id (UUID/INTEGER PRIMARY KEY)
├── user_id (INTEGER/FOREIGN KEY NOT NULL)
├── type (ENUM: 'income', 'expense') NOT NULL
├── category_id (INTEGER/FOREIGN KEY NOT NULL)
├── amount (DECIMAL(15,2) NOT NULL) -- selalu positif, type menentukan income/expense
├── note (TEXT)
├── transaction_date (DATE NOT NULL) -- tanggal transaksi
├── status_deleted (BOOLEAN DEFAULT false) -- Soft delete flag
├── deleted_at (TIMESTAMP NULL) -- Soft delete timestamp (audit trail)
├── created_at (TIMESTAMP)
└── updated_at (TIMESTAMP)
```

**Indexes:**
- `user_id`
- `transaction_date`
- `category_id`
- `type`
- `status_deleted` -- Untuk quick filter active transactions
- `deleted_at` -- Untuk audit trail & sorting
- `(user_id, transaction_date, status_deleted)` -- untuk query dashboard (exclude deleted)
- `(user_id, transaction_date, type, status_deleted)` -- untuk filter

**Soft Delete Notes:**
- Transaction yang di-delete tidak muncul di dashboard & list (`status_deleted = true`)
- Dashboard summary TIDAK include deleted transactions
- Data tetap ada di database untuk audit trail
- Bisa restore transaction jika salah delete
- Export report bisa include/exclude deleted (optional parameter)
- `status_deleted` untuk quick check, `deleted_at` untuk audit trail

---

### 4. **Migration History Table** (untuk tracking migration)
```sql
migrations
├── id (INTEGER PRIMARY KEY AUTO_INCREMENT)
├── name (VARCHAR NOT NULL UNIQUE) -- nama file migration
├── executed_at (TIMESTAMP DEFAULT CURRENT_TIMESTAMP)
└── batch (INTEGER) -- batch number untuk rollback
```

---

## 🔌 API Endpoints Analysis

### **Authentication**
```
POST   /api/auth/login
POST   /api/auth/logout
POST   /api/auth/refresh
GET    /api/auth/me
```

**Login Request:**
```json
{
  "email": "user@example.com",
  "password": "password123"
}
```

**Login Response:**
```json
{
  "success": true,
  "data": {
    "token": "jwt_token_here",
    "user": {
      "id": 1,
      "email": "user@example.com",
      "name": "User Name",
      "role": "admin"
    }
  }
}
```

---

### **Transactions**
```
GET    /api/transactions                    -- List dengan filter & pagination (exclude deleted)
GET    /api/transactions/:id                 -- Detail transaksi
POST   /api/transactions                     -- Create transaksi
PUT    /api/transactions/:id                 -- Update transaksi
DELETE /api/transactions/:id                 -- Soft delete transaksi
POST   /api/transactions/:id/restore         -- Restore deleted transaksi
DELETE /api/transactions/:id/force           -- Hard delete (permanent, admin only)
```

**Create Transaction Request:**
```json
{
  "type": "expense",
  "category": "Makanan",
  "amount": 50000,
  "note": "Makan siang",
  "date": "2024-01-15"
}
```

**List Transactions Query Params:**
- `page` (default: 1)
- `limit` (default: 20)
- `type` (income/expense)
- `category` (category name)
- `start_date` (YYYY-MM-DD)
- `end_date` (YYYY-MM-DD)
- `sort` (terbaru/terlama, default: terbaru)
- `include_deleted` (boolean, default: false) -- Include deleted transactions
- `only_deleted` (boolean, default: false) -- Only show deleted transactions

**Delete Response:**
```json
{
  "success": true,
  "message": "Transaction deleted successfully",
  "data": {
    "id": 1,
    "deleted_at": "2024-01-15T10:30:00Z"
  }
}
```

**Restore Response:**
```json
{
  "success": true,
  "message": "Transaction restored successfully",
  "data": {
    "id": 1,
    "deleted_at": null
  }
}
```

---

### **Dashboard Data**
```
GET    /api/dashboard/harian?date=2024-01-15
GET    /api/dashboard/mingguan?year=2024&month=1&week=2
GET    /api/dashboard/bulanan?year=2024&month=1
GET    /api/dashboard/tahunan?year=2024
```

**Response Structure (sesuai AdminDashboardScreen.tsx):**
```json
{
  "success": true,
  "data": {
    "title": "21 Sep 2021",
    "summary": {
      "pemasukan": 4000000,
      "pengeluaran": 325000,
      "saldo": 3675000
    },
    "sections": [
      {
        "dateLabel": "21",
        "dayLabel": "Selasa",
        "monthLabel": "09.2021",
        "headerIncome": 0,
        "headerExpense": 325000,
        "items": [
          {
            "category": "Makanan",
            "note": "makan malam",
            "amount": -325000
          }
        ]
      }
    ]
  }
}
```

---

### **Categories**
```
GET    /api/categories?type=expense          -- List kategori (exclude deleted)
GET    /api/categories/:id                  -- Detail kategori
POST   /api/categories                       -- Create kategori
PUT    /api/categories/:id                  -- Update kategori
DELETE /api/categories/:id                  -- Soft delete kategori
POST   /api/categories/:id/restore          -- Restore deleted kategori
DELETE /api/categories/:id/force            -- Hard delete (permanent, admin only)
```

**Create Category Request:**
```json
{
  "name": "Makanan",
  "type": "expense"
}
```

**List Categories Query Params:**
- `type` (income/expense)
- `include_deleted` (boolean, default: false)
- `only_deleted` (boolean, default: false)

**Delete Category Rules:**
- Default categories (is_default=true) tidak bisa di-delete
- Category yang masih dipakai di transactions bisa di-delete (soft delete)
- Restore category akan membuatnya available lagi di dropdown

---

### **Export Report**
```
POST   /api/export
```

**Export Request:**
```json
{
  "title": "Laporan Keuangan",
  "from_date": "2024-01-01",
  "to_date": "2024-01-31",
  "category": "Semua Kategori",
  "format": "XLS", // XLS, CSV, PDF
  "include_deleted": false // Optional: include deleted transactions
}
```

**Response:** File download (binary)

**Export Notes:**
- Default: exclude deleted transactions
- Jika `include_deleted: true`, akan include deleted transactions dengan label khusus

---

## 🏗️ Project Structure

```
backend/
├── server.js                 # Entry point
├── package.json
├── .env                      # Environment variables
├── .gitignore
│
├── config/
│   ├── database.js           # Database connection
│   └── config.js             # App configuration
│
├── migrations/
│   ├── 001_create_users_table.js
│   ├── 002_create_categories_table.js
│   ├── 003_create_transactions_table.js
│   ├── 004_create_migrations_table.js
│   ├── 005_seed_default_categories.js
│   └── 006_add_soft_delete_columns.js (optional, jika soft delete ditambahkan belakangan)
│
├── models/
│   ├── User.js
│   ├── Category.js
│   ├── Transaction.js
│   └── Migration.js
│
├── controllers/
│   ├── authController.js
│   ├── transactionController.js
│   ├── categoryController.js
│   ├── dashboardController.js
│   └── exportController.js
│
├── routes/
│   ├── authRoutes.js
│   ├── transactionRoutes.js
│   ├── categoryRoutes.js
│   ├── dashboardRoutes.js
│   └── exportRoutes.js
│
├── middleware/
│   ├── auth.js               # JWT authentication
│   ├── errorHandler.js       # Error handling
│   └── validator.js           # Request validation
│
├── utils/
│   ├── migrationRunner.js     # Migration system
│   ├── dateHelper.js         # Date utilities
│   └── exportHelper.js       # Export utilities (XLS, CSV, PDF)
│
└── tests/                    # (Optional) Unit tests
```

---

## 🔧 Technology Stack

### **Core:**
- **Express.js** - Web framework
- **Node.js** - Runtime

### **Database:**
- **SQLite** (development) atau **PostgreSQL** (production)
- **better-sqlite3** atau **pg** (PostgreSQL driver)

### **Authentication:**
- **jsonwebtoken** (JWT)
- **bcrypt** (password hashing)

### **Validation:**
- **express-validator** atau **joi**

### **Export:**
- **xlsx** (Excel)
- **csv-writer** (CSV)
- **pdfkit** atau **puppeteer** (PDF)

### **Utilities:**
- **dotenv** (environment variables)
- **cors** (CORS handling)
- **helmet** (security)

---

## 📝 Migration System Requirements

### **Features:**
1. ✅ Track semua migration yang sudah dijalankan
2. ✅ Migration file naming: `001_description.js`, `002_description.js`
3. ✅ Batch system untuk rollback
4. ✅ Up & Down methods di setiap migration
5. ✅ Migration history table untuk tracking

### **Migration File Structure:**
```javascript
// migrations/001_create_users_table.js
module.exports = {
  up: async (db) => {
    // Create table with soft delete
    await db.run(`
      CREATE TABLE users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email VARCHAR(255) NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        name VARCHAR(255),
        role VARCHAR(20) NOT NULL CHECK(role IN ('owner', 'admin')),
        status_deleted BOOLEAN DEFAULT false,
        deleted_at DATETIME NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);
    
    // Unique constraint hanya untuk active users (status_deleted = false)
    // Note: SQLite tidak support WHERE di CREATE INDEX, handle di application level
    await db.run(`CREATE INDEX idx_users_email ON users(email)`);
    await db.run(`CREATE INDEX idx_users_role ON users(role)`);
    await db.run(`CREATE INDEX idx_users_status_deleted ON users(status_deleted)`);
    await db.run(`CREATE INDEX idx_users_deleted_at ON users(deleted_at)`);
  },
  
  down: async (db) => {
    await db.run(`DROP TABLE IF EXISTS users`);
  }
};
```

**Note:** SQLite tidak support `WHERE` di CREATE INDEX. Untuk SQLite, gunakan:
```javascript
// SQLite alternative: Create partial index dengan trigger atau handle di application level
await db.run(`CREATE INDEX idx_users_email ON users(email)`);
// Unique constraint di-handle di application level dengan check deleted_at IS NULL
```

### **Migration Runner:**
- `npm run migrate` - Run pending migrations
- `npm run migrate:rollback` - Rollback last batch
- `npm run migrate:status` - Check migration status

---

## 🔐 Security Considerations

1. **Password Hashing:** bcrypt dengan salt rounds 10+
2. **JWT:** Expire time 24 jam, refresh token mechanism
3. **Input Validation:** Sanitize semua input
4. **SQL Injection:** Gunakan parameterized queries
5. **CORS:** Configure untuk frontend domain
6. **Rate Limiting:** Untuk login endpoint

---

## 📊 Data Flow Analysis

### **Dashboard Harian:**
1. User pilih tanggal → `GET /api/dashboard/harian?date=2024-01-15`
2. Backend query transactions untuk tanggal tersebut
3. Group by date, calculate summary
4. Return format sesuai `AdminDashboardScreen.tsx`

### **Dashboard Mingguan:**
1. User pilih week → `GET /api/dashboard/mingguan?year=2024&month=1&week=2`
2. Backend calculate week range (start-end date)
3. Query transactions dalam range
4. Group by week, calculate summary per week

### **Dashboard Bulanan:**
1. User pilih month → `GET /api/dashboard/bulanan?year=2024&month=1`
2. Query transactions untuk bulan tersebut
3. Group by day, calculate summary

### **Dashboard Tahunan:**
1. User pilih year → `GET /api/dashboard/tahunan?year=2024`
2. Query transactions untuk tahun tersebut
3. Group by month, calculate summary

---

## 🎯 Priority Implementation

### **Phase 1 (Core):**
1. ✅ Database setup & migration system
2. ✅ Users table & authentication
3. ✅ Categories table & CRUD
4. ✅ Transactions table & CRUD

### **Phase 2 (Dashboard):**
5. ✅ Dashboard Harian API
6. ✅ Dashboard Mingguan API
7. ✅ Dashboard Bulanan API
8. ✅ Dashboard Tahunan API

### **Phase 3 (Advanced):**
9. ✅ Export functionality
10. ✅ Filter & Sort
11. ✅ Pagination
12. ✅ Search

---

## 🗑️ Soft Delete Implementation

### **Strategy:**
Menggunakan kombinasi `status_deleted` (BOOLEAN) dan `deleted_at` (TIMESTAMP):
- `status_deleted = false` + `deleted_at = NULL` → Record aktif
- `status_deleted = true` + `deleted_at = TIMESTAMP` → Record di-delete (soft delete)

**Kenapa kombinasi?**
- `status_deleted` (BOOLEAN) → Quick filtering, lebih cepat untuk query
- `deleted_at` (TIMESTAMP) → Audit trail, track kapan di-delete

### **Query Pattern:**
```sql
-- Get active records (recommended: pakai status_deleted untuk performa)
SELECT * FROM table_name WHERE status_deleted = false;

-- Atau bisa pakai deleted_at
SELECT * FROM table_name WHERE deleted_at IS NULL;

-- Get deleted records
SELECT * FROM table_name WHERE status_deleted = true;
-- atau
SELECT * FROM table_name WHERE deleted_at IS NOT NULL;

-- Get all (including deleted)
SELECT * FROM table_name;
```

### **Soft Delete Rules:**

#### **Users:**
- ✅ Soft delete enabled
- ❌ Tidak bisa login jika `status_deleted = true`
- ✅ Email unique hanya untuk active users (`status_deleted = false`)
- ✅ Bisa restore user
- ✅ `status_deleted` untuk quick check, `deleted_at` untuk audit trail

#### **Categories:**
- ✅ Soft delete enabled
- ❌ Default categories (`is_default=true`) tidak bisa di-delete
- ✅ Category yang di-delete tidak muncul di dropdown (`status_deleted = true`)
- ✅ Transaksi lama tetap reference category (data integrity)
- ✅ Bisa restore category
- ✅ `status_deleted` untuk quick check, `deleted_at` untuk audit trail

#### **Transactions:**
- ✅ Soft delete enabled
- ✅ Tidak muncul di dashboard jika deleted (`status_deleted = true`)
- ✅ Dashboard summary exclude deleted transactions
- ✅ Bisa restore transaction
- ✅ Export bisa include/exclude deleted (optional)
- ✅ `status_deleted` untuk quick check, `deleted_at` untuk audit trail

### **Restore Endpoint:**
Semua table yang support soft delete punya endpoint restore:
```
POST /api/{resource}/:id/restore
```

### **Force Delete (Hard Delete):**
Untuk permanent delete (admin only):
```
DELETE /api/{resource}/:id/force
```

**Warning:** Force delete tidak bisa di-undo!

### **Migration untuk Soft Delete:**
```sql
-- Add status_deleted column
ALTER TABLE table_name ADD COLUMN status_deleted BOOLEAN DEFAULT false;

-- Add deleted_at column
ALTER TABLE table_name ADD COLUMN deleted_at TIMESTAMP NULL;

-- Add indexes for performance
CREATE INDEX idx_table_name_status_deleted ON table_name(status_deleted);
CREATE INDEX idx_table_name_deleted_at ON table_name(deleted_at);

-- Update unique constraint (jika ada)
-- Example: categories (name, type, user_id) unique
-- Harus include status_deleted dalam unique constraint atau filter
```

### **Model Helper Methods:**
```javascript
// Example: Transaction model
class Transaction {
  // Get active transactions (recommended: pakai status_deleted)
  static findActive(conditions) {
    return db.query(
      'SELECT * FROM transactions WHERE status_deleted = false AND ...',
      conditions
    );
  }
  
  // Soft delete (update kedua field)
  static softDelete(id) {
    const now = new Date().toISOString();
    return db.run(
      'UPDATE transactions SET status_deleted = true, deleted_at = ? WHERE id = ?',
      [now, id]
    );
  }
  
  // Restore (reset kedua field)
  static restore(id) {
    return db.run(
      'UPDATE transactions SET status_deleted = false, deleted_at = NULL WHERE id = ?',
      [id]
    );
  }
  
  // Hard delete (permanent)
  static hardDelete(id) {
    return db.run('DELETE FROM transactions WHERE id = ?', [id]);
  }
  
  // Get deleted transactions
  static findDeleted(conditions) {
    return db.query(
      'SELECT * FROM transactions WHERE status_deleted = true AND ...',
      conditions
    );
  }
}
```

### **Dashboard Query dengan Soft Delete:**
```sql
-- Dashboard Harian (exclude deleted) - Recommended: pakai status_deleted
SELECT 
  DATE(transaction_date) as date,
  SUM(CASE WHEN type = 'income' THEN amount ELSE 0 END) as pemasukan,
  SUM(CASE WHEN type = 'expense' THEN amount ELSE 0 END) as pengeluaran
FROM transactions
WHERE user_id = ? 
  AND transaction_date = ?
  AND status_deleted = false  -- Exclude deleted (lebih cepat)
GROUP BY DATE(transaction_date);

-- Atau bisa pakai deleted_at
-- WHERE deleted_at IS NULL
```

### **Benefits:**
1. ✅ Data integrity - tidak kehilangan data
2. ✅ Audit trail - bisa track apa yang di-delete
3. ✅ Recovery - bisa restore jika salah delete
4. ✅ Dashboard accuracy - exclude deleted dari summary
5. ✅ User experience - bisa undo delete

---

## 📝 Notes

1. **Amount Storage:** 
   - Simpan sebagai DECIMAL positif
   - Type field menentukan income/expense
   - Frontend bisa convert ke negatif untuk expense

2. **Date Handling:**
   - Simpan sebagai DATE type
   - Timezone: UTC atau sesuai user preference

3. **Category Default:**
   - Seed default categories saat migration
   - User bisa tambah custom categories
   - Default categories tidak bisa di-delete

4. **Transaction Date:**
   - User bisa set tanggal transaksi (bukan hanya created_at)
   - Penting untuk dashboard filtering

5. **Soft Delete:**
   - Menggunakan kombinasi `status_deleted` (BOOLEAN) + `deleted_at` (TIMESTAMP)
   - `status_deleted` untuk quick filtering (lebih cepat)
   - `deleted_at` untuk audit trail (track kapan di-delete)
   - Semua delete operations default ke soft delete
   - Dashboard & list queries exclude deleted records (`status_deleted = false`)
   - Restore endpoint untuk undo delete (reset kedua field)
   - Force delete hanya untuk admin (permanent delete)

---

## ✅ Checklist

- [x] Database schema design
- [x] API endpoints design
- [x] Migration system design
- [x] Project structure
- [x] Technology stack
- [x] Soft delete implementation
- [x] Restore endpoints
- [x] Force delete (hard delete)
- [ ] Implementation (next step)

