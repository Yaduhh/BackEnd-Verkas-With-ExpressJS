module.exports = {
  up: async ({ query }) => {
    // Rename category_id to payment_method_id in transaction_income_details
    await query(`
      ALTER TABLE transaction_income_details 
      CHANGE COLUMN category_id payment_method_id INT NOT NULL
    `);
    console.log('  Renamed category_id to payment_method_id in transaction_income_details');
  },

  down: async ({ query }) => {
    // Revert rename
    await query(`
      ALTER TABLE transaction_income_details 
      CHANGE COLUMN payment_method_id category_id INT NOT NULL
    `);
    console.log('  Reverted payment_method_id to category_id in transaction_income_details');
  }
};
