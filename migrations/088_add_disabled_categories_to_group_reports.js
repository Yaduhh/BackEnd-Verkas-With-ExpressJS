module.exports = {
  up: async ({ query }) => {
    await query(`
      ALTER TABLE group_reports 
      ADD COLUMN disabled_categories JSON NULL DEFAULT NULL AFTER expense_order
    `);
    console.log('  Added disabled_categories column to group_reports table');
  },

  down: async ({ query }) => {
    await query(`
      ALTER TABLE group_reports 
      DROP COLUMN disabled_categories
    `);
    console.log('  Dropped disabled_categories column from group_reports table');
  }
};
