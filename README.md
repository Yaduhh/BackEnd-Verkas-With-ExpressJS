# BACKEND_VERKAS

Backend API untuk aplikasi keuangan VERKAS menggunakan Express.js dan MySQL.

## 🚀 Setup

### 1. Install Dependencies
```bash
npm install
```

### 2. Setup Database
1. Buat database MySQL:
```sql
CREATE DATABASE verkas_db;
```

2. Copy `.env.example` ke `.env`:
```bash
cp .env.example .env
```

3. Edit `.env` dengan konfigurasi database Anda:
```env
DB_HOST=localhost
DB_PORT=3306
DB_USER=root
DB_PASSWORD=your_password
DB_NAME=verkas_db
JWT_SECRET=your-super-secret-jwt-key
```

### 3. Run Migrations
```bash
npm run migrate
```

Ini akan:
- Membuat semua tables (users, categories, transactions, migrations)
- Seed default categories

### 4. Start Server
```bash
# Development (with nodemon)
npm run dev

# Production
npm start
```

Server akan berjalan di `http://localhost:3000`

## 📋 Migration Commands

```bash
# Run pending migrations
npm run migrate

# Rollback last batch
npm run migrate:rollback

# Check migration status
npm run migrate:status
```

## 🔌 API Endpoints

### Authentication
- `POST /api/auth/login` - Login
- `POST /api/auth/logout` - Logout
- `GET /api/auth/me` - Get current user

### Transactions
- `GET /api/transactions` - List transactions (with filters)
- `GET /api/transactions/:id` - Get transaction by ID
- `POST /api/transactions` - Create transaction
- `PUT /api/transactions/:id` - Update transaction
- `DELETE /api/transactions/:id` - Soft delete
- `POST /api/transactions/:id/restore` - Restore deleted
- `DELETE /api/transactions/:id/force` - Hard delete (admin only)

### Categories
- `GET /api/categories` - List categories
- `GET /api/categories/:id` - Get category by ID
- `POST /api/categories` - Create category
- `PUT /api/categories/:id` - Update category
- `DELETE /api/categories/:id` - Soft delete
- `POST /api/categories/:id/restore` - Restore deleted
- `DELETE /api/categories/:id/force` - Hard delete (admin only)

### Dashboard
- `GET /api/dashboard/harian?date=2024-01-15`
- `GET /api/dashboard/mingguan?year=2024&month=1&week=2`
- `GET /api/dashboard/bulanan?year=2024&month=1`
- `GET /api/dashboard/tahunan?year=2024`

### Export
- `POST /api/export` - Export report (XLS, CSV, PDF)

## 🔐 Authentication

Semua endpoint kecuali `/api/auth/login` memerlukan JWT token di header:
```
Authorization: Bearer <token>
```

## 📝 Notes

- Soft delete menggunakan `status_deleted` (BOOLEAN) + `deleted_at` (TIMESTAMP)
- Default categories tidak bisa di-delete
- Export files akan otomatis dihapus setelah 5 detik
- Semua query exclude deleted records secara default

## 🛠️ Tech Stack

- Express.js
- MySQL2
- JWT (jsonwebtoken)
- bcrypt
- express-validator
- xlsx, csv-writer, pdfkit (export)

