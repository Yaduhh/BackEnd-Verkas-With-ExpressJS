module.exports = {
  up: async ({ query }) => {
    await query(`
      CREATE TABLE IF NOT EXISTS petty_cashes (
        id INT AUTO_INCREMENT PRIMARY KEY,
        branch_id INT NOT NULL,
        name VARCHAR(120) NOT NULL,
        description VARCHAR(255) NULL,
        created_by INT NULL,
        status_deleted TINYINT(1) NOT NULL DEFAULT 0,
        deleted_at TIMESTAMP NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        CONSTRAINT fk_pc_branch FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE CASCADE
      )
    `);

    await query(`CREATE INDEX idx_pc_branch_deleted ON petty_cashes(branch_id, status_deleted)`);

    await query(`
      CREATE TABLE IF NOT EXISTS petty_cash_transactions (
        id INT AUTO_INCREMENT PRIMARY KEY,
        petty_cash_id INT NOT NULL,
        branch_id INT NOT NULL,
        type ENUM('topup', 'expense') NOT NULL,
        amount DECIMAL(15,2) NOT NULL DEFAULT 0,
        description TEXT NULL,
        transaction_date DATE NOT NULL,
        lampiran TEXT NULL,
        source_transaction_id INT NULL,
        created_by INT NULL,
        status_deleted TINYINT(1) NOT NULL DEFAULT 0,
        deleted_at TIMESTAMP NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        CONSTRAINT fk_pct_petty_cash FOREIGN KEY (petty_cash_id) REFERENCES petty_cashes(id) ON DELETE CASCADE,
        CONSTRAINT fk_pct_branch FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE CASCADE,
        CONSTRAINT fk_pct_source_tx FOREIGN KEY (source_transaction_id) REFERENCES transactions(id) ON DELETE CASCADE
      )
    `);

    await query(`CREATE INDEX idx_pct_petty_cash_deleted ON petty_cash_transactions(petty_cash_id, status_deleted)`);
    await query(`CREATE INDEX idx_pct_branch_deleted ON petty_cash_transactions(branch_id, status_deleted)`);
    await query(`CREATE INDEX idx_pct_source_tx ON petty_cash_transactions(source_transaction_id)`);

    // Add is_petty_cash column on transactions if not exists
    const cols = await query(`SHOW COLUMNS FROM transactions LIKE 'is_petty_cash'`);
    if (!cols || cols.length === 0) {
      await query(`ALTER TABLE transactions ADD COLUMN is_petty_cash TINYINT(1) NOT NULL DEFAULT 0 AFTER is_savings`);
    }

    console.log('  Created petty_cashes & petty_cash_transactions tables and added is_petty_cash to transactions');
  },

  down: async ({ query }) => {
    const cols = await query(`SHOW COLUMNS FROM transactions LIKE 'is_petty_cash'`);
    if (cols && cols.length > 0) {
      await query(`ALTER TABLE transactions DROP COLUMN is_petty_cash`);
    }
    await query(`DROP TABLE IF EXISTS petty_cash_transactions`);
    await query(`DROP TABLE IF EXISTS petty_cashes`);
    console.log('  Dropped petty_cash_transactions & petty_cashes tables');
  }
};

