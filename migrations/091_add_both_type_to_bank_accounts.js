module.exports = {
  up: async ({ query }) => {
    await query(`
      ALTER TABLE bank_accounts 
      MODIFY COLUMN type ENUM('savings', 'operational', 'income', 'both') NOT NULL DEFAULT 'savings'
    `);
    console.log('  Updated type column in bank_accounts table to include both (operational & income)');
  },

  down: async ({ query }) => {
    await query(`
      ALTER TABLE bank_accounts 
      MODIFY COLUMN type ENUM('savings', 'operational', 'income') NOT NULL DEFAULT 'savings'
    `);
    console.log('  Reverted type column in bank_accounts table');
  }
};
