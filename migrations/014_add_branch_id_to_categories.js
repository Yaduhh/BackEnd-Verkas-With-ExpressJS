module.exports = {
  up: async ({ query }) => {
    // Add branch_id column to categories (nullable, so existing categories remain global)
    await query(`
      ALTER TABLE categories
      ADD COLUMN branch_id INT NULL AFTER user_id
    `);
    
    // Create index
    await query(`
      CREATE INDEX idx_categories_branch_id ON categories(branch_id)
    `);
    
    // Add foreign key constraint
    await query(`
      ALTER TABLE categories
      ADD CONSTRAINT fk_categories_branch_id
      FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE CASCADE
    `);
    
    console.log('  Added branch_id column to categories table');
  },
  
  down: async ({ query }) => {
    // Remove foreign key
    try {
      await query(`ALTER TABLE categories DROP FOREIGN KEY fk_categories_branch_id`);
    } catch (error) {
      console.log('  Note: Could not drop foreign key (might not exist)');
    }
    
    // Remove index
    try {
      await query(`DROP INDEX idx_categories_branch_id ON categories`);
    } catch (error) {
      console.log('  Note: Could not drop index (might not exist)');
    }
    
    // Remove column
    await query(`ALTER TABLE categories DROP COLUMN branch_id`);
    
    console.log('  Removed branch_id column from categories table');
  }
};

