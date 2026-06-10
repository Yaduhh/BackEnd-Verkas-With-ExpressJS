module.exports = {
  up: async ({ query }) => {
    // Add columns to branches table
    await query(`
      ALTER TABLE branches 
      ADD COLUMN require_edit_approval TINYINT(1) DEFAULT 0,
      ADD COLUMN require_delete_approval TINYINT(1) DEFAULT 0,
      ADD COLUMN require_attachment TINYINT(1) DEFAULT 0
    `);

    // Add columns to transactions table
    await query(`
      ALTER TABLE transactions
      ADD COLUMN delete_requested_by INT NULL,
      ADD COLUMN delete_reason TEXT NULL,
      ADD COLUMN delete_accepted TINYINT(1) DEFAULT 0,
      ADD CONSTRAINT fk_tx_delete_requested_by FOREIGN KEY (delete_requested_by) REFERENCES users(id) ON DELETE SET NULL
    `);

    console.log('  Successfully added branch customization columns to branches and transactions tables');
  },
  
  down: async ({ query }) => {
    // Drop foreign key first
    await query(`
      ALTER TABLE transactions
      DROP FOREIGN KEY fk_tx_delete_requested_by
    `);

    // Drop columns from transactions table
    await query(`
      ALTER TABLE transactions
      DROP COLUMN delete_requested_by,
      DROP COLUMN delete_reason,
      DROP COLUMN delete_accepted
    `);

    // Drop columns from branches table
    await query(`
      ALTER TABLE branches 
      DROP COLUMN require_edit_approval,
      DROP COLUMN require_delete_approval,
      DROP COLUMN require_attachment
    `);

    console.log('  Successfully reverted branch customization columns');
  }
};
