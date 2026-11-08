module.exports = {
  up: async ({ query }) => {
    const incomeDetailCols = await query(`
      SELECT COLUMN_NAME 
      FROM INFORMATION_SCHEMA.COLUMNS 
      WHERE TABLE_SCHEMA = DATABASE() 
        AND TABLE_NAME = 'transaction_income_details' 
        AND COLUMN_NAME = 'pb1_amount'
    `);

    if (incomeDetailCols.length === 0) {
      await query(`
        ALTER TABLE transaction_income_details 
        ADD COLUMN pb1_amount DECIMAL(15, 2) NULL DEFAULT NULL AFTER amount_cashier
      `);
      console.log('  Added pb1_amount column to transaction_income_details table');
    }

    const salesChannelCols = await query(`
      SELECT COLUMN_NAME 
      FROM INFORMATION_SCHEMA.COLUMNS 
      WHERE TABLE_SCHEMA = DATABASE() 
        AND TABLE_NAME = 'transaction_sales_channels' 
        AND COLUMN_NAME = 'pb1_amount'
    `);

    if (salesChannelCols.length === 0) {
      await query(`
        ALTER TABLE transaction_sales_channels 
        ADD COLUMN pb1_amount DECIMAL(15, 2) NULL DEFAULT NULL AFTER amount
      `);
      console.log('  Added pb1_amount column to transaction_sales_channels table');
    }
  },

  down: async ({ query }) => {
    await query(`
      ALTER TABLE transaction_income_details 
      DROP COLUMN IF EXISTS pb1_amount
    `);
    await query(`
      ALTER TABLE transaction_sales_channels 
      DROP COLUMN IF EXISTS pb1_amount
    `);
    console.log('  Dropped pb1_amount columns from transaction_income_details and transaction_sales_channels');
  }
};

