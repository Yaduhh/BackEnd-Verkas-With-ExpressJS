module.exports = {
  up: async ({ query }) => {
    await query(`
      CREATE TABLE transactions (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT NOT NULL,
        type ENUM('income', 'expense') NOT NULL,
        category_id INT NOT NULL,
        amount DECIMAL(15,2) NOT NULL,
        note TEXT,
        transaction_date DATE NOT NULL,
        status_deleted BOOLEAN DEFAULT false,
        deleted_at DATETIME NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_transactions_user_id (user_id),
        INDEX idx_transactions_transaction_date (transaction_date),
        INDEX idx_transactions_category_id (category_id),
        INDEX idx_transactions_type (type),
        INDEX idx_transactions_status_deleted (status_deleted),
        INDEX idx_transactions_deleted_at (deleted_at),
        INDEX idx_transactions_user_date_status (user_id, transaction_date, status_deleted),
        INDEX idx_transactions_user_date_type_status (user_id, transaction_date, type, status_deleted),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE RESTRICT
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    
    console.log('  Created transactions table');
  },
  
  down: async ({ query }) => {
    await query(`DROP TABLE IF EXISTS transactions`);
    console.log('  Dropped transactions table');
  }
};

