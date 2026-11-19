module.exports = {
  up: async ({ query }) => {
    const columns = await query(`
      SELECT COLUMN_NAME
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'cashier_report_orders'
        AND COLUMN_NAME IN ('is_verified', 'verified_by', 'verified_at')
    `);
    const existing = new Set(columns.map((c) => c.COLUMN_NAME));

    if (!existing.has('is_verified')) {
      await query(`
        ALTER TABLE cashier_report_orders
        ADD COLUMN is_verified TINYINT(1) NOT NULL DEFAULT 0 AFTER sort_order
      `);
      console.log('  Added is_verified column to cashier_report_orders table');
    }

    if (!existing.has('verified_by')) {
      await query(`
        ALTER TABLE cashier_report_orders
        ADD COLUMN verified_by INT NULL AFTER is_verified
      `);
      console.log('  Added verified_by column to cashier_report_orders table');
    }

    if (!existing.has('verified_at')) {
      await query(`
        ALTER TABLE cashier_report_orders
        ADD COLUMN verified_at DATETIME NULL AFTER verified_by
      `);
      console.log('  Added verified_at column to cashier_report_orders table');
    }
  },

  down: async ({ query }) => {
    const columns = await query(`
      SELECT COLUMN_NAME
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'cashier_report_orders'
        AND COLUMN_NAME IN ('is_verified', 'verified_by', 'verified_at')
    `);
    const existing = new Set(columns.map((c) => c.COLUMN_NAME));

    for (const colName of ['verified_at', 'verified_by', 'is_verified']) {
      if (existing.has(colName)) {
        await query(`ALTER TABLE cashier_report_orders DROP COLUMN ${colName}`);
        console.log(`  Dropped ${colName} column from cashier_report_orders table`);
      }
    }
  }
};
