module.exports = {
  up: async ({ query }) => {
    // Add branch_id column to transactions
    await query(`
      ALTER TABLE transactions
      ADD COLUMN branch_id INT NOT NULL AFTER user_id
    `);
    
    // Create index
    await query(`
      CREATE INDEX idx_transactions_branch_id ON transactions(branch_id)
    `);
    
    // Create default branch for each owner and assign existing transactions
    // First, create default branches for existing owners
    await query(`
      INSERT INTO branches (name, owner_id, status_active, status_deleted, created_at)
      SELECT CONCAT('Branch ', COALESCE(u.name, u.email)), u.id, true, false, NOW()
      FROM users u
      WHERE u.role = 'owner' AND u.status_deleted = false
    `);
    
    // Assign existing transactions to default branches
    await query(`
      UPDATE transactions t
      INNER JOIN users u ON t.user_id = u.id
      INNER JOIN branches b ON b.owner_id = u.id AND b.name LIKE CONCAT('Branch ', COALESCE(u.name, u.email))
      SET t.branch_id = b.id
      WHERE t.branch_id = 0 OR t.branch_id IS NULL
    `);
    
    // If there are still transactions without branch_id, create a fallback branch
    const orphanTransactions = await query(`
      SELECT DISTINCT t.user_id
      FROM transactions t
      WHERE t.branch_id = 0 OR t.branch_id IS NULL
    `);
    
    if (orphanTransactions.length > 0) {
      for (const row of orphanTransactions) {
        await query(`
          INSERT INTO branches (name, owner_id, status_active, status_deleted, created_at)
          VALUES (CONCAT('Branch ', NOW()), ?, true, false, NOW())
        `, [row.user_id]);
        
        const newBranch = await query(`
          SELECT id FROM branches WHERE owner_id = ? ORDER BY created_at DESC LIMIT 1
        `, [row.user_id]);
        
        if (newBranch.length > 0) {
          await query(`
            UPDATE transactions
            SET branch_id = ?
            WHERE user_id = ? AND (branch_id = 0 OR branch_id IS NULL)
          `, [newBranch[0].id, row.user_id]);
        }
      }
    }
    
    // Add foreign key constraint
    await query(`
      ALTER TABLE transactions
      ADD CONSTRAINT fk_transactions_branch_id
      FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE RESTRICT
    `);
    
    console.log('  Added branch_id column to transactions table');
    console.log('  Created default branches for existing owners');
    console.log('  Assigned existing transactions to default branches');
  },
  
  down: async ({ query }) => {
    // Remove foreign key
    try {
      await query(`ALTER TABLE transactions DROP FOREIGN KEY fk_transactions_branch_id`);
    } catch (error) {
      console.log('  Note: Could not drop foreign key (might not exist)');
    }
    
    // Remove index
    try {
      await query(`DROP INDEX idx_transactions_branch_id ON transactions`);
    } catch (error) {
      console.log('  Note: Could not drop index (might not exist)');
    }
    
    // Remove column
    await query(`ALTER TABLE transactions DROP COLUMN branch_id`);
    
    console.log('  Removed branch_id column from transactions table');
  }
};

