module.exports = {
    up: async ({ query, transaction }) => {
        // 1. Add is_savings column to transactions table
        await query(`
      ALTER TABLE transactions 
      ADD COLUMN is_savings BOOLEAN DEFAULT FALSE AFTER lampiran
    `);

        // 2. Backfill is_savings based on category folder status
        // Transactions where category is_folder = true OR its parent is_folder = true
        await query(`
      UPDATE transactions t
      JOIN categories c ON t.category_id = c.id
      LEFT JOIN categories p ON c.parent_id = p.id
      SET t.is_savings = TRUE
      WHERE c.is_folder = TRUE OR p.is_folder = TRUE
    `);
    },

    down: async ({ query, transaction }) => {
        // Remove is_savings column from transactions table
        await query(`
      ALTER TABLE transactions 
      DROP COLUMN is_savings
    `);
    }
};
