module.exports = {
  up: async ({ query }) => {
    await query(`
      ALTER TABLE branches 
      ADD COLUMN group_name VARCHAR(100) NULL DEFAULT NULL AFTER code,
      ADD INDEX idx_branches_group_name (group_name)
    `);
    console.log('  Added group_name column to branches table');
  },

  down: async ({ query }) => {
    await query(`
      ALTER TABLE branches 
      DROP INDEX idx_branches_group_name,
      DROP COLUMN group_name
    `);
    console.log('  Dropped group_name column from branches table');
  }
};
