module.exports = {
  up: async ({ query }) => {
    await query(`ALTER TABLE transaction_income_details ADD COLUMN bank_account_id INT NULL AFTER payment_method_id`);
    await query(`ALTER TABLE transaction_income_details ADD CONSTRAINT fk_tid_bank_account FOREIGN KEY (bank_account_id) REFERENCES bank_accounts(id) ON DELETE SET NULL`);
    console.log('  Added bank_account_id column to transaction_income_details');
  },

  down: async ({ query }) => {
    try {
      await query(`ALTER TABLE transaction_income_details DROP FOREIGN KEY fk_tid_bank_account`);
    } catch (e) {
      console.log('  Foreign key fk_tid_bank_account already dropped or not found');
    }
    await query(`ALTER TABLE transaction_income_details DROP COLUMN bank_account_id`);
    console.log('  Removed bank_account_id column from transaction_income_details');
  }
};
