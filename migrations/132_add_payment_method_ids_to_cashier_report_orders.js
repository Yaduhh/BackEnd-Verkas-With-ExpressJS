module.exports = {
  up: async ({ query }) => {
    const existingCols = await query(
      `SELECT COLUMN_NAME
       FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE()
         AND TABLE_NAME = 'cashier_report_orders'
         AND COLUMN_NAME IN ('dp_payment_method_id', 'settlement_payment_method_id')`
    );
    const colSet = new Set(existingCols.map((r) => r.COLUMN_NAME));

    if (!colSet.has('dp_payment_method_id')) {
      await query(`
        ALTER TABLE cashier_report_orders
        ADD COLUMN dp_payment_method_id INT NULL DEFAULT NULL AFTER dp_channel,
        ADD INDEX idx_cro_dp_pm (dp_payment_method_id),
        ADD CONSTRAINT fk_cro_dp_pm FOREIGN KEY (dp_payment_method_id) REFERENCES payment_methods(id) ON DELETE SET NULL
      `);
      console.log('  Added dp_payment_method_id column to cashier_report_orders table');
    }

    if (!colSet.has('settlement_payment_method_id')) {
      await query(`
        ALTER TABLE cashier_report_orders
        ADD COLUMN settlement_payment_method_id INT NULL DEFAULT NULL AFTER settlement_channel,
        ADD INDEX idx_cro_settlement_pm (settlement_payment_method_id),
        ADD CONSTRAINT fk_cro_settlement_pm FOREIGN KEY (settlement_payment_method_id) REFERENCES payment_methods(id) ON DELETE SET NULL
      `);
      console.log('  Added settlement_payment_method_id column to cashier_report_orders table');
    }
  },

  down: async ({ query }) => {
    const dropFkAndCol = async (fkName, idxName, colName) => {
      const fks = await query(
        `SELECT CONSTRAINT_NAME
         FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
         WHERE TABLE_SCHEMA = DATABASE()
           AND TABLE_NAME = 'cashier_report_orders'
           AND CONSTRAINT_NAME = ?`,
        [fkName]
      );
      if (fks.length > 0) {
        await query(`ALTER TABLE cashier_report_orders DROP FOREIGN KEY ${fkName}`);
      }

      const idxs = await query(
        `SELECT INDEX_NAME
         FROM INFORMATION_SCHEMA.STATISTICS
         WHERE TABLE_SCHEMA = DATABASE()
           AND TABLE_NAME = 'cashier_report_orders'
           AND INDEX_NAME = ?`,
        [idxName]
      );
      if (idxs.length > 0) {
        await query(`ALTER TABLE cashier_report_orders DROP INDEX ${idxName}`);
      }

      const cols = await query(
        `SELECT COLUMN_NAME
         FROM INFORMATION_SCHEMA.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE()
           AND TABLE_NAME = 'cashier_report_orders'
           AND COLUMN_NAME = ?`,
        [colName]
      );
      if (cols.length > 0) {
        await query(`ALTER TABLE cashier_report_orders DROP COLUMN ${colName}`);
        console.log(`  Dropped ${colName} column from cashier_report_orders table`);
      }
    };

    await dropFkAndCol('fk_cro_settlement_pm', 'idx_cro_settlement_pm', 'settlement_payment_method_id');
    await dropFkAndCol('fk_cro_dp_pm', 'idx_cro_dp_pm', 'dp_payment_method_id');
  }
};
