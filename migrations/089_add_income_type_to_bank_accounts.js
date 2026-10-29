module.exports = {
  up: async ({ query }) => {
    await query(`
      ALTER TABLE bank_accounts 
      MODIFY COLUMN type ENUM('savings', 'operational', 'income') NOT NULL DEFAULT 'savings'
    `);
    console.log('  Updated type column in bank_accounts table to include income');
  },

  down: async ({ query }) => {
    await query(`
      ALTER TABLE bank_accounts 
      MODIFY COLUMN type ENUM('savings', 'operational') NOT NULL DEFAULT 'savings'
    `);
    console.log('  Reverted type column in bank_accounts table');
  }
};
