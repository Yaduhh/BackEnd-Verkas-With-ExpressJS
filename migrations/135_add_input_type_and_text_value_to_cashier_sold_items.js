module.exports = {
  up: async ({ query }) => {
    const csiCols = await query(
      `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'cashier_sold_items'
         AND COLUMN_NAME = 'input_type'`
    );
    if (csiCols.length === 0) {
      await query(
        `ALTER TABLE cashier_sold_items
         ADD COLUMN input_type ENUM('number', 'text') NOT NULL DEFAULT 'number' AFTER unit2_label`
      );
      console.log('  Added input_type column to cashier_sold_items');
    }

    const updated = await query(
      `UPDATE cashier_sold_items
       SET input_type = 'text'
       WHERE LOWER(TRIM(name)) = 'keterangan'`
    );
    if (updated.affectedRows > 0) {
      console.log(`  Set input_type = 'text' for ${updated.affectedRows} "Keterangan" sold item(s)`);
    }

    const crsiCols = await query(
      `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'cashier_report_sold_items'
         AND COLUMN_NAME = 'text_value'`
    );
    if (crsiCols.length === 0) {
      await query(
        `ALTER TABLE cashier_report_sold_items
         ADD COLUMN text_value TEXT NULL DEFAULT NULL AFTER qty2`
      );
      console.log('  Added text_value column to cashier_report_sold_items');
    }
  },

  down: async ({ query }) => {
    const crsiCols = await query(
      `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'cashier_report_sold_items'
         AND COLUMN_NAME = 'text_value'`
    );
    if (crsiCols.length > 0) {
      await query(`ALTER TABLE cashier_report_sold_items DROP COLUMN text_value`);
    }

    const csiCols = await query(
      `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'cashier_sold_items'
         AND COLUMN_NAME = 'input_type'`
    );
    if (csiCols.length > 0) {
      await query(`ALTER TABLE cashier_sold_items DROP COLUMN input_type`);
    }
  }
};
