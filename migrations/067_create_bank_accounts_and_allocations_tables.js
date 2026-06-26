module.exports = {
  up: async ({ query }) => {
    // 1. Drop existing allocations table
    await query(`DROP TABLE IF EXISTS savings_account_allocations`);
    console.log('  Dropped old savings_account_allocations table');

    // 2. Create bank_accounts table
    await query(`
      CREATE TABLE IF NOT EXISTS bank_accounts (
        id INT AUTO_INCREMENT PRIMARY KEY,
        branch_id INT NOT NULL,
        name VARCHAR(100) NOT NULL,
        is_active TINYINT(1) DEFAULT 1,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        CONSTRAINT fk_ba_branch FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);
    console.log('  Created bank_accounts table');

    // 3. Create savings_account_allocations table referencing bank_accounts
    await query(`
      CREATE TABLE IF NOT EXISTS savings_account_allocations (
        id INT AUTO_INCREMENT PRIMARY KEY,
        category_id INT NOT NULL,
        bank_account_id INT NOT NULL,
        allocated_amount DECIMAL(15, 2) NOT NULL DEFAULT 0.00,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        CONSTRAINT fk_saa_category FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE CASCADE,
        CONSTRAINT fk_saa_bank_account FOREIGN KEY (bank_account_id) REFERENCES bank_accounts(id) ON DELETE CASCADE,
        CONSTRAINT uq_saa_category_bank_account UNIQUE (category_id, bank_account_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);
    console.log('  Recreated savings_account_allocations table referencing bank_accounts');
  },
  
  down: async ({ query }) => {
    await query(`DROP TABLE IF EXISTS savings_account_allocations`);
    await query(`DROP TABLE IF EXISTS bank_accounts`);
    console.log('  Rolled back bank_accounts and allocations tables');
  }
};
