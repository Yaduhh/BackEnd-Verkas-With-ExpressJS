module.exports = {
  up: async ({ query }) => {
    const cols = await query(
      `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'branches'
         AND COLUMN_NAME = 'cashier_show_tc_apc'`
    );
    if (cols.length === 0) {
      await query(`ALTER TABLE branches ADD COLUMN cashier_show_tc_apc TINYINT(1) NOT NULL DEFAULT 1`);
      console.log('  Added cashier_show_tc_apc column to branches');
    }

    const updated = await query(
      `UPDATE branches
       SET cashier_show_tc_apc = 0
       WHERE status_deleted = 0 AND cashier_order_template = 'toko_online'`
    );
    console.log(`  Disabled TC & APC section by default for ${updated.affectedRows || 0} toko_online branch(es)`);
  },

  down: async ({ query }) => {
    const cols = await query(
      `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'branches'
         AND COLUMN_NAME = 'cashier_show_tc_apc'`
    );
    if (cols.length > 0) {
      await query(`ALTER TABLE branches DROP COLUMN cashier_show_tc_apc`);
    }
  }
};
