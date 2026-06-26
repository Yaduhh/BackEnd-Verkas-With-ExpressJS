module.exports = {
  up: async ({ query }) => {
    await query(`
      ALTER TABLE categories 
      ADD COLUMN min_attachment INT NOT NULL DEFAULT 0 AFTER parent_id
    `);
    console.log('  Successfully added min_attachment column to categories');
  },
  
  down: async ({ query }) => {
    await query(`
      ALTER TABLE categories 
      DROP COLUMN min_attachment
    `);
    console.log('  Successfully dropped min_attachment column from categories');
  }
};
