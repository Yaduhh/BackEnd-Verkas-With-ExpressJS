module.exports = {
  up: async ({ query }) => {
    // Add amount_app and amount_cashier to transaction_income_details
    await query(`
      ALTER TABLE transaction_income_details 
      ADD COLUMN amount_app DECIMAL(15, 2) DEFAULT 0 AFTER amount,
      ADD COLUMN amount_cashier DECIMAL(15, 2) DEFAULT 0 AFTER amount_app
    `);
    console.log('  Added amount_app and amount_cashier to transaction_income_details');
  },

  down: async ({ query }) => {
    await query(`
      ALTER TABLE transaction_income_details 
      DROP COLUMN amount_app, 
      DROP COLUMN amount_cashier
    `);
    console.log('  Removed amount_app and amount_cashier from transaction_income_details');
  }
};
