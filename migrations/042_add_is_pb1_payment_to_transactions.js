const { query } = require('../config/database');

module.exports = {
    up: async () => {
        // Add is_pb1_payment field to transactions table
        await query(`
      ALTER TABLE transactions 
      ADD COLUMN is_pb1_payment BOOLEAN DEFAULT FALSE AFTER mitra_piutang_id
    `);
        console.log('✅ Column is_pb1_payment added to transactions table');
    },
    down: async () => {
        // Remove is_pb1_payment field
        await query(`
      ALTER TABLE transactions 
      DROP COLUMN is_pb1_payment
    `);
        console.log('✅ Column is_pb1_payment removed from transactions table');
    }
};
