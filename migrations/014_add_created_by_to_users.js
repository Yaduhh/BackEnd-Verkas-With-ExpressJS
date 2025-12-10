module.exports = {
  up: async ({ query }) => {
    // Add created_by column to track which owner created the admin user
    try {
      await query(`
        ALTER TABLE users
        ADD COLUMN created_by INT NULL
      `);
      
      await query(`
        ALTER TABLE users
        ADD INDEX idx_users_created_by (created_by)
      `);
      
      // Add foreign key with specific name
      await query(`
        ALTER TABLE users
        ADD CONSTRAINT fk_users_created_by
        FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
      `);
      
      console.log('  Added created_by column to users table');
    } catch (error) {
      // Column might already exist
      if (error.message.includes('Duplicate column') || error.message.includes('already exists')) {
        console.log('  created_by column already exists, skipping');
      } else {
        throw error;
      }
    }
  },
  
  down: async ({ query }) => {
    try {
      await query(`
        ALTER TABLE users
        DROP FOREIGN KEY fk_users_created_by
      `);
      
      await query(`
        ALTER TABLE users
        DROP INDEX idx_users_created_by
      `);
      
      await query(`
        ALTER TABLE users
        DROP COLUMN created_by
      `);
      
      console.log('  Removed created_by column from users table');
    } catch (error) {
      console.log('  Error removing created_by column:', error.message);
    }
  }
};

