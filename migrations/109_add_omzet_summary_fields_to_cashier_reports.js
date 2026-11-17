module.exports = {
  up: async ({ query }) => {
    const appCols = await query(`
      SELECT COLUMN_NAME
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'cashier_daily_reports'
        AND COLUMN_NAME = 'omzet_sales_app'
    `);
    if (appCols.length === 0) {
      await query(`
        ALTER TABLE cashier_daily_reports
        ADD COLUMN omzet_sales_app DECIMAL(15,2) NULL AFTER omzet_net
      `);
      console.log('  Added omzet_sales_app to cashier_daily_reports');
    }

    const noteCols = await query(`
      SELECT COLUMN_NAME
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'cashier_daily_reports'
        AND COLUMN_NAME = 'omzet_sales_notes'
    `);
    if (noteCols.length === 0) {
      await query(`
        ALTER TABLE cashier_daily_reports
        ADD COLUMN omzet_sales_notes TEXT NULL AFTER omzet_sales_app
      `);
      console.log('  Added omzet_sales_notes to cashier_daily_reports');
    }
  },

  down: async ({ query }) => {
    await query(`
      ALTER TABLE cashier_daily_reports
      DROP COLUMN IF EXISTS omzet_sales_notes,
      DROP COLUMN IF EXISTS omzet_sales_app
    `);
  }
};
