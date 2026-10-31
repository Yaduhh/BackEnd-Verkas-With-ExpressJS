module.exports = {
  up: async ({ query }) => {
    // 1. Create api_keys table
    await query(`
      CREATE TABLE IF NOT EXISTS api_keys (
        id INT AUTO_INCREMENT PRIMARY KEY,
        owner_id INT NOT NULL,
        name VARCHAR(100) NOT NULL,
        api_key VARCHAR(64) NOT NULL UNIQUE,
        secret_key VARCHAR(64) NULL,
        branch_id INT NULL COMMENT 'NULL = Punya akses ke semua cabang milik Owner',
        scopes JSON NULL COMMENT 'Daftar izin, misal: ["transactions:create", "branches:read", "categories:read", "bank_accounts:read"]',
        is_active TINYINT(1) DEFAULT 1,
        last_used_at DATETIME NULL,
        expires_at DATETIME NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_api_keys_key (api_key),
        INDEX idx_api_keys_owner (owner_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);
    console.log('  Created api_keys table');

    // 2. Add external_reference_id to transactions table
    const columns = await query(`
      SELECT COLUMN_NAME 
      FROM INFORMATION_SCHEMA.COLUMNS 
      WHERE TABLE_SCHEMA = DATABASE() 
        AND TABLE_NAME = 'transactions' 
        AND COLUMN_NAME = 'external_reference_id'
    `);

    if (columns.length === 0) {
      await query(`
        ALTER TABLE transactions 
        ADD COLUMN external_reference_id VARCHAR(100) NULL AFTER id,
        ADD INDEX idx_transactions_ext_ref (external_reference_id)
      `);
      console.log('  Added external_reference_id column and index to transactions table');
    }
  },

  down: async ({ query }) => {
    await query(`DROP TABLE IF EXISTS api_keys;`);
    console.log('  Dropped api_keys table');

    const columns = await query(`
      SELECT COLUMN_NAME 
      FROM INFORMATION_SCHEMA.COLUMNS 
      WHERE TABLE_SCHEMA = DATABASE() 
        AND TABLE_NAME = 'transactions' 
        AND COLUMN_NAME = 'external_reference_id'
    `);

    if (columns.length > 0) {
      await query(`
        ALTER TABLE transactions 
        DROP COLUMN external_reference_id
      `);
      console.log('  Dropped external_reference_id column from transactions table');
    }
  }
};

