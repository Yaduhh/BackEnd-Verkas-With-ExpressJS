module.exports = {
  up: async ({ query }) => {
    const cols = await query(
      `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'cashier_daily_reports'
         AND COLUMN_NAME = 'pb1_notes'`
    );
    if (cols.length === 0) {
      await query(
        `ALTER TABLE cashier_daily_reports
         ADD COLUMN pb1_notes TEXT NULL DEFAULT NULL AFTER pb1_amount`
      );
      console.log('  Added pb1_notes column to cashier_daily_reports');
    }
  },

  down: async ({ query }) => {
    const cols = await query(
      `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'cashier_daily_reports'
         AND COLUMN_NAME = 'pb1_notes'`
    );
    if (cols.length > 0) {
      await query(`ALTER TABLE cashier_daily_reports DROP COLUMN pb1_notes`);
    }
  }
};
