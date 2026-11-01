module.exports = {
  up: async ({ query }) => {
    // Sync transaction_sales_channels.payment_method_id with its linked transaction_income_details.payment_method_id
    await query(`
      UPDATE transaction_sales_channels tsc
      JOIN transaction_income_details tid ON tsc.transaction_income_detail_id = tid.id
      SET tsc.payment_method_id = tid.payment_method_id
      WHERE tsc.payment_method_id IS NULL OR tsc.payment_method_id != tid.payment_method_id
    `);
    console.log('  Synced transaction_sales_channels.payment_method_id with transaction_income_details.payment_method_id');
  },

  down: async () => {
    // Data sync only, no schema rollback needed
  }
};

