module.exports = {
  up: async ({ query }) => {
    await query(`
      CREATE TABLE categories (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        type ENUM('income', 'expense') NOT NULL,
        user_id INT NULL,
        is_default BOOLEAN DEFAULT false,
        status_deleted BOOLEAN DEFAULT false,
        deleted_at DATETIME NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_categories_user_id (user_id),
        INDEX idx_categories_type (type),
        INDEX idx_categories_status_deleted (status_deleted),
        INDEX idx_categories_deleted_at (deleted_at),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    
    console.log('  Created categories table');
  },
  
  down: async ({ query }) => {
    await query(`DROP TABLE IF EXISTS categories`);
    console.log('  Dropped categories table');
  }
};

