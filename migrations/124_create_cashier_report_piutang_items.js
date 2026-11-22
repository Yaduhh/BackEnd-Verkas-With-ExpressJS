module.exports = {
  up: async ({ query }) => {
    await query(`
      CREATE TABLE IF NOT EXISTS cashier_report_piutang_items (
        id INT AUTO_INCREMENT PRIMARY KEY,
        report_id INT NOT NULL,
        branch_id INT NOT NULL,
        mitra_piutang_id INT NOT NULL,
        category_id INT NULL,
        bank_account_id INT NULL,
        transaction_id INT NULL,
        amount DECIMAL(15,2) NOT NULL DEFAULT 0,
        paid_amount DECIMAL(15,2) NOT NULL DEFAULT 0,
        remaining_debt DECIMAL(15,2) NOT NULL DEFAULT 0,
        notes TEXT NULL,
        is_verified TINYINT(1) NOT NULL DEFAULT 0,
        verified_by INT NULL,
        verified_at DATETIME NULL,
        created_by INT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_crpi_report_id (report_id),
        INDEX idx_crpi_branch_id (branch_id),
        INDEX idx_crpi_mitra_id (mitra_piutang_id),
        INDEX idx_crpi_tx_id (transaction_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);
    console.log('  Created cashier_report_piutang_items table');
  },

  down: async ({ query }) => {
    await query(`DROP TABLE IF EXISTS cashier_report_piutang_items;`);
    console.log('  Dropped cashier_report_piutang_items table');
  }
};
