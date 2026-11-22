module.exports = {
  up: async ({ query }) => {
    const branchCols = await query(
      `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'branches'
         AND COLUMN_NAME = 'cashier_show_offline_sales'`
    );
    if (branchCols.length === 0) {
      await query(
        `ALTER TABLE branches ADD COLUMN cashier_show_offline_sales TINYINT(1) NOT NULL DEFAULT 0`
      );
      console.log('  Added cashier_show_offline_sales column to branches');
    }

    await query(
      `ALTER TABLE cashier_report_orders
       MODIFY COLUMN order_section ENUM('dp_deposit', 'admin_pesanan', 'offline_sales') NOT NULL DEFAULT 'admin_pesanan'`
    );
    console.log('  Updated cashier_report_orders.order_section enum with offline_sales');

    const updated = await query(
      `UPDATE branches
       SET cashier_show_offline_sales = 1
       WHERE status_deleted = 0 AND LOWER(name) LIKE '%bahan baku%'`
    );
    console.log(`  Enabled cashier_show_offline_sales for ${updated.affectedRows || 0} Bahan Baku branch(es)`);
  },

  down: async ({ query }) => {
    await query(`DELETE FROM cashier_report_orders WHERE order_section = 'offline_sales'`);
    await query(
      `ALTER TABLE cashier_report_orders
       MODIFY COLUMN order_section ENUM('dp_deposit', 'admin_pesanan') NOT NULL DEFAULT 'admin_pesanan'`
    );
    const branchCols = await query(
      `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'branches'
         AND COLUMN_NAME = 'cashier_show_offline_sales'`
    );
    if (branchCols.length > 0) {
      await query(`ALTER TABLE branches DROP COLUMN cashier_show_offline_sales`);
    }
  }
};
