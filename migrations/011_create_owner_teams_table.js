module.exports = {
  up: async ({ query }) => {
    await query(`
      CREATE TABLE owner_teams (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        primary_owner_id INT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_teams_primary_owner (primary_owner_id),
        FOREIGN KEY (primary_owner_id) REFERENCES users(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    
    console.log('  Created owner_teams table');
  },
  
  down: async ({ query }) => {
    await query(`DROP TABLE IF EXISTS owner_teams`);
    console.log('  Dropped owner_teams table');
  }
};

