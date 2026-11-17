module.exports = {
  up: async ({ query }) => {
    const cols = await query(`SHOW COLUMNS FROM petty_cash_transactions LIKE 'bank_account_id'`);
    if (!cols || cols.length === 0) {
      await query(`ALTER TABLE petty_cash_transactions ADD COLUMN bank_account_id INT NULL AFTER lampiran`);
      await query(`
        ALTER TABLE petty_cash_transactions
        ADD CONSTRAINT fk_pct_bank_account
        FOREIGN KEY (bank_account_id) REFERENCES bank_accounts(id) ON DELETE SET NULL
      `);
      await query(`CREATE INDEX idx_pct_bank_account ON petty_cash_transactions(bank_account_id)`);
    }
    console.log('  Added bank_account_id column to petty_cash_transactions');
  },

  down: async ({ query }) => {
    try {
      await query(`ALTER TABLE petty_cash_transactions DROP FOREIGN KEY fk_pct_bank_account`);
    } catch (e) {
      console.log('  Foreign key fk_pct_bank_account already dropped or not found');
    }
    try {
      await query(`DROP INDEX idx_pct_bank_account ON petty_cash_transactions`);
    } catch (e) {
      console.log('  Index idx_pct_bank_account already dropped or not found');
    }
    const cols = await query(`SHOW COLUMNS FROM petty_cash_transactions LIKE 'bank_account_id'`);
    if (cols && cols.length > 0) {
      await query(`ALTER TABLE petty_cash_transactions DROP COLUMN bank_account_id`);
    }
    console.log('  Dropped bank_account_id column from petty_cash_transactions');
  }
};

