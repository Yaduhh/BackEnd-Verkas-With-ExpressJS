module.exports = {
  up: async ({ query }) => {
    const cols = await query(
      `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'cashier_report_sold_items'
         AND COLUMN_NAME = 'text_value_2'`
    );
    if (cols.length === 0) {
      await query(
        `ALTER TABLE cashier_report_sold_items
         ADD COLUMN text_value_2 TEXT NULL DEFAULT NULL AFTER text_value`
      );
      console.log('  Added text_value_2 column to cashier_report_sold_items');
    }
  },

  down: async ({ query }) => {
    const cols = await query(
      `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'cashier_report_sold_items'
         AND COLUMN_NAME = 'text_value_2'`
    );
    if (cols.length > 0) {
      await query(`ALTER TABLE cashier_report_sold_items DROP COLUMN text_value_2`);
    }
  }
};
