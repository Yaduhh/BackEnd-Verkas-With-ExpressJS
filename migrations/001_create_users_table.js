module.exports = {
  up: async ({ query }) => {
    await query(`
      CREATE TABLE users (
        id INT AUTO_INCREMENT PRIMARY KEY,
        email VARCHAR(255) NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        name VARCHAR(255),
        role ENUM('owner', 'admin') NOT NULL DEFAULT 'admin',
        status_deleted BOOLEAN DEFAULT false,
        deleted_at DATETIME NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_users_email (email),
        INDEX idx_users_role (role),
        INDEX idx_users_status_deleted (status_deleted),
        INDEX idx_users_deleted_at (deleted_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    
    console.log('  Created users table');
  },
  
  down: async ({ query }) => {
    await query(`DROP TABLE IF EXISTS users`);
    console.log('  Dropped users table');
  }
};

