module.exports = {
  up: async ({ query }) => {
    const cols = await query(
      `SELECT COLUMN_NAME
       FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE()
         AND TABLE_NAME = 'cashier_report_orders'
         AND COLUMN_NAME = 'settlement_bank_account_id'`
    );

    if (cols.length === 0) {
      await query(`
        ALTER TABLE cashier_report_orders
        ADD COLUMN settlement_bank_account_id INT NULL DEFAULT NULL AFTER settlement_channel,
        ADD INDEX idx_cro_settlement_bank (settlement_bank_account_id),
        ADD CONSTRAINT fk_cro_settlement_bank FOREIGN KEY (settlement_bank_account_id) REFERENCES bank_accounts(id) ON DELETE SET NULL
      `);
      console.log('  Added settlement_bank_account_id column to cashier_report_orders table');
    }
  },

  down: async ({ query }) => {
    const fks = await query(
      `SELECT CONSTRAINT_NAME
       FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
       WHERE TABLE_SCHEMA = DATABASE()
         AND TABLE_NAME = 'cashier_report_orders'
         AND CONSTRAINT_NAME = 'fk_cro_settlement_bank'`
    );
    if (fks.length > 0) {
      await query(`ALTER TABLE cashier_report_orders DROP FOREIGN KEY fk_cro_settlement_bank`);
    }

    const idxs = await query(
      `SELECT INDEX_NAME
       FROM INFORMATION_SCHEMA.STATISTICS
       WHERE TABLE_SCHEMA = DATABASE()
         AND TABLE_NAME = 'cashier_report_orders'
         AND INDEX_NAME = 'idx_cro_settlement_bank'`
    );
    if (idxs.length > 0) {
      await query(`ALTER TABLE cashier_report_orders DROP INDEX idx_cro_settlement_bank`);
    }

    const cols = await query(
      `SELECT COLUMN_NAME
       FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE()
         AND TABLE_NAME = 'cashier_report_orders'
         AND COLUMN_NAME = 'settlement_bank_account_id'`
    );
    if (cols.length > 0) {
      await query(`ALTER TABLE cashier_report_orders DROP COLUMN settlement_bank_account_id`);
      console.log('  Dropped settlement_bank_account_id column from cashier_report_orders table');
    }
  }
};
