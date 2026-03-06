module.exports = {
    up: async ({ query, transaction }) => {
        // Correcting the logic:
        // 1. Transactions to the Parent Folder itself -> is_umum = 1 (Show in Dashboard)
        // 2. Transactions to the Sub-Category inside a Folder -> is_umum = 0 (Hide from Dashboard)

        // First, reset everything to 1
        await query(`UPDATE transactions SET is_umum = TRUE`);

        // Now, set is_umum = 0 ONLY for transactions that have a parent category which is a folder
        await query(`
      UPDATE transactions t
      JOIN categories c ON t.category_id = c.id
      JOIN categories p ON c.parent_id = p.id
      SET t.is_umum = FALSE
      WHERE p.is_folder = TRUE
    `);
    },

    down: async ({ query, transaction }) => {
        // Reverse logic if needed (revert to previous session's incorrect-but-stored state)
        await query(`
      UPDATE transactions t
      JOIN categories c ON t.category_id = c.id
      LEFT JOIN categories p ON c.parent_id = p.id
      SET t.is_umum = FALSE
      WHERE c.is_folder = TRUE OR p.is_folder = TRUE
    `);
    }
};
