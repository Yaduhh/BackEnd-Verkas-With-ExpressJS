module.exports = {
  up: async ({ query }) => {
    // Check if columns already exist before adding
    const columns = await query(`
      SELECT COLUMN_NAME 
      FROM INFORMATION_SCHEMA.COLUMNS 
      WHERE TABLE_SCHEMA = DATABASE() 
      AND TABLE_NAME = 'payments'
      AND COLUMN_NAME IN ('xendit_account_number', 'xendit_bank_code', 'xendit_checkout_url', 'xendit_qr_string', 'xendit_expires_at')
    `);
    
    const existingColumns = (columns || []).map(col => col.COLUMN_NAME);
    
    // Add xendit_account_number for Virtual Account
    if (!existingColumns.includes('xendit_account_number')) {
      await query(`
        ALTER TABLE payments 
        ADD COLUMN xendit_account_number VARCHAR(50) NULL AFTER transaction_id
      `);
      console.log('  Added xendit_account_number column');
    }
    
    // Add xendit_bank_code for Virtual Account
    if (!existingColumns.includes('xendit_bank_code')) {
      await query(`
        ALTER TABLE payments 
        ADD COLUMN xendit_bank_code VARCHAR(20) NULL AFTER xendit_account_number
      `);
      console.log('  Added xendit_bank_code column');
    }
    
    // Add xendit_checkout_url for E-Wallet
    if (!existingColumns.includes('xendit_checkout_url')) {
      await query(`
        ALTER TABLE payments 
        ADD COLUMN xendit_checkout_url TEXT NULL AFTER xendit_bank_code
      `);
      console.log('  Added xendit_checkout_url column');
    }
    
    // Add xendit_qr_string for QRIS
    if (!existingColumns.includes('xendit_qr_string')) {
      await query(`
        ALTER TABLE payments 
        ADD COLUMN xendit_qr_string TEXT NULL AFTER xendit_checkout_url
      `);
      console.log('  Added xendit_qr_string column');
    }
    
    // Add xendit_expires_at for expiration tracking
    if (!existingColumns.includes('xendit_expires_at')) {
      await query(`
        ALTER TABLE payments 
        ADD COLUMN xendit_expires_at DATETIME NULL AFTER xendit_qr_string
      `);
      console.log('  Added xendit_expires_at column');
    }
    
    // Add index for xendit_account_number for faster lookups
    try {
      await query(`
        CREATE INDEX idx_payments_xendit_account_number ON payments(xendit_account_number)
      `);
      console.log('  Added index for xendit_account_number');
    } catch (error) {
      // Index might already exist, ignore
      if (!error.message.includes('Duplicate key name')) {
        throw error;
      }
    }
  },
  
  down: async ({ query }) => {
    // Remove columns in reverse order
    await query(`
      ALTER TABLE payments 
      DROP COLUMN IF EXISTS xendit_expires_at,
      DROP COLUMN IF EXISTS xendit_qr_string,
      DROP COLUMN IF EXISTS xendit_checkout_url,
      DROP COLUMN IF EXISTS xendit_bank_code,
      DROP COLUMN IF EXISTS xendit_account_number
    `);
    
    // Remove index
    try {
      await query(`DROP INDEX IF EXISTS idx_payments_xendit_account_number ON payments`);
    } catch (error) {
      // Index might not exist, ignore
    }
    
    console.log('  Removed Xendit-specific columns from payments table');
  }
};

