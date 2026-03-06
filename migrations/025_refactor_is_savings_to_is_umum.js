module.exports = {
    up: async ({ query, transaction }) => {
        // 1. Rename is_savings to is_umum and change default to TRUE
        // We'll also flip the values: previously Savings=1, now General=1

        // First, let's add the new column is_umum
        await query(`
      ALTER TABLE transactions 
      ADD COLUMN is_umum BOOLEAN DEFAULT TRUE AFTER lampiran
    `);

        // Second, update is_umum based on is_savings (the inverse)
        await query(`
      UPDATE transactions 
      SET is_umum = NOT is_savings
    `);

        // Third, remove the old is_savings column
        await query(`
      ALTER TABLE transactions 
      DROP COLUMN is_savings
    `);

        // Fourth, ensure existing categories mapping is correct in case some were missed
        await query(`
      UPDATE transactions t
      JOIN categories c ON t.category_id = c.id
      LEFT JOIN categories p ON c.parent_id = p.id
      SET t.is_umum = FALSE
      WHERE c.is_folder = TRUE OR p.is_folder = TRUE
    `);
    },

    down: async ({ query, transaction }) => {
        // Reverse rename: is_umum back to is_savings
        await query(`
      ALTER TABLE transactions 
      ADD COLUMN is_savings BOOLEAN DEFAULT FALSE AFTER lampiran
    `);

        await query(`
      UPDATE transactions 
      SET is_savings = NOT is_umum
    `);

        await query(`
      ALTER TABLE transactions 
      DROP COLUMN is_umum
    `);
    }
};
