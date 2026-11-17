module.exports = {
  up: async ({ query }) => {
    // 1. Add default_bank_account_id to payment_methods (strictly additive)
    const pmCols = await query(`SHOW COLUMNS FROM payment_methods LIKE 'default_bank_account_id'`);
    if (!pmCols || pmCols.length === 0) {
      await query(`
        ALTER TABLE payment_methods
        ADD COLUMN default_bank_account_id INT NULL DEFAULT NULL AFTER is_active,
        ADD CONSTRAINT fk_pm_default_bank_account
          FOREIGN KEY (default_bank_account_id) REFERENCES bank_accounts(id) ON DELETE SET NULL
      `);
      console.log('  Added default_bank_account_id to payment_methods');
    }

    // 2. Branch monthly targets (Target Sales, TC, APC per branch per month)
    await query(`
      CREATE TABLE IF NOT EXISTS branch_monthly_targets (
        id INT AUTO_INCREMENT PRIMARY KEY,
        branch_id INT NOT NULL,
        month TINYINT NOT NULL,
        year SMALLINT NOT NULL,
        target_sales DECIMAL(15,2) NOT NULL DEFAULT 0,
        target_tc INT NOT NULL DEFAULT 0,
        target_apc DECIMAL(15,2) NOT NULL DEFAULT 0,
        updated_by INT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uq_bmt_branch_period (branch_id, year, month),
        CONSTRAINT fk_bmt_branch FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE CASCADE,
        CONSTRAINT fk_bmt_user FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);
    console.log('  Created branch_monthly_targets table');

    // 3. Cashier daily reports header table
    await query(`
      CREATE TABLE IF NOT EXISTS cashier_daily_reports (
        id INT AUTO_INCREMENT PRIMARY KEY,
        branch_id INT NOT NULL,
        report_date DATE NOT NULL,
        created_by_names VARCHAR(255) NULL,
        submitted_by INT NULL,
        status ENUM('draft', 'submitted', 'reviewed') NOT NULL DEFAULT 'draft',
        total_customer INT NOT NULL DEFAULT 0,
        apc DECIMAL(15,2) NOT NULL DEFAULT 0,
        omzet_gross DECIMAL(15,2) NOT NULL DEFAULT 0,
        pb1_amount DECIMAL(15,2) NOT NULL DEFAULT 0,
        omzet_net DECIMAL(15,2) NOT NULL DEFAULT 0,
        cash_omzet DECIMAL(15,2) NOT NULL DEFAULT 0,
        cash_shift1 DECIMAL(15,2) NOT NULL DEFAULT 0,
        cash_shift2 DECIMAL(15,2) NOT NULL DEFAULT 0,
        endorse_entertaint_total DECIMAL(15,2) NOT NULL DEFAULT 0,
        admin_pesanan_total DECIMAL(15,2) NOT NULL DEFAULT 0,
        hpp_daily_override DECIMAL(15,2) NULL DEFAULT NULL,
        operasional_daily_override DECIMAL(15,2) NULL DEFAULT NULL,
        ayam_dioven_ekor DECIMAL(10,2) NOT NULL DEFAULT 0,
        ayam_dioven_potong DECIMAL(10,2) NOT NULL DEFAULT 0,
        ayam_dijual_ekor DECIMAL(10,2) NOT NULL DEFAULT 0,
        ayam_dijual_potong DECIMAL(10,2) NOT NULL DEFAULT 0,
        ayam_reject_ekor DECIMAL(10,2) NOT NULL DEFAULT 0,
        ayam_reject_potong DECIMAL(10,2) NOT NULL DEFAULT 0,
        kambing_presto_ekor DECIMAL(10,2) NOT NULL DEFAULT 0,
        kambing_presto_potong DECIMAL(10,2) NOT NULL DEFAULT 0,
        kambing_dijual_ekor DECIMAL(10,2) NOT NULL DEFAULT 0,
        kambing_dijual_potong DECIMAL(10,2) NOT NULL DEFAULT 0,
        kambing_kecil_ekor DECIMAL(10,2) NOT NULL DEFAULT 0,
        kambing_kecil_potong DECIMAL(10,2) NOT NULL DEFAULT 0,
        kasir_notes TEXT NULL,
        omzet_transaction_id INT NULL DEFAULT NULL,
        auto_sync_omzet TINYINT(1) NOT NULL DEFAULT 1,
        last_synced_at DATETIME NULL DEFAULT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uq_cdr_branch_date (branch_id, report_date),
        INDEX idx_cdr_branch_date (branch_id, report_date),
        CONSTRAINT fk_cdr_branch FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE CASCADE,
        CONSTRAINT fk_cdr_user FOREIGN KEY (submitted_by) REFERENCES users(id) ON DELETE SET NULL,
        CONSTRAINT fk_cdr_omzet_tx FOREIGN KEY (omzet_transaction_id) REFERENCES transactions(id) ON DELETE SET NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);
    console.log('  Created cashier_daily_reports table');

    // 4. Omzet rows per payment method / channel
    await query(`
      CREATE TABLE IF NOT EXISTS cashier_report_omzet_items (
        id INT AUTO_INCREMENT PRIMARY KEY,
        report_id INT NOT NULL,
        payment_method_id INT NULL DEFAULT NULL,
        channel_name VARCHAR(150) NOT NULL,
        bank_account_id INT NULL DEFAULT NULL,
        amount_app DECIMAL(15,2) NOT NULL DEFAULT 0,
        amount_cashier DECIMAL(15,2) NOT NULL DEFAULT 0,
        is_taxable TINYINT(1) NOT NULL DEFAULT 1,
        pb1_amount DECIMAL(15,2) NOT NULL DEFAULT 0,
        sort_order INT NOT NULL DEFAULT 0,
        notes VARCHAR(255) NULL,
        INDEX idx_croi_report (report_id, sort_order),
        CONSTRAINT fk_croi_report FOREIGN KEY (report_id) REFERENCES cashier_daily_reports(id) ON DELETE CASCADE,
        CONSTRAINT fk_croi_pm FOREIGN KEY (payment_method_id) REFERENCES payment_methods(id) ON DELETE SET NULL,
        CONSTRAINT fk_croi_bank FOREIGN KEY (bank_account_id) REFERENCES bank_accounts(id) ON DELETE SET NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);
    console.log('  Created cashier_report_omzet_items table');

    // 5. Rincian Entertaint / Endorse
    await query(`
      CREATE TABLE IF NOT EXISTS cashier_report_entertainments (
        id INT AUTO_INCREMENT PRIMARY KEY,
        report_id INT NOT NULL,
        taker_name VARCHAR(150) NOT NULL DEFAULT '',
        purpose VARCHAR(255) NOT NULL DEFAULT '',
        product_desc VARCHAR(255) NOT NULL DEFAULT '',
        total_price DECIMAL(15,2) NOT NULL DEFAULT 0,
        sort_order INT NOT NULL DEFAULT 0,
        INDEX idx_cre_report (report_id, sort_order),
        CONSTRAINT fk_cre_report FOREIGN KEY (report_id) REFERENCES cashier_daily_reports(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);
    console.log('  Created cashier_report_entertainments table');

    // 6. Data Penerimaan Barang
    await query(`
      CREATE TABLE IF NOT EXISTS cashier_report_goods_receipts (
        id INT AUTO_INCREMENT PRIMARY KEY,
        report_id INT NOT NULL,
        item_name VARCHAR(200) NOT NULL DEFAULT '',
        unit VARCHAR(50) NOT NULL DEFAULT '',
        qty DECIMAL(12,2) NOT NULL DEFAULT 0,
        notes VARCHAR(255) NULL,
        sort_order INT NOT NULL DEFAULT 0,
        INDEX idx_crgr_report (report_id, sort_order),
        CONSTRAINT fk_crgr_report FOREIGN KEY (report_id) REFERENCES cashier_daily_reports(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);
    console.log('  Created cashier_report_goods_receipts table');

    // 7. DP/Deposit & Admin Pesanan orders
    await query(`
      CREATE TABLE IF NOT EXISTS cashier_report_orders (
        id INT AUTO_INCREMENT PRIMARY KEY,
        report_id INT NOT NULL,
        order_section ENUM('dp_deposit', 'admin_pesanan') NOT NULL DEFAULT 'admin_pesanan',
        customer_name VARCHAR(200) NOT NULL DEFAULT '',
        tf_bca_amount DECIMAL(15,2) NOT NULL DEFAULT 0,
        tf_mandiri_amount DECIMAL(15,2) NOT NULL DEFAULT 0,
        dp_amount DECIMAL(15,2) NOT NULL DEFAULT 0,
        dp_transfer_date VARCHAR(50) NULL,
        dp_channel VARCHAR(100) NULL,
        settlement_amount DECIMAL(15,2) NOT NULL DEFAULT 0,
        settlement_transfer_date VARCHAR(50) NULL,
        settlement_channel VARCHAR(100) NULL,
        ongkir_bca_amount DECIMAL(15,2) NOT NULL DEFAULT 0,
        ongkir_mandiri_amount DECIMAL(15,2) NOT NULL DEFAULT 0,
        total_amount DECIMAL(15,2) NOT NULL DEFAULT 0,
        pickup_date VARCHAR(50) NULL,
        notes VARCHAR(500) NULL,
        sort_order INT NOT NULL DEFAULT 0,
        INDEX idx_cro_report_section (report_id, order_section, sort_order),
        CONSTRAINT fk_cro_report FOREIGN KEY (report_id) REFERENCES cashier_daily_reports(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);
    console.log('  Created cashier_report_orders table');

    // 8. Review notes from Admin / Owner / Co-Owner
    await query(`
      CREATE TABLE IF NOT EXISTS cashier_report_notes (
        id INT AUTO_INCREMENT PRIMARY KEY,
        report_id INT NOT NULL,
        user_id INT NULL,
        user_name VARCHAR(150) NOT NULL,
        user_role VARCHAR(50) NOT NULL,
        note_type ENUM('info', 'revisi', 'terverifikasi') NOT NULL DEFAULT 'info',
        content TEXT NOT NULL,
        is_resolved TINYINT(1) NOT NULL DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_crn_report (report_id, created_at),
        CONSTRAINT fk_crn_report FOREIGN KEY (report_id) REFERENCES cashier_daily_reports(id) ON DELETE CASCADE,
        CONSTRAINT fk_crn_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);
    console.log('  Created cashier_report_notes table');

    // 9. Audit trail logs for cashier daily reports
    await query(`
      CREATE TABLE IF NOT EXISTS cashier_report_logs (
        id INT AUTO_INCREMENT PRIMARY KEY,
        report_id INT NOT NULL,
        branch_id INT NOT NULL,
        report_date DATE NOT NULL,
        user_id INT NULL,
        user_name VARCHAR(150) NOT NULL DEFAULT 'Sistem',
        user_role VARCHAR(50) NOT NULL DEFAULT '',
        action VARCHAR(80) NOT NULL,
        summary VARCHAR(500) NOT NULL,
        changes JSON NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_crl_report (report_id, created_at),
        INDEX idx_crl_branch_date (branch_id, report_date, created_at),
        CONSTRAINT fk_crl_report FOREIGN KEY (report_id) REFERENCES cashier_daily_reports(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);
    console.log('  Created cashier_report_logs table');
  },

  down: async ({ query }) => {
    await query(`DROP TABLE IF EXISTS cashier_report_logs;`);
    await query(`DROP TABLE IF EXISTS cashier_report_notes;`);
    await query(`DROP TABLE IF EXISTS cashier_report_orders;`);
    await query(`DROP TABLE IF EXISTS cashier_report_goods_receipts;`);
    await query(`DROP TABLE IF EXISTS cashier_report_entertainments;`);
    await query(`DROP TABLE IF EXISTS cashier_report_omzet_items;`);
    await query(`DROP TABLE IF EXISTS cashier_daily_reports;`);
    await query(`DROP TABLE IF EXISTS branch_monthly_targets;`);

    const pmCols = await query(`SHOW COLUMNS FROM payment_methods LIKE 'default_bank_account_id'`);
    if (pmCols && pmCols.length > 0) {
      try {
        await query(`ALTER TABLE payment_methods DROP FOREIGN KEY fk_pm_default_bank_account`);
      } catch (_) {}
      await query(`ALTER TABLE payment_methods DROP COLUMN default_bank_account_id`);
    }
    console.log('  Reverted cashier daily report tables and payment_methods column');
  }
};
