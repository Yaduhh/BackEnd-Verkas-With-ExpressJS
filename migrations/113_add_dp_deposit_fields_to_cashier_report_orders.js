module.exports = {
  up: async ({ query }) => {
    const columnsToAdd = [
      {
        name: 'planned_pickup_date',
        ddl: 'ADD COLUMN planned_pickup_date VARCHAR(50) NULL AFTER customer_name'
      },
      {
        name: 'product_total_amount',
        ddl: 'ADD COLUMN product_total_amount DECIMAL(15,2) NOT NULL DEFAULT 0 AFTER planned_pickup_date'
      },
      {
        name: 'ongkir_amount',
        ddl: 'ADD COLUMN ongkir_amount DECIMAL(15,2) NOT NULL DEFAULT 0 AFTER ongkir_mandiri_amount'
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
  },

  down: async ({ query }) => {
    for (const colName of ['ongkir_amount', 'product_total_amount', 'planned_pickup_date']) {
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
