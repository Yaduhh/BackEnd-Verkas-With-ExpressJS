module.exports = {
  up: async ({ query }) => {
    // Add is_debt_payment field (BOOLEAN) - menandai apakah ini pembayaran hutang
    await query(`
      ALTER TABLE transactions
      ADD COLUMN is_debt_payment BOOLEAN DEFAULT false
      AFTER is_umum
    `);
    
    // Add paid_amount field (DECIMAL) - jumlah yang dibayar saat ini
    await query(`
      ALTER TABLE transactions
      ADD COLUMN paid_amount DECIMAL(15,2) NULL
      AFTER is_debt_payment
    `);
    
    // Add remaining_debt field (DECIMAL) - sisa hutang yang belum dibayar
    await query(`
      ALTER TABLE transactions
      ADD COLUMN remaining_debt DECIMAL(15,2) NULL
      AFTER paid_amount
    `);
    
    console.log('  Added debt payment fields (is_debt_payment, paid_amount, remaining_debt) to transactions table');
  },
  
  down: async ({ query }) => {
    // Remove remaining_debt field
    try {
      await query(`
        ALTER TABLE transactions
        DROP COLUMN remaining_debt
      `);
    } catch (error) {
      // Column might not exist, ignore error
      if (!error.message.includes("Unknown column") && !error.message.includes("doesn't exist")) {
        throw error;
      }
    }
    
    // Remove paid_amount field
    try {
      await query(`
        ALTER TABLE transactions
        DROP COLUMN paid_amount
      `);
    } catch (error) {
      // Column might not exist, ignore error
      if (!error.message.includes("Unknown column") && !error.message.includes("doesn't exist")) {
        throw error;
      }
    }
    
    // Remove is_debt_payment field
    try {
      await query(`
        ALTER TABLE transactions
        DROP COLUMN is_debt_payment
      `);
    } catch (error) {
      // Column might not exist, ignore error
      if (!error.message.includes("Unknown column") && !error.message.includes("doesn't exist")) {
        throw error;
      }
    }
    
    console.log('  Removed debt payment fields from transactions table');
  }
};

