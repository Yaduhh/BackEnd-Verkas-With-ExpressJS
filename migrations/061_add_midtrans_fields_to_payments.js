const { query } = require('../config/database');

module.exports = {
  up: async () => {
    try {
      // Check if columns already exist
      const columns = await query(`
        SELECT COLUMN_NAME 
        FROM INFORMATION_SCHEMA.COLUMNS 
        WHERE TABLE_SCHEMA = DATABASE() 
        AND TABLE_NAME = 'payments' 
        AND COLUMN_NAME IN ('midtrans_token', 'midtrans_redirect_url')
      `);

      const existingColumns = (columns || []).map(col => col.COLUMN_NAME);

      if (!existingColumns.includes('midtrans_token')) {
        await query('ALTER TABLE payments ADD COLUMN midtrans_token VARCHAR(255) NULL AFTER xendit_expires_at');
        console.log('✅ Added midtrans_token column to payments table');
      }

      if (!existingColumns.includes('midtrans_redirect_url')) {
        await query('ALTER TABLE payments ADD COLUMN midtrans_redirect_url TEXT NULL AFTER midtrans_token');
        console.log('✅ Added midtrans_redirect_url column to payments table');
      }
    } catch (error) {
      console.error('Error adding Midtrans columns to payments:', error);
      throw error;
    }
  },

  down: async () => {
    try {
      await query('ALTER TABLE payments DROP COLUMN IF EXISTS midtrans_redirect_url');
      await query('ALTER TABLE payments DROP COLUMN IF EXISTS midtrans_token');
      console.log('✅ Dropped Midtrans columns from payments table');
    } catch (error) {
      console.error('Error dropping Midtrans columns:', error);
      throw error;
    }
  }
};
