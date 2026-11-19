module.exports = {
  up: async ({ query }) => {
    const columns = await query(`
      SELECT COLUMN_NAME
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'bank_accounts'
        AND COLUMN_NAME = 'account_category'
    `);

    if (columns.length === 0) {
      await query(`
        ALTER TABLE bank_accounts
        ADD COLUMN account_category ENUM('real', 'penampung') NOT NULL DEFAULT 'real' AFTER type
      `);
      console.log('  Added account_category column to bank_accounts table');
    }
  },

  down: async ({ query }) => {
    await query(`
      ALTER TABLE bank_accounts
      DROP COLUMN IF EXISTS account_category
    `);
    console.log('  Dropped account_category column from bank_accounts table');
  }
};
