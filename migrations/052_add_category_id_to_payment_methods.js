module.exports = {
  up: async ({ query }) => {
    await query(`
      ALTER TABLE payment_methods 
      ADD COLUMN category_id INT DEFAULT NULL AFTER branch_id,
      ADD CONSTRAINT fk_pm_category FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE SET NULL
    `);
    console.log('  Added category_id to payment_methods table');
  },

  down: async ({ query }) => {
    await query(`ALTER TABLE payment_methods DROP FOREIGN KEY fk_pm_category`);
    await query(`ALTER TABLE payment_methods DROP COLUMN category_id`);
    console.log('  Removed category_id from payment_methods table');
  }
};
