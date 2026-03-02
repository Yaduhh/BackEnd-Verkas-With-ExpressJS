module.exports = {
  up: async ({ query }) => {
    // Add mitra_piutang_id field (INT NULL) - relasi ke mitra piutang untuk transaksi hutang
    await query(`
      ALTER TABLE transactions
      ADD COLUMN mitra_piutang_id INT NULL
      AFTER remaining_debt
    `);
    
    // Add foreign key constraint
    await query(`
      ALTER TABLE transactions
      ADD CONSTRAINT fk_transactions_mitra_piutang
      FOREIGN KEY (mitra_piutang_id) REFERENCES mitra_piutang(id) ON DELETE SET NULL
    `);
    
    // Add index for better query performance
    await query(`
      CREATE INDEX idx_transactions_mitra_piutang_id ON transactions(mitra_piutang_id)
    `);
    
    console.log('  Added mitra_piutang_id field to transactions table');
  },
  
  down: async ({ query }) => {
    // Remove foreign key constraint
    try {
      await query(`
        ALTER TABLE transactions
        DROP FOREIGN KEY fk_transactions_mitra_piutang
      `);
    } catch (error) {
      // Constraint might not exist, ignore error
      if (!error.message.includes("Unknown key") && !error.message.includes("doesn't exist")) {
        throw error;
      }
    }
    
    // Remove index
    try {
      await query(`
        DROP INDEX idx_transactions_mitra_piutang_id ON transactions
      `);
    } catch (error) {
      // Index might not exist, ignore error
      if (!error.message.includes("Unknown key") && !error.message.includes("doesn't exist")) {
        throw error;
      }
    }
    
    // Remove mitra_piutang_id field
    try {
      await query(`
        ALTER TABLE transactions
        DROP COLUMN mitra_piutang_id
      `);
    } catch (error) {
      // Column might not exist, ignore error
      if (!error.message.includes("Unknown column") && !error.message.includes("doesn't exist")) {
        throw error;
      }
    }
    
    console.log('  Removed mitra_piutang_id field from transactions table');
  }
};

