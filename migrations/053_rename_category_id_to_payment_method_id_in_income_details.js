module.exports = {
  up: async ({ query }) => {
    // Rename category_id to payment_method_id in transaction_income_details
    try {
      await query(`
        ALTER TABLE transaction_income_details 
        CHANGE COLUMN category_id payment_method_id INT NOT NULL
      `);
      console.log('  Renamed category_id to payment_method_id in transaction_income_details');
    } catch (error) {
      if (error.code === 'ER_BAD_FIELD_ERROR' || error.message.includes('Unknown column')) {
        console.log('  Column category_id not found, skipping rename (might already be payment_method_id)');
      } else {
        throw error;
      }
    }
  },

  down: async ({ query }) => {
    // Revert rename
    try {
      await query(`
        ALTER TABLE transaction_income_details 
        CHANGE COLUMN payment_method_id category_id INT NOT NULL
      `);
      console.log('  Reverted payment_method_id to category_id in transaction_income_details');
    } catch (error) {
      console.log('  Skipping revert: ' + error.message);
    }
  }
};
