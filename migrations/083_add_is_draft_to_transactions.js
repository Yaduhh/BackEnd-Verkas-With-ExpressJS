module.exports = {
  up: async ({ query }) => {
    await query(`
      ALTER TABLE transactions 
      ADD COLUMN is_draft BOOLEAN NOT NULL DEFAULT FALSE AFTER status_deleted,
      ADD INDEX idx_transactions_draft (branch_id, is_draft, status_deleted)
    `);
    console.log('  Added is_draft column and index to transactions table');
  },

  down: async ({ query }) => {
    await query(`
      ALTER TABLE transactions 
      DROP INDEX idx_transactions_draft,
      DROP COLUMN is_draft
    `);
  }
};
