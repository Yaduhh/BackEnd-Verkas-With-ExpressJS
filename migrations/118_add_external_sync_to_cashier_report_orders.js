module.exports = {
  up: async ({ query }) => {
    const columnsToAdd = [
      {
        name: 'external_reference_id',
        ddl: 'ADD COLUMN external_reference_id VARCHAR(120) NULL DEFAULT NULL AFTER notes'
      },
      {
        name: 'external_source',
        ddl: 'ADD COLUMN external_source VARCHAR(50) NULL DEFAULT NULL AFTER external_reference_id'
      }
    ];

    for (const col of columnsToAdd) {
      const existing = await query(
        `SELECT COLUMN_NAME
         FROM INFORMATION_SCHEMA.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE()
           AND TABLE_NAME = 'cashier_report_orders'
           AND COLUMN_NAME = ?`,
        [col.name]
      );
      if (existing.length === 0) {
        await query(`ALTER TABLE cashier_report_orders ${col.ddl}`);
        console.log(`  Added ${col.name} column to cashier_report_orders table`);
      }
    }

    const idx = await query(
      `SELECT INDEX_NAME
       FROM INFORMATION_SCHEMA.STATISTICS
       WHERE TABLE_SCHEMA = DATABASE()
         AND TABLE_NAME = 'cashier_report_orders'
         AND INDEX_NAME = 'idx_cro_ext_ref'`
    );
    if (idx.length === 0) {
      await query(
        `ALTER TABLE cashier_report_orders
         ADD INDEX idx_cro_ext_ref (external_source, external_reference_id)`
      );
      console.log('  Added idx_cro_ext_ref index to cashier_report_orders table');
    }
  },

  down: async ({ query }) => {
    const idx = await query(
      `SELECT INDEX_NAME
       FROM INFORMATION_SCHEMA.STATISTICS
       WHERE TABLE_SCHEMA = DATABASE()
         AND TABLE_NAME = 'cashier_report_orders'
         AND INDEX_NAME = 'idx_cro_ext_ref'`
    );
    if (idx.length > 0) {
      await query(`ALTER TABLE cashier_report_orders DROP INDEX idx_cro_ext_ref`);
      console.log('  Dropped idx_cro_ext_ref index from cashier_report_orders table');
    }

    for (const colName of ['external_source', 'external_reference_id']) {
      const existing = await query(
        `SELECT COLUMN_NAME
         FROM INFORMATION_SCHEMA.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE()
           AND TABLE_NAME = 'cashier_report_orders'
           AND COLUMN_NAME = ?`,
        [colName]
      );
      if (existing.length > 0) {
        await query(`ALTER TABLE cashier_report_orders DROP COLUMN ${colName}`);
        console.log(`  Dropped ${colName} column from cashier_report_orders table`);
      }
    }
  }
};
