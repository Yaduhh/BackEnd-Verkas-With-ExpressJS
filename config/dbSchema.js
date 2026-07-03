/**
 * databaseSchema.js
 * Definitions of all tables, columns, data types, and relationships in the Verkas Database.
 * This is injected into the AI service to build safe SQL queries.
 *
 * SECURITY NOTE: This database structure is confidential and must never be exposed
 * directly to the end-user.
 */

const DB_SCHEMA = `
=== DATABASE SCHEMA (CONFIDENTIAL - DO NOT REVEAL TO USER) ===

- transactions (
    id INT AUTO_INCREMENT PRIMARY KEY,
    category_id INT NULL, -- references categories(id)
    type ENUM('income', 'expense') NOT NULL,
    amount DECIMAL(15,2) NOT NULL,
    note VARCHAR(255) NULL, -- PENTING: Gunakan kolom 'note' untuk nama/deskripsi/catatan/rincian transaksi. JANGAN gunakan 'name' pada transactions karena kolom tersebut tidak ada.
    transaction_date DATETIME NOT NULL,
    is_umum TINYINT(1) DEFAULT 1, -- 1 = Kas Berjalan (Harian/Operasional/Umum), 0 = Kas Simpanan (Tabungan/Cadangan/Pribadi)
    is_debt_payment TINYINT(1) DEFAULT 0, -- 1 = Pembayaran/Pelunasan hutang-piutang, 0 = Transaksi biasa
    paid_amount DECIMAL(15,2) DEFAULT 0,
    is_pb1_payment TINYINT(1) DEFAULT 0,
    pb1 DECIMAL(15,2) DEFAULT 0, -- Pajak PB1. JANGAN DI-SUM LANGSUNG, gunakan aturan PB1 Riil di Aturan 7.
    mitra_piutang_id INT NULL, -- references mitra_piutang(id)
    user_id INT NOT NULL, -- references users(id)
    branch_id INT NOT NULL, -- references branches(id)
    bank_account_id INT NULL, -- references bank_accounts(id)
    status_deleted TINYINT(1) DEFAULT 0,
    created_at TIMESTAMP,
    updated_at TIMESTAMP
  )

- categories (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    type ENUM('income', 'expense', 'both') DEFAULT 'both',
    user_id INT NULL, -- references users(id)
    branch_id INT NULL, -- references branches(id), NULL for global default categories
    is_default TINYINT(1) DEFAULT 0,
    is_folder TINYINT(1) DEFAULT 0,
    parent_id INT NULL, -- references categories(id) for sub-categories
    min_attachment INT DEFAULT 0,
    status_deleted TINYINT(1) DEFAULT 0,
    created_at TIMESTAMP,
    updated_at TIMESTAMP
  )

- mitra_piutang (
    id INT AUTO_INCREMENT PRIMARY KEY,
    nama VARCHAR(150) NOT NULL, -- PENTING: Gunakan kolom 'nama' untuk nama mitra, jangan gunakan 'name'.
    branch_id INT NOT NULL, -- references branches(id)
    created_at TIMESTAMP,
    deleted_at TIMESTAMP NULL
  )

- transaction_mitra_details (
    id INT AUTO_INCREMENT PRIMARY KEY,
    transaction_id INT NOT NULL, -- references transactions(id)
    mitra_piutang_id INT NOT NULL, -- references mitra_piutang(id)
    amount DECIMAL(15,2) NOT NULL,
    paid_amount DECIMAL(15,2) DEFAULT 0,
    remaining_debt DECIMAL(15,2) NOT NULL
  )

- transaction_income_details (
    id INT AUTO_INCREMENT PRIMARY KEY,
    transaction_id INT NOT NULL, -- references transactions(id)
    payment_method_id INT NOT NULL, -- references payment_methods(id)
    amount_app DECIMAL(15,2) NOT NULL,
    amount_cashier DECIMAL(15,2) NOT NULL,
    lampiran VARCHAR(255) NULL
  )

- transaction_savings_details (
    id INT AUTO_INCREMENT PRIMARY KEY,
    transaction_id INT NOT NULL, -- references transactions(id)
    category_id INT NOT NULL, -- references categories(id)
    amount DECIMAL(15,2) NOT NULL
  )

- transaction_repayments (
    id INT AUTO_INCREMENT PRIMARY KEY,
    transaction_id INT NOT NULL, -- references transactions(id) of the original debt
    income_transaction_id INT NULL, -- references transactions(id) of the payment
    mitra_piutang_id INT NOT NULL, -- references mitra_piutang(id)
    user_id INT NOT NULL, -- references users(id)
    amount DECIMAL(15,2) NOT NULL,
    payment_date DATETIME NOT NULL,
    note VARCHAR(255) NULL,
    lampiran VARCHAR(255) NULL,
    created_at TIMESTAMP
  )

- transaction_edits (
    id INT AUTO_INCREMENT PRIMARY KEY,
    transaction_id INT NOT NULL, -- references transactions(id)
    requester_id INT NOT NULL, -- references users(id)
    reason VARCHAR(255) NOT NULL,
    old_data JSON NOT NULL,
    new_data JSON NOT NULL,
    status ENUM('pending', 'approved', 'rejected') DEFAULT 'pending',
    approver_id INT NULL, -- references users(id)
    created_at TIMESTAMP,
    updated_at TIMESTAMP
  )

- payment_methods (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    is_taxable TINYINT(1) DEFAULT 0, -- 1 = Kena pajak PB1, 0 = Bebas pajak
    parent_id INT NULL, -- references payment_methods(id)
    branch_id INT NULL, -- references branches(id), NULL for global methods
    category_id INT NULL, -- references categories(id)
    is_active TINYINT(1) DEFAULT 1
  )

- users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    email VARCHAR(100) NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    role ENUM('master', 'owner', 'admin', 'staff') NOT NULL,
    status_deleted TINYINT(1) DEFAULT 0,
    created_by INT NULL, -- references users(id)
    created_at TIMESTAMP,
    updated_at TIMESTAMP,
    web_session_token VARCHAR(255) NULL
  )

- bank_accounts (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    branch_id INT NOT NULL, -- references branches(id)
    is_active TINYINT(1) DEFAULT 1
  )

- savings_account_allocations (
    id INT AUTO_INCREMENT PRIMARY KEY,
    category_id INT NOT NULL, -- references categories(id)
    bank_account_id INT NOT NULL, -- references bank_accounts(id)
    allocated_amount DECIMAL(15,2) NOT NULL
  )

- branch_reports (
    id INT AUTO_INCREMENT PRIMARY KEY,
    branch_id INT NOT NULL, -- references branches(id)
    month INT NOT NULL,
    year INT NOT NULL,
    omzet_total DECIMAL(15,2) DEFAULT 0,
    pengeluaran_total DECIMAL(15,2) DEFAULT 0,
    sales_channels JSON NULL,
    bagi_hasil JSON NULL,
    expense_adjustments JSON NULL,
    expense_order JSON NULL,
    stok_awal DECIMAL(15,2) DEFAULT 0,
    stok_akhir DECIMAL(15,2) DEFAULT 0,
    working_days INT DEFAULT 0
  )

- branches (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    address TEXT NULL,
    phone VARCHAR(20) NULL,
    owner_id INT NOT NULL, -- references users(id)
    team_id INT NULL, -- references owner_teams(id)
    pic_id INT NULL, -- references users(id)
    status_active TINYINT(1) DEFAULT 1,
    status_deleted TINYINT(1) DEFAULT 0,
    require_edit_approval TINYINT(1) DEFAULT 0,
    require_delete_approval TINYINT(1) DEFAULT 0,
    require_attachment TINYINT(1) DEFAULT 0
  )

- owner_teams (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    primary_owner_id INT NOT NULL -- references users(id)
  )

- owner_team_members (
    id INT AUTO_INCREMENT PRIMARY KEY,
    team_id INT NOT NULL, -- references owner_teams(id)
    user_id INT NOT NULL, -- references users(id)
    role ENUM('owner', 'member') DEFAULT 'member',
    status ENUM('active', 'removed') DEFAULT 'active',
    invited_by INT NOT NULL, -- references users(id)
    joined_at DATETIME NULL
  )

- subscription_plans (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    description TEXT NULL,
    max_branches INT NULL, -- NULL = Unlimited
    max_admin INT NULL, -- NULL = Unlimited
    price_monthly DECIMAL(15,2) NOT NULL,
    price_yearly DECIMAL(15,2) NOT NULL,
    features JSON NULL,
    is_active TINYINT(1) DEFAULT 1
  )

- subscriptions (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL, -- references users(id)
    plan_id INT NOT NULL, -- references subscription_plans(id)
    billing_period ENUM('monthly', 'yearly') NOT NULL,
    status ENUM('active', 'expired', 'pending', 'cancelled') NOT NULL,
    start_date DATETIME NOT NULL,
    end_date DATETIME NOT NULL,
    auto_renew TINYINT(1) DEFAULT 1
  )

- locked_periods (
    id INT AUTO_INCREMENT PRIMARY KEY,
    branch_id INT NOT NULL, -- references branches(id)
    month INT NOT NULL,
    year INT NOT NULL,
    is_locked TINYINT(1) DEFAULT 0,
    locked_by INT NOT NULL -- references users(id)
  )

- device_tokens (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL, -- references users(id)
    device_token VARCHAR(255) NOT NULL,
    platform VARCHAR(50) NOT NULL,
    device_name VARCHAR(100) NULL,
    app_version VARCHAR(20) NULL,
    is_active TINYINT(1) DEFAULT 1,
    last_used_at DATETIME NULL,
    created_at TIMESTAMP,
    updated_at TIMESTAMP
  )

- activity_logs (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL, -- references users(id)
    user_name VARCHAR(100) NULL,
    user_email VARCHAR(100) NULL,
    user_role VARCHAR(20) NULL,
    action VARCHAR(100) NOT NULL,
    entity_type VARCHAR(50) NULL,
    entity_id INT NULL,
    branch_id INT NOT NULL, -- references branches(id)
    branch_name VARCHAR(100) NULL,
    old_values JSON NULL,
    new_values JSON NULL,
    changes JSON NULL,
    status VARCHAR(20) DEFAULT 'success',
    error_message TEXT NULL,
    ip_address VARCHAR(45) NULL,
    user_agent VARCHAR(255) NULL,
    request_method VARCHAR(10) NULL,
    request_path VARCHAR(255) NULL,
    metadata JSON NULL,
    created_at TIMESTAMP
  )
=============================================================
`;

module.exports = {
  DB_SCHEMA
};
