module.exports = {
  up: async ({ query }) => {
    const checkCol = async (colName) => {
      const cols = await query(
        `SELECT COLUMN_NAME
         FROM INFORMATION_SCHEMA.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE()
           AND TABLE_NAME = 'bank_accounts'
           AND COLUMN_NAME = ?`,
        [colName]
      );
      return cols.length > 0;
    };

    if (!(await checkCol('initial_balance'))) {
      await query(`
        ALTER TABLE bank_accounts
        ADD COLUMN initial_balance DECIMAL(15, 2) NOT NULL DEFAULT 0.00 AFTER type
      `);
      console.log('  Added initial_balance column to bank_accounts table');
    }

    if (!(await checkCol('initial_balance_date'))) {
      await query(`
        ALTER TABLE bank_accounts
        ADD COLUMN initial_balance_date DATE NULL DEFAULT NULL AFTER initial_balance
      `);
      console.log('  Added initial_balance_date column to bank_accounts table');
    }

    if (!(await checkCol('initial_balance_note'))) {
      await query(`
        ALTER TABLE bank_accounts
        ADD COLUMN initial_balance_note VARCHAR(255) NULL DEFAULT NULL AFTER initial_balance_date
      `);
      console.log('  Added initial_balance_note column to bank_accounts table');
    }
  },

  down: async ({ query }) => {
    await query(`
      ALTER TABLE bank_accounts
      DROP COLUMN IF EXISTS initial_balance_note,
      DROP COLUMN IF EXISTS initial_balance_date,
      DROP COLUMN IF EXISTS initial_balance
    `);
    console.log('  Dropped initial_balance columns from bank_accounts table');
  }
};

