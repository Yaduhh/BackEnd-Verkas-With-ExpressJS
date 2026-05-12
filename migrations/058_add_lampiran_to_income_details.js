module.exports = {
  up: async ({ query }) => {
    // Add lampiran column to transaction_income_details
    // Using TEXT to store JSON array of paths
    await query(`
      ALTER TABLE transaction_income_details 
      ADD COLUMN lampiran TEXT DEFAULT NULL AFTER amount_cashier
    `);
    console.log('  Added lampiran column to transaction_income_details');
  },

  down: async ({ query }) => {
    await query(`
      ALTER TABLE transaction_income_details 
      DROP COLUMN lampiran
    `);
    console.log('  Removed lampiran column from transaction_income_details');
  }
};
