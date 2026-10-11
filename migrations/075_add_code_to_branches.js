module.exports = {
  up: async ({ query }) => {
    await query(`
      ALTER TABLE branches 
      ADD COLUMN code VARCHAR(50) NULL DEFAULT NULL AFTER name
    `);
    console.log('  Added code column to branches table');
  },

  down: async ({ query }) => {
    await query(`
      ALTER TABLE branches 
      DROP COLUMN code
    `);
    console.log('  Dropped code column from branches table');
  }
};
