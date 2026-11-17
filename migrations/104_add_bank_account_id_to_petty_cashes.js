module.exports = {
  up: async ({ query }) => {
    const cols = await query(`SHOW COLUMNS FROM petty_cashes LIKE 'bank_account_id'`);
    if (!cols || cols.length === 0) {
      await query(`ALTER TABLE petty_cashes ADD COLUMN bank_account_id INT NULL AFTER initial_balance`);
      await query(`
        ALTER TABLE petty_cashes
        ADD CONSTRAINT fk_pc_bank_account
        FOREIGN KEY (bank_account_id) REFERENCES bank_accounts(id) ON DELETE SET NULL
      `);
      await query(`CREATE INDEX idx_pc_bank_account ON petty_cashes(bank_account_id)`);
    }
    console.log('  Added bank_account_id column to petty_cashes');
  },

  down: async ({ query }) => {
    try {
      await query(`ALTER TABLE petty_cashes DROP FOREIGN KEY fk_pc_bank_account`);
    } catch (e) {
      console.log('  Foreign key fk_pc_bank_account already dropped or not found');
    }
    try {
      await query(`DROP INDEX idx_pc_bank_account ON petty_cashes`);
    } catch (e) {
      console.log('  Index idx_pc_bank_account already dropped or not found');
    }
    const cols = await query(`SHOW COLUMNS FROM petty_cashes LIKE 'bank_account_id'`);
    if (cols && cols.length > 0) {
      await query(`ALTER TABLE petty_cashes DROP COLUMN bank_account_id`);
    }
    console.log('  Dropped bank_account_id column from petty_cashes');
  }
};

