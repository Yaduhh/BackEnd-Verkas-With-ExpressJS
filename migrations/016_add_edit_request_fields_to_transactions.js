module.exports = {
  up: async ({ query }) => {
    // Add edit_reason field (TEXT) - alasan mengapa admin ingin edit
    await query(`
      ALTER TABLE transactions
      ADD COLUMN edit_reason TEXT NULL
      AFTER edit_accepted
    `);
    
    // Add edit_requested_by field (INT) - user_id yang request edit
    await query(`
      ALTER TABLE transactions
      ADD COLUMN edit_requested_by INT NULL
      AFTER edit_reason
    `);
    
    // Add foreign key constraint
    await query(`
      ALTER TABLE transactions
      ADD CONSTRAINT fk_transactions_edit_requested_by
      FOREIGN KEY (edit_requested_by) REFERENCES users(id) ON DELETE SET NULL
    `);
    
    console.log('  Added edit_reason and edit_requested_by columns to transactions table');
  },
  
  down: async ({ query }) => {
    // Remove foreign key constraint
    try {
      await query(`
        ALTER TABLE transactions
        DROP FOREIGN KEY fk_transactions_edit_requested_by
      `);
    } catch (error) {
      // Constraint might not exist, ignore error
      if (!error.message.includes("Unknown key") && !error.message.includes("doesn't exist")) {
        throw error;
      }
    }
    
    // Remove edit_requested_by field
    try {
      await query(`
        ALTER TABLE transactions
        DROP COLUMN edit_requested_by
      `);
    } catch (error) {
      // Column might not exist, ignore error
      if (!error.message.includes("Unknown column") && !error.message.includes("doesn't exist")) {
        throw error;
      }
    }
    
    // Remove edit_reason field
    try {
      await query(`
        ALTER TABLE transactions
        DROP COLUMN edit_reason
      `);
    } catch (error) {
      // Column might not exist, ignore error
      if (!error.message.includes("Unknown column") && !error.message.includes("doesn't exist")) {
        throw error;
      }
    }
    
    console.log('  Removed edit_reason and edit_requested_by columns from transactions table');
  }
};

