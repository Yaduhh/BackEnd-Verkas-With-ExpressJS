module.exports = {
  up: async ({ query }) => {
    const cols = await query(
      `SELECT COLUMN_NAME
       FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE()
         AND TABLE_NAME = 'cashier_report_piutang_items'
         AND COLUMN_NAME = 'transaction_mitra_detail_id'`
    );

    if (cols.length === 0) {
      await query(`
        ALTER TABLE cashier_report_piutang_items
        ADD COLUMN transaction_mitra_detail_id INT NULL DEFAULT NULL AFTER transaction_id,
        ADD INDEX idx_crpi_tmd_id (transaction_mitra_detail_id)
      `);
      console.log('  Added transaction_mitra_detail_id column to cashier_report_piutang_items table');
    }
  },

  down: async ({ query }) => {
    const idxs = await query(
      `SELECT INDEX_NAME
       FROM INFORMATION_SCHEMA.STATISTICS
       WHERE TABLE_SCHEMA = DATABASE()
         AND TABLE_NAME = 'cashier_report_piutang_items'
         AND INDEX_NAME = 'idx_crpi_tmd_id'`
    );
    if (idxs.length > 0) {
      await query(`ALTER TABLE cashier_report_piutang_items DROP INDEX idx_crpi_tmd_id`);
    }

    const cols = await query(
      `SELECT COLUMN_NAME
       FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE()
         AND TABLE_NAME = 'cashier_report_piutang_items'
         AND COLUMN_NAME = 'transaction_mitra_detail_id'`
    );
    if (cols.length > 0) {
      await query(`ALTER TABLE cashier_report_piutang_items DROP COLUMN transaction_mitra_detail_id`);
      console.log('  Dropped transaction_mitra_detail_id column from cashier_report_piutang_items table');
    }
  }
};
