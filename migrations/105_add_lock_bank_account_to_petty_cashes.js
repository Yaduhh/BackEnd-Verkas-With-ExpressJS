module.exports = {
  up: async ({ query }) => {
    const cols = await query(`SHOW COLUMNS FROM petty_cashes LIKE 'lock_bank_account'`);
    if (!cols || cols.length === 0) {
      await query(
        `ALTER TABLE petty_cashes ADD COLUMN lock_bank_account TINYINT(1) NOT NULL DEFAULT 0 AFTER bank_account_id`
      );
    }
    console.log('  Added lock_bank_account column to petty_cashes');
  },

  down: async ({ query }) => {
    const cols = await query(`SHOW COLUMNS FROM petty_cashes LIKE 'lock_bank_account'`);
    if (cols && cols.length > 0) {
      await query(`ALTER TABLE petty_cashes DROP COLUMN lock_bank_account`);
    }
    console.log('  Dropped lock_bank_account column from petty_cashes');
  }
};
