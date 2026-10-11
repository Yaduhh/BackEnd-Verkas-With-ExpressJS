module.exports = {
  up: async ({ query }) => {
    await query(`
      ALTER TABLE categories 
      ADD COLUMN code VARCHAR(50) NULL DEFAULT NULL AFTER name
    `);
    console.log('  Added code column to categories table');
  },

  down: async ({ query }) => {
    await query(`
      ALTER TABLE categories 
      DROP COLUMN code
    `);
    console.log('  Dropped code column from categories table');
  }
};
