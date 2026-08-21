module.exports = {
  up: async ({ query }) => {
    // Add type column to bank_accounts table if it does not exist
    await query(`
      ALTER TABLE bank_accounts 
      ADD COLUMN type ENUM('savings', 'operational') NOT NULL DEFAULT 'savings' AFTER name
    `);
    console.log('  Added type column to bank_accounts table (default: savings)');
  },

  down: async ({ query }) => {
    await query(`
      ALTER TABLE bank_accounts 
      DROP COLUMN type
    `);
    console.log('  Dropped type column from bank_accounts table');
  }
};
