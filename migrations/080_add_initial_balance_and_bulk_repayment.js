module.exports = {
  up: async ({ query }) => {
    // 1. Add initial balance fields to mitra_piutang
    await query(`
      ALTER TABLE mitra_piutang
      ADD COLUMN initial_balance DECIMAL(15,2) NOT NULL DEFAULT 0.00 AFTER nama,
      ADD COLUMN initial_balance_date DATE NULL AFTER initial_balance,
      ADD COLUMN initial_balance_note VARCHAR(255) NULL AFTER initial_balance_date,
      ADD COLUMN initial_balance_paid DECIMAL(15,2) NOT NULL DEFAULT 0.00 AFTER initial_balance_note
    `);
    console.log('  Added initial balance columns to mitra_piutang table');

    // 2. Make transaction_id nullable in transaction_repayments to allow initial balance repayments
    await query(`
      ALTER TABLE transaction_repayments
      MODIFY COLUMN transaction_id INT NULL,
      ADD COLUMN bulk_repayment_id VARCHAR(64) NULL AFTER income_transaction_id,
      ADD INDEX idx_tr_bulk_repayment_id (bulk_repayment_id)
    `);
    console.log('  Updated transaction_repayments: transaction_id nullable and added bulk_repayment_id');
  },

  down: async ({ query }) => {
    await query(`
      ALTER TABLE transaction_repayments
      DROP INDEX idx_tr_bulk_repayment_id,
      DROP COLUMN bulk_repayment_id,
      MODIFY COLUMN transaction_id INT NOT NULL
    `);

    await query(`
      ALTER TABLE mitra_piutang
      DROP COLUMN initial_balance_paid,
      DROP COLUMN initial_balance_note,
      DROP COLUMN initial_balance_date,
      DROP COLUMN initial_balance
    `);
  }
};
