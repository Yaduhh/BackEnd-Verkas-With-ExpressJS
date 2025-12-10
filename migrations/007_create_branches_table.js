module.exports = {
  up: async ({ query }) => {
    await query(`
      CREATE TABLE branches (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        address TEXT,
        phone VARCHAR(50),
        owner_id INT NOT NULL,
        team_id INT NULL,
        pic_id INT NULL,
        status_active BOOLEAN DEFAULT true,
        status_deleted BOOLEAN DEFAULT false,
        deleted_at DATETIME NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_branches_owner_id (owner_id),
        INDEX idx_branches_team_id (team_id),
        INDEX idx_branches_pic_id (pic_id),
        INDEX idx_branches_status_deleted (status_deleted),
        INDEX idx_branches_status_active (status_active),
        FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (pic_id) REFERENCES users(id) ON DELETE SET NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    
    console.log('  Created branches table');
  },
  
  down: async ({ query }) => {
    await query(`DROP TABLE IF EXISTS branches`);
    console.log('  Dropped branches table');
  }
};

