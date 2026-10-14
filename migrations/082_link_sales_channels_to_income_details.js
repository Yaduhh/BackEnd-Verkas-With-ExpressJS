module.exports = {
  up: async ({ query }) => {
    // 1. Add payment_method_id and transaction_income_detail_id to transaction_sales_channels
    await query(`
      ALTER TABLE transaction_sales_channels
      ADD COLUMN payment_method_id INT NULL AFTER sales_channel_id,
      ADD COLUMN transaction_income_detail_id INT NULL AFTER payment_method_id,
      ADD INDEX idx_tsc_payment_method (payment_method_id),
      ADD INDEX idx_tsc_income_detail (transaction_income_detail_id),
      ADD CONSTRAINT fk_tsc_payment_method FOREIGN KEY (payment_method_id) REFERENCES payment_methods(id) ON DELETE SET NULL,
      ADD CONSTRAINT fk_tsc_income_detail FOREIGN KEY (transaction_income_detail_id) REFERENCES transaction_income_details(id) ON DELETE CASCADE
    `);
    console.log('  Added payment_method_id and transaction_income_detail_id to transaction_sales_channels');

    // 2. Backfill existing single-source transactions so old data is cleanly linked where unambiguous
    try {
      await query(`
        UPDATE transaction_sales_channels tsc
        JOIN (
          SELECT transaction_id, MIN(id) as tid_id, MIN(payment_method_id) as pm_id, COUNT(*) as cnt
          FROM transaction_income_details
          GROUP BY transaction_id
          HAVING cnt = 1
        ) single_tid ON tsc.transaction_id = single_tid.transaction_id
        SET tsc.transaction_income_detail_id = single_tid.tid_id,
            tsc.payment_method_id = single_tid.pm_id
        WHERE tsc.payment_method_id IS NULL
      `);
      console.log('  Backfilled existing single-source transaction sales channels');
    } catch (e) {
      console.log('  Backfill skipped or partially applied:', e.message);
    }
  },

  down: async ({ query }) => {
    await query(`
      ALTER TABLE transaction_sales_channels
      DROP FOREIGN KEY fk_tsc_income_detail,
      DROP FOREIGN KEY fk_tsc_payment_method,
      DROP INDEX idx_tsc_income_detail,
      DROP INDEX idx_tsc_payment_method,
      DROP COLUMN transaction_income_detail_id,
      DROP COLUMN payment_method_id
    `);
  }
};
