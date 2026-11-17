module.exports = {
  up: async ({ query }) => {
    const cols = await query(`
      SELECT COLUMN_NAME
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'cashier_daily_reports'
        AND COLUMN_NAME = 'omzet_sales_cashier'
    `);
    if (cols.length === 0) {
      await query(`
        ALTER TABLE cashier_daily_reports
        ADD COLUMN omzet_sales_cashier DECIMAL(15,2) NULL AFTER omzet_sales_app
      `);
      console.log('  Added omzet_sales_cashier to cashier_daily_reports');
    }
  },

  down: async ({ query }) => {
    await query(`
      ALTER TABLE cashier_daily_reports
      DROP COLUMN IF EXISTS omzet_sales_cashier
    `);
  }
};
