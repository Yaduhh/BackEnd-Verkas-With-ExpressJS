module.exports = {
  up: async ({ query }) => {
    await query(`
      CREATE TABLE system_logs (
        id INT AUTO_INCREMENT PRIMARY KEY,
        
        -- Log level
        level ENUM('info', 'warning', 'error', 'critical') NOT NULL DEFAULT 'info',
        category VARCHAR(50) NOT NULL,
        message TEXT NOT NULL,
        
        -- Context (JSON untuk flexibility)
        context JSON NULL,
        
        -- Optional user context
        user_id INT NULL,
        branch_id INT NULL,
        
        -- Request details (jika error dari API request)
        ip_address VARCHAR(45) NULL,
        request_method VARCHAR(10) NULL,
        request_path VARCHAR(500) NULL,
        
        -- Error details
        stack_trace TEXT NULL,
        error_code VARCHAR(50) NULL,
        
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        
        -- Indexes
        INDEX idx_level (level),
        INDEX idx_category (category),
        INDEX idx_user_id (user_id),
        INDEX idx_branch_id (branch_id),
        INDEX idx_created_at (created_at),
        INDEX idx_level_category (level, category),
        
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
        FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE SET NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    
    console.log('  Created system_logs table');
  },
  
  down: async ({ query }) => {
    await query(`DROP TABLE IF EXISTS system_logs`);
    console.log('  Dropped system_logs table');
  }
};

