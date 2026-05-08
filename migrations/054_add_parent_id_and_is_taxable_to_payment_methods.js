module.exports = {
  up: async ({ query }) => {
    // Add parent_id and is_taxable to payment_methods
    await query(`
      ALTER TABLE payment_methods 
      ADD COLUMN parent_id INT NULL AFTER category_id,
      ADD COLUMN is_taxable BOOLEAN DEFAULT TRUE AFTER name,
      ADD CONSTRAINT fk_pm_parent FOREIGN KEY (parent_id) REFERENCES payment_methods(id) ON DELETE SET NULL
    `);
    console.log('  Added parent_id and is_taxable columns to payment_methods');
  },

  down: async ({ query }) => {
    // Remove columns and constraint
    await query(`ALTER TABLE payment_methods DROP FOREIGN KEY fk_pm_parent`);
    await query(`ALTER TABLE payment_methods DROP COLUMN parent_id, DROP COLUMN is_taxable`);
    console.log('  Removed parent_id and is_taxable columns from payment_methods');
  }
};
