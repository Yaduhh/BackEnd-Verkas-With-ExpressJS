module.exports = {
  up: async ({ query }) => {
    // Add lampiran field (TEXT)
    await query(`
      ALTER TABLE transactions
      ADD COLUMN lampiran TEXT NULL
      AFTER note
    `);
    
    // Add edit_accepted field (BOOLEAN)
    await query(`
      ALTER TABLE transactions
      ADD COLUMN edit_accepted BOOLEAN DEFAULT 0
      AFTER lampiran
    `);
    
    console.log('  Added lampiran and edit_accepted columns to transactions table');
  },
  
  down: async ({ query }) => {
    // Remove edit_accepted field
    try {
      await query(`
        ALTER TABLE transactions
        DROP COLUMN edit_accepted
      `);
    } catch (error) {
      // Column might not exist, ignore error
      if (!error.message.includes("Unknown column") && !error.message.includes("doesn't exist")) {
        throw error;
      }
    }
    
    // Remove lampiran field
    try {
      await query(`
        ALTER TABLE transactions
        DROP COLUMN lampiran
      `);
    } catch (error) {
      // Column might not exist, ignore error
      if (!error.message.includes("Unknown column") && !error.message.includes("doesn't exist")) {
        throw error;
      }
    }
    
    console.log('  Removed lampiran and edit_accepted columns from transactions table');
  }
};

