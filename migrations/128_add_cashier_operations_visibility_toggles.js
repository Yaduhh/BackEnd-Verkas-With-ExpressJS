module.exports = {
  up: async ({ query }) => {
    const branchCols = await query(
      `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'branches'
         AND COLUMN_NAME IN ('cashier_show_hpp', 'cashier_show_entertain_goods')`
    );
    const existing = new Set(branchCols.map((c) => c.COLUMN_NAME));

    if (!existing.has('cashier_show_hpp')) {
      await query(`ALTER TABLE branches ADD COLUMN cashier_show_hpp TINYINT(1) NOT NULL DEFAULT 1`);
      console.log('  Added cashier_show_hpp column to branches');
    }

    if (!existing.has('cashier_show_entertain_goods')) {
      await query(`ALTER TABLE branches ADD COLUMN cashier_show_entertain_goods TINYINT(1) NOT NULL DEFAULT 1`);
      console.log('  Added cashier_show_entertain_goods column to branches');
    }

    const updated = await query(
      `UPDATE branches
       SET cashier_show_hpp = 0,
           cashier_show_entertain_goods = 0
       WHERE status_deleted = 0 AND cashier_order_template = 'toko_online'`
    );
    console.log(`  Disabled HPP & Entertaint/Goods sections by default for ${updated.affectedRows || 0} toko_online branch(es)`);
  },

  down: async ({ query }) => {
    const branchCols = await query(
      `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'branches'
         AND COLUMN_NAME IN ('cashier_show_hpp', 'cashier_show_entertain_goods')`
    );
    for (const col of branchCols) {
      await query(`ALTER TABLE branches DROP COLUMN \`${col.COLUMN_NAME}\``);
    }
  }
};
