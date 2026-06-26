module.exports = {
  up: async ({ query }) => {
    await query(`ALTER TABLE transactions ADD COLUMN bank_account_id INT NULL AFTER is_savings`);
    await query(`ALTER TABLE transactions ADD CONSTRAINT fk_transactions_bank_account FOREIGN KEY (bank_account_id) REFERENCES bank_accounts(id) ON DELETE SET NULL`);
    console.log('  Added bank_account_id column to transactions table');
  },

  down: async ({ query }) => {
    try {
      await query(`ALTER TABLE transactions DROP FOREIGN KEY fk_transactions_bank_account`);
    } catch (e) {
      console.log('  Foreign key already dropped or not found');
    }
    await query(`ALTER TABLE transactions DROP COLUMN bank_account_id`);
    console.log('  Dropped bank_account_id column from transactions table');
  }
};
