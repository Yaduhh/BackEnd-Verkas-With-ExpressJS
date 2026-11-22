module.exports = {
  up: async ({ query }) => {
    const branchCols = await query(
      `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'branches'
         AND COLUMN_NAME IN ('cashier_order_template', 'cashier_show_sold_items', 'cashier_show_pesan_bosgil')`
    );
    const existingBranchCols = new Set(branchCols.map((c) => c.COLUMN_NAME));

    if (!existingBranchCols.has('cashier_order_template')) {
      await query(
        `ALTER TABLE branches ADD COLUMN cashier_order_template VARCHAR(40) NOT NULL DEFAULT 'outlet'`
      );
      console.log('  Added cashier_order_template column to branches');
    }

    if (!existingBranchCols.has('cashier_show_sold_items')) {
      await query(
        `ALTER TABLE branches ADD COLUMN cashier_show_sold_items TINYINT(1) NOT NULL DEFAULT 1`
      );
      console.log('  Added cashier_show_sold_items column to branches');
    }

    if (!existingBranchCols.has('cashier_show_pesan_bosgil')) {
      await query(
        `ALTER TABLE branches ADD COLUMN cashier_show_pesan_bosgil TINYINT(1) NOT NULL DEFAULT 1`
      );
      console.log('  Added cashier_show_pesan_bosgil column to branches');
    }

    const orderCols = await query(
      `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'cashier_report_orders'
         AND COLUMN_NAME = 'extra_data'`
    );
    if (orderCols.length === 0) {
      await query(`ALTER TABLE cashier_report_orders ADD COLUMN extra_data JSON NULL`);
      console.log('  Added extra_data JSON column to cashier_report_orders');
    }

    // Auto-configure non-outlet retail/supply branches (Toko Tepung & Bahan Baku)
    const updated = await query(
      `UPDATE branches
       SET cashier_order_template = 'toko_online',
           cashier_show_sold_items = 0,
           cashier_show_pesan_bosgil = 0
       WHERE status_deleted = 0
         AND (LOWER(name) LIKE '%toko tepung%' OR LOWER(name) LIKE '%bahan baku%')`
    );
    console.log(`  Configured toko_online template for ${updated.affectedRows || 0} non-outlet branches`);
  },

  down: async ({ query }) => {
    const orderCols = await query(
      `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'cashier_report_orders'
         AND COLUMN_NAME = 'extra_data'`
    );
    if (orderCols.length > 0) {
      await query(`ALTER TABLE cashier_report_orders DROP COLUMN extra_data`);
    }

    const branchCols = await query(
      `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'branches'
         AND COLUMN_NAME IN ('cashier_order_template', 'cashier_show_sold_items', 'cashier_show_pesan_bosgil')`
    );
    for (const col of branchCols) {
      await query(`ALTER TABLE branches DROP COLUMN \`${col.COLUMN_NAME}\``);
    }
  }
};
