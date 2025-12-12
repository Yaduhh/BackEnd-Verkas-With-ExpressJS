module.exports = {
  up: async ({ query }) => {
    await query(`
      CREATE TABLE device_tokens (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT NOT NULL,
        device_token VARCHAR(255) NOT NULL,
        platform ENUM('ios', 'android', 'web') NOT NULL,
        device_name VARCHAR(255),
        app_version VARCHAR(50),
        is_active BOOLEAN DEFAULT true,
        last_used_at DATETIME NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY unique_user_device (user_id, device_token),
        INDEX idx_device_tokens_user_id (user_id),
        INDEX idx_device_tokens_active (is_active),
        INDEX idx_device_tokens_token (device_token),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    
    console.log('  Created device_tokens table');
  },
  
  down: async ({ query }) => {
    await query(`DROP TABLE IF EXISTS device_tokens`);
    console.log('  Dropped device_tokens table');
  }
};

