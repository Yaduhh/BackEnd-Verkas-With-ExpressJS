module.exports = {
  up: async ({ query }) => {
    await query(`
      ALTER TABLE cashier_report_omzet_items
      MODIFY COLUMN notes TEXT NULL
    `);
    console.log('  Widened cashier_report_omzet_items.notes to TEXT');
  },

  down: async ({ query }) => {
    await query(`
      ALTER TABLE cashier_report_omzet_items
      MODIFY COLUMN notes VARCHAR(255) NULL
    `);
    console.log('  Reverted cashier_report_omzet_items.notes to VARCHAR(255)');
  }
};
