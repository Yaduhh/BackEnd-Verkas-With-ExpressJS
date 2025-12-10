module.exports = {
  up: async ({ query }) => {
    // Create branch_pics junction table for many-to-many relationship
    await query(`
      CREATE TABLE branch_pics (
        id INT AUTO_INCREMENT PRIMARY KEY,
        branch_id INT NOT NULL,
        user_id INT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY unique_branch_pic (branch_id, user_id),
        INDEX idx_branch_pics_branch_id (branch_id),
        INDEX idx_branch_pics_user_id (user_id),
        FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE CASCADE,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    
    // Migrate existing pic_id data to branch_pics table
    await query(`
      INSERT INTO branch_pics (branch_id, user_id)
      SELECT id, pic_id
      FROM branches
      WHERE pic_id IS NOT NULL
      AND status_deleted = false
    `);
    
    console.log('  Created branch_pics table and migrated existing PIC data');
  },
  
  down: async ({ query }) => {
    await query(`DROP TABLE IF EXISTS branch_pics`);
    console.log('  Dropped branch_pics table');
  }
};

