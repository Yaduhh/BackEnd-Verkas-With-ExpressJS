module.exports = {
  up: async ({ query }) => {
    const checkCol = async (colName) => {
      const cols = await query(
        `SELECT COLUMN_NAME
         FROM INFORMATION_SCHEMA.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE()
           AND TABLE_NAME = 'transaction_repayments'
           AND COLUMN_NAME = ?`,
        [colName]
      );
      return cols.length > 0;
    };

    if (!(await checkCol('deleted_at'))) {
      await query(`
        ALTER TABLE transaction_repayments
        ADD COLUMN deleted_at DATETIME NULL DEFAULT NULL
      `);
      console.log('  Added deleted_at column to transaction_repayments table');
    }

    if (!(await checkCol('deleted_by'))) {
      await query(`
        ALTER TABLE transaction_repayments
        ADD COLUMN deleted_by INT NULL DEFAULT NULL
      `);
      console.log('  Added deleted_by column to transaction_repayments table');
    }
  },

  down: async ({ query }) => {
    await query(`
      ALTER TABLE transaction_repayments
      DROP COLUMN IF EXISTS deleted_by,
      DROP COLUMN IF EXISTS deleted_at
    `);
    console.log('  Dropped soft delete columns from transaction_repayments table');
  }
};

