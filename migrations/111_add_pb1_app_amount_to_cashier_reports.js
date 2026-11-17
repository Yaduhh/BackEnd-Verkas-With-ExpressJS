module.exports = {
  up: async ({ query }) => {
    const cols = await query(`
      SELECT COLUMN_NAME
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'cashier_daily_reports'
        AND COLUMN_NAME = 'pb1_app_amount'
    `);
    if (cols.length === 0) {
      await query(`
        ALTER TABLE cashier_daily_reports
        ADD COLUMN pb1_app_amount DECIMAL(15,2) NULL AFTER pb1_amount
      `);
      console.log('  Added pb1_app_amount to cashier_daily_reports');
    }
  },

  down: async ({ query }) => {
    await query(`
      ALTER TABLE cashier_daily_reports
      DROP COLUMN IF EXISTS pb1_app_amount
    `);
  }
};
