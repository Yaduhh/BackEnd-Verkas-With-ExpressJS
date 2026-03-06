module.exports = {
  up: async ({ query, transaction }) => {
    // 1. Rename is_savings to is_umum and change default to TRUE
    // We'll also flip the values: previously Savings=1, now General=1

    // Check if is_umum already exists to make migration idempotent
    const columns = await query("SHOW COLUMNS FROM transactions LIKE 'is_umum'");

    if (columns.length === 0) {
      // Column doesn't exist, so we add it
      await query(`
        ALTER TABLE transactions 
        ADD COLUMN is_umum BOOLEAN DEFAULT TRUE AFTER lampiran
      `);

      // Update is_umum based on is_savings (the inverse)
      // Only if is_savings still exists
      const savingsCols = await query("SHOW COLUMNS FROM transactions LIKE 'is_savings'");
      if (savingsCols.length > 0) {
        await query(`
          UPDATE transactions 
          SET is_umum = NOT is_savings
        `);
      }
    }

    // Remove the old is_savings column if it still exists
    const savingsColsFinal = await query("SHOW COLUMNS FROM transactions LIKE 'is_savings'");
    if (savingsColsFinal.length > 0) {
      await query(`
        ALTER TABLE transactions 
        DROP COLUMN is_savings
      `);
    }

    // Ensure existing categories mapping is correct
    await query(`
      UPDATE transactions t
      JOIN categories c ON t.category_id = c.id
      LEFT JOIN categories p ON c.parent_id = p.id
      SET t.is_umum = FALSE
      WHERE c.is_folder = TRUE OR p.is_folder = TRUE
    `);
  },

  down: async ({ query, transaction }) => {
    // Check if is_savings already exists
    const savingsCols = await query("SHOW COLUMNS FROM transactions LIKE 'is_savings'");
    if (savingsCols.length === 0) {
      await query(`
        ALTER TABLE transactions 
        ADD COLUMN is_savings BOOLEAN DEFAULT FALSE AFTER lampiran
      `);

      // Update is_savings based on is_umum (the inverse)
      const umumCols = await query("SHOW COLUMNS FROM transactions LIKE 'is_umum'");
      if (umumCols.length > 0) {
        await query(`
          UPDATE transactions 
          SET is_savings = NOT is_umum
        `);
      }
    }

    // Drop is_umum if it exists
    const umumColsFinal = await query("SHOW COLUMNS FROM transactions LIKE 'is_umum'");
    if (umumColsFinal.length > 0) {
      await query(`
        ALTER TABLE transactions 
        DROP COLUMN is_umum
      `);
    }
  }
};
