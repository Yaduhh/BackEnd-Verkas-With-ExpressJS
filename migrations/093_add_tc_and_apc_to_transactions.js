module.exports = {
  up: async ({ query }) => {
    const columns = await query(`
      SELECT COLUMN_NAME 
      FROM INFORMATION_SCHEMA.COLUMNS 
      WHERE TABLE_SCHEMA = DATABASE() 
        AND TABLE_NAME = 'transactions' 
        AND COLUMN_NAME = 'total_customer'
    `);

    if (columns.length === 0) {
      await query(`
        ALTER TABLE transactions 
        ADD COLUMN total_customer INT NULL AFTER amount,
        ADD COLUMN apc DECIMAL(15, 2) NULL AFTER total_customer
      `);
      console.log('  Added total_customer and apc columns to transactions table');
    }
  },

  down: async ({ query }) => {
    await query(`
      ALTER TABLE transactions 
      DROP COLUMN IF EXISTS total_customer,
      DROP COLUMN IF EXISTS apc
    `);
    console.log('  Dropped total_customer and apc columns from transactions table');
  }
};
