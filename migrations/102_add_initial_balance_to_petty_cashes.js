module.exports = {
  up: async ({ query }) => {
    const cols = await query(`SHOW COLUMNS FROM petty_cashes LIKE 'initial_balance'`);
    if (!cols || cols.length === 0) {
      await query(`ALTER TABLE petty_cashes ADD COLUMN initial_balance DECIMAL(15,2) NOT NULL DEFAULT 0 AFTER description`);
    }
    console.log('  Added initial_balance column to petty_cashes');
  },

  down: async ({ query }) => {
    const cols = await query(`SHOW COLUMNS FROM petty_cashes LIKE 'initial_balance'`);
    if (cols && cols.length > 0) {
      await query(`ALTER TABLE petty_cashes DROP COLUMN initial_balance`);
    }
    console.log('  Dropped initial_balance column from petty_cashes');
  }
};

