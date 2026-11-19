module.exports = {
  up: async ({ query }) => {
    const columns = await query(`
      SELECT COLUMN_NAME
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'cashier_daily_reports'
        AND COLUMN_NAME = 'omzet_sales_lampiran'
    `);

    if (columns.length === 0) {
      await query(`
        ALTER TABLE cashier_daily_reports
        ADD COLUMN omzet_sales_lampiran TEXT NULL AFTER omzet_sales_notes
      `);
      console.log('  Added omzet_sales_lampiran column to cashier_daily_reports table');
    }
  },

  down: async ({ query }) => {
    const columns = await query(`
      SELECT COLUMN_NAME
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'cashier_daily_reports'
        AND COLUMN_NAME = 'omzet_sales_lampiran'
    `);

    if (columns.length > 0) {
      await query(`
        ALTER TABLE cashier_daily_reports
        DROP COLUMN omzet_sales_lampiran
      `);
      console.log('  Dropped omzet_sales_lampiran column from cashier_daily_reports table');
    }
  }
};
