module.exports = {
  up: async ({ query }) => {
    await query(`
      CREATE TABLE transaction_edits (
        id INT AUTO_INCREMENT PRIMARY KEY,
        transaction_id INT NOT NULL,
        requester_id INT NOT NULL,
        approver_id INT NULL,
        reason TEXT NOT NULL,
        old_data JSON NULL,
        new_data JSON NULL,
        status ENUM('pending', 'approved', 'rejected') DEFAULT 'pending',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        
        FOREIGN KEY (transaction_id) REFERENCES transactions(id) ON DELETE CASCADE,
        FOREIGN KEY (requester_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (approver_id) REFERENCES users(id) ON DELETE SET NULL,
        INDEX idx_transaction_id (transaction_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    
    console.log('  Created transaction_edits table');
  },
  
  down: async ({ query }) => {
    await query(`DROP TABLE IF EXISTS transaction_edits`);
    console.log('  Dropped transaction_edits table');
  }
};
