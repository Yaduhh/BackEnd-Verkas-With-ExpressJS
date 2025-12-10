module.exports = {
  up: async ({ query }) => {
    // Add is_folder column (default false, so existing categories remain as items)
    await query(`
      ALTER TABLE categories
      ADD COLUMN is_folder BOOLEAN DEFAULT false AFTER branch_id
    `);
    
    // Add parent_id column (nullable, for self-referencing folder hierarchy)
    await query(`
      ALTER TABLE categories
      ADD COLUMN parent_id INT NULL AFTER is_folder
    `);
    
    // Create index for parent_id (for faster queries on folder hierarchy)
    await query(`
      CREATE INDEX idx_categories_parent_id ON categories(parent_id)
    `);
    
    // Add self-referencing foreign key constraint
    // ON DELETE SET NULL: if parent folder is deleted, children become root level
    await query(`
      ALTER TABLE categories
      ADD CONSTRAINT fk_categories_parent_id
      FOREIGN KEY (parent_id) REFERENCES categories(id) ON DELETE SET NULL
    `);
    
    // Create index for is_folder (for filtering folders vs items)
    await query(`
      CREATE INDEX idx_categories_is_folder ON categories(is_folder)
    `);
    
    // Create composite index for common queries (branch + folder + parent)
    await query(`
      CREATE INDEX idx_categories_branch_folder_parent ON categories(branch_id, is_folder, parent_id)
    `);
    
    console.log('  Added folder support (is_folder, parent_id) to categories table');
  },
  
  down: async ({ query }) => {
    // Remove composite index
    try {
      await query(`DROP INDEX idx_categories_branch_folder_parent ON categories`);
    } catch (error) {
      console.log('  Note: Could not drop composite index (might not exist)');
    }
    
    // Remove is_folder index
    try {
      await query(`DROP INDEX idx_categories_is_folder ON categories`);
    } catch (error) {
      console.log('  Note: Could not drop is_folder index (might not exist)');
    }
    
    // Remove foreign key constraint
    try {
      await query(`ALTER TABLE categories DROP FOREIGN KEY fk_categories_parent_id`);
    } catch (error) {
      console.log('  Note: Could not drop foreign key (might not exist)');
    }
    
    // Remove parent_id index
    try {
      await query(`DROP INDEX idx_categories_parent_id ON categories`);
    } catch (error) {
      console.log('  Note: Could not drop parent_id index (might not exist)');
    }
    
    // Remove parent_id column
    await query(`ALTER TABLE categories DROP COLUMN parent_id`);
    
    // Remove is_folder column
    await query(`ALTER TABLE categories DROP COLUMN is_folder`);
    
    console.log('  Removed folder support from categories table');
  }
};

