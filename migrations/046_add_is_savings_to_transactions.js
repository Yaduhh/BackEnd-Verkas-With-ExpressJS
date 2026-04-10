module.exports = {
  up: async ({ query }) => {
    // Add is_savings column to transactions table
    await query(`ALTER TABLE transactions ADD COLUMN is_savings BOOLEAN DEFAULT FALSE AFTER is_umum`);
    console.log('  Added is_savings column to transactions table');
  },

  down: async ({ query }) => {
    // Remove matches column from activities table
    await query(`ALTER TABLE transactions DROP COLUMN is_savings`);
    console.log('  Dropped is_savings column from transactions table');
  }
};
