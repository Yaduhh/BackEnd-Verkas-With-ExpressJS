module.exports = {
  up: async ({ query }) => {
    // Check if account_number column already exists
    const columns = await query(`
      SELECT COLUMN_NAME 
      FROM INFORMATION_SCHEMA.COLUMNS 
      WHERE TABLE_SCHEMA = DATABASE() 
        AND TABLE_NAME = 'bank_accounts' 
        AND COLUMN_NAME = 'account_number'
    `);

    if (columns.length === 0) {
      await query(`
        ALTER TABLE bank_accounts 
        ADD COLUMN account_number VARCHAR(100) NULL AFTER name
      `);
      console.log('  Added account_number column to bank_accounts table');
    }
  },

  down: async ({ query }) => {
    await query(`
      ALTER TABLE bank_accounts 
      DROP COLUMN IF EXISTS account_number
    `);
    console.log('  Dropped account_number column from bank_accounts table');
  }
};
