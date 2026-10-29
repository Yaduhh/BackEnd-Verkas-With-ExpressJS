module.exports = {
  up: async ({ query }) => {
    // 1. Create fund_transfers table
    await query(`
      CREATE TABLE IF NOT EXISTS fund_transfers (
        id INT AUTO_INCREMENT PRIMARY KEY,
        branch_id INT NOT NULL,
        user_id INT NOT NULL,
        from_bank_account_id INT NOT NULL,
        to_bank_account_id INT NOT NULL,
        amount DECIMAL(15, 2) NOT NULL,
        transfer_date DATE NOT NULL,
        note TEXT,
        lampiran LONGTEXT,
        status_deleted TINYINT(1) DEFAULT 0,
        deleted_at TIMESTAMP NULL,
        deleted_by INT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        CONSTRAINT fk_ft_branch FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE CASCADE,
        CONSTRAINT fk_ft_user FOREIGN KEY (user_id) REFERENCES users(id),
        CONSTRAINT fk_ft_from_ba FOREIGN KEY (from_bank_account_id) REFERENCES bank_accounts(id),
        CONSTRAINT fk_ft_to_ba FOREIGN KEY (to_bank_account_id) REFERENCES bank_accounts(id),
        INDEX idx_ft_branch (branch_id),
        INDEX idx_ft_from_ba (from_bank_account_id),
        INDEX idx_ft_to_ba (to_bank_account_id),
        INDEX idx_ft_transfer_date (transfer_date),
        INDEX idx_ft_status_deleted (status_deleted)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);
    console.log('  Created fund_transfers table');

    // 2. Create fund_transfer_histories table for detailed audit trail
    await query(`
      CREATE TABLE IF NOT EXISTS fund_transfer_histories (
        id INT AUTO_INCREMENT PRIMARY KEY,
        fund_transfer_id INT NOT NULL,
        user_id INT NOT NULL,
        action ENUM('create', 'update', 'delete') NOT NULL,
        reason TEXT,
        old_data JSON,
        new_data JSON,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT fk_fth_transfer FOREIGN KEY (fund_transfer_id) REFERENCES fund_transfers(id) ON DELETE CASCADE,
        CONSTRAINT fk_fth_user FOREIGN KEY (user_id) REFERENCES users(id),
        INDEX idx_fth_transfer_id (fund_transfer_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);
    console.log('  Created fund_transfer_histories table');
  },

  down: async ({ query }) => {
    await query(`DROP TABLE IF EXISTS fund_transfer_histories`);
    await query(`DROP TABLE IF EXISTS fund_transfers`);
    console.log('  Rolled back fund_transfers and histories tables');
  }
};
