module.exports = {
  up: async ({ query }) => {
    const columns = await query(`
      SELECT COLUMN_NAME
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'transaction_repayments'
        AND COLUMN_NAME = 'is_writeoff'
    `);

    if (columns.length === 0) {
      await query(`
        ALTER TABLE transaction_repayments
        ADD COLUMN is_writeoff TINYINT(1) NOT NULL DEFAULT 0 AFTER income_transaction_id,
        ADD INDEX idx_tr_is_writeoff (is_writeoff)
      `);
      console.log('  Added is_writeoff column to transaction_repayments table');
    }
  },

  down: async ({ query }) => {
    const idx = await query(`
      SELECT INDEX_NAME
      FROM INFORMATION_SCHEMA.STATISTICS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'transaction_repayments'
        AND INDEX_NAME = 'idx_tr_is_writeoff'
    `);
    if (idx.length > 0) {
      await query(`ALTER TABLE transaction_repayments DROP INDEX idx_tr_is_writeoff`);
    }

    const columns = await query(`
      SELECT COLUMN_NAME
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'transaction_repayments'
        AND COLUMN_NAME = 'is_writeoff'
    `);
    if (columns.length > 0) {
      await query(`ALTER TABLE transaction_repayments DROP COLUMN is_writeoff`);
      console.log('  Dropped is_writeoff column from transaction_repayments table');
    }
  }
};
