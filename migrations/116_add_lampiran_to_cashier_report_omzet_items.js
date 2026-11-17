module.exports = {
  up: async ({ query }) => {
    const cols = await query(
      `SELECT COLUMN_NAME
       FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE()
         AND TABLE_NAME = 'cashier_report_omzet_items'
         AND COLUMN_NAME = 'lampiran'`
    );

    if (cols.length === 0) {
      await query(`
        ALTER TABLE cashier_report_omzet_items
        ADD COLUMN lampiran TEXT NULL AFTER notes
      `);
      console.log('  Added lampiran column to cashier_report_omzet_items table');
    }
  },

  down: async ({ query }) => {
    const cols = await query(
      `SELECT COLUMN_NAME
       FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE()
         AND TABLE_NAME = 'cashier_report_omzet_items'
         AND COLUMN_NAME = 'lampiran'`
    );

    if (cols.length > 0) {
      await query(`
        ALTER TABLE cashier_report_omzet_items
        DROP COLUMN lampiran
      `);
      console.log('  Dropped lampiran column from cashier_report_omzet_items table');
    }
  }
};
