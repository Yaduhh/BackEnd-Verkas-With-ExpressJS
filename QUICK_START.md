# 🚀 Quick Start Guide

## Step 1: Install Dependencies
```bash
cd BACKEND_VERKAS
npm install
```

## Step 2: Setup Database MySQL

1. **Buka MySQL:**
```bash
mysql -u root -p
```

2. **Create Database:**
```sql
CREATE DATABASE verkas_db;
EXIT;
```

## Step 3: Setup Environment

1. **Copy .env.example ke .env:**
```bash
cp .env.example .env
```

2. **Edit .env dengan credentials MySQL kamu:**
```env
DB_HOST=localhost
DB_PORT=3306
DB_USER=root
DB_PASSWORD=your_mysql_password
DB_NAME=verkas_db
JWT_SECRET=your-super-secret-key-change-this
```

## Step 4: Run Migrations
```bash
npm run migrate
```

Ini akan:
- ✅ Create semua tables
- ✅ Seed default categories
- ✅ Track migrations

## Step 5: Start Server
```bash
npm run dev
```

Server akan jalan di: `http://localhost:3000`

## 🧪 Test API

### 1. Health Check
```bash
curl http://localhost:3000/health
```

### 2. Create User (Manual via MySQL)
```sql
USE verkas_db;
INSERT INTO users (email, password_hash, name, role) 
VALUES ('admin@test.com', '$2b$10$YourHashedPassword', 'Admin', 'admin');
```

**Atau buat endpoint register** (optional)

### 3. Login
```bash
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@test.com","password":"yourpassword"}'
```

### 4. Get Categories
```bash
curl http://localhost:3000/api/categories?type=expense \
  -H "Authorization: Bearer YOUR_TOKEN"
```

## 📝 Migration Commands

```bash
# Check migration status
npm run migrate:status

# Run pending migrations
npm run migrate

# Rollback last batch
npm run migrate:rollback
```

## ⚠️ Troubleshooting

### Error: "ER_BAD_DB_ERROR"
- Database belum dibuat
- Jalankan: `CREATE DATABASE verkas_db;`

### Error: "Access denied for user"
- Cek credentials di `.env`
- Pastikan MySQL user punya akses

### Error: "Cannot find module"
- Jalankan: `npm install`

### Migration Error
- Cek apakah database sudah dibuat
- Cek credentials di `.env`
- Cek apakah tables sudah ada (jika ada, drop dulu atau skip migration)

## 🎯 Next Steps

1. ✅ Test semua endpoints dengan Postman/Thunder Client
2. ✅ Integrate dengan frontend
3. ✅ Add more validation jika perlu
4. ✅ Setup production environment

