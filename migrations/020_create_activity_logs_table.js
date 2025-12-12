module.exports = {
  up: async ({ query }) => {
    await query(`
      CREATE TABLE activity_logs (
        id INT AUTO_INCREMENT PRIMARY KEY,
        
        -- User yang melakukan action
        user_id INT NOT NULL,
        user_name VARCHAR(255) NULL,
        user_email VARCHAR(255) NULL,
        user_role ENUM('owner', 'admin') NOT NULL,
        
        -- Action details
        action VARCHAR(100) NOT NULL,
        entity_type VARCHAR(50) NULL,
        entity_id INT NULL,
        
        -- Branch context (WAJIB untuk activity logs)
        branch_id INT NOT NULL,
        branch_name VARCHAR(255) NULL,
        
        -- Change details (JSON untuk flexibility)
        old_values JSON NULL,
        new_values JSON NULL,
        changes JSON NULL,
        
        -- Request details
        ip_address VARCHAR(45) NULL,
        user_agent TEXT NULL,
        request_method VARCHAR(10) NULL,
        request_path VARCHAR(500) NULL,
        
        -- Status
        status ENUM('success', 'failed', 'pending') DEFAULT 'success',
        error_message TEXT NULL,
        
        -- Metadata
        metadata JSON NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        
        -- Indexes (optimized untuk owner queries)
        INDEX idx_branch_id (branch_id),
        INDEX idx_user_id (user_id),
        INDEX idx_action (action),
        INDEX idx_entity_type (entity_type),
        INDEX idx_entity_id (entity_id),
        INDEX idx_created_at (created_at),
        INDEX idx_branch_created (branch_id, created_at),
        INDEX idx_user_action (user_id, action),
        INDEX idx_entity (entity_type, entity_id),
        
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    
    console.log('  Created activity_logs table');
  },
  
  down: async ({ query }) => {
    await query(`DROP TABLE IF EXISTS activity_logs`);
    console.log('  Dropped activity_logs table');
  }
};

