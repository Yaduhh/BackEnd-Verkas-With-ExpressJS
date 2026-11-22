module.exports = {
  up: async ({ query }) => {
    const cols = await query(
      `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'branches'
         AND COLUMN_NAME = 'cashier_show_pb1'`
    );
    if (cols.length === 0) {
      await query(`ALTER TABLE branches ADD COLUMN cashier_show_pb1 TINYINT(1) NOT NULL DEFAULT 1`);
      console.log('  Added cashier_show_pb1 column to branches');
    }

    const updated = await query(
      `UPDATE branches
       SET cashier_show_pb1 = 0
       WHERE status_deleted = 0 AND cashier_order_template = 'toko_online'`
    );
    console.log(`  Disabled PB1 by default for ${updated.affectedRows || 0} toko_online branch(es)`);
  },

  down: async ({ query }) => {
    const cols = await query(
      `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'branches'
         AND COLUMN_NAME = 'cashier_show_pb1'`
    );
    if (cols.length > 0) {
      await query(`ALTER TABLE branches DROP COLUMN cashier_show_pb1`);
    }
  }
};
