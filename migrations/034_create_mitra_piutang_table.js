module.exports = {
  up: async ({ query }) => {
    await query(`
      CREATE TABLE mitra_piutang (
        id INT AUTO_INCREMENT PRIMARY KEY,
        branch_id INT NOT NULL,
        nama VARCHAR(255) NOT NULL,
        created_by INT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        deleted_at DATETIME NULL,
        INDEX idx_mitra_piutang_branch_id (branch_id),
        INDEX idx_mitra_piutang_created_by (created_by),
        INDEX idx_mitra_piutang_deleted_at (deleted_at),
        FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE CASCADE,
        FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    
    console.log('  Created mitra_piutang table');
  },
  
  down: async ({ query }) => {
    await query(`DROP TABLE IF EXISTS mitra_piutang`);
    console.log('  Dropped mitra_piutang table');
  }
};

