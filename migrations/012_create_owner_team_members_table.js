module.exports = {
  up: async ({ query }) => {
    await query(`
      CREATE TABLE owner_team_members (
        id INT AUTO_INCREMENT PRIMARY KEY,
        team_id INT NOT NULL,
        user_id INT NOT NULL,
        role ENUM('owner', 'member') DEFAULT 'member',
        status ENUM('active', 'invited', 'removed') DEFAULT 'invited',
        invited_by INT NULL,
        joined_at DATETIME NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY unique_team_member (team_id, user_id),
        INDEX idx_team_members_team_id (team_id),
        INDEX idx_team_members_user_id (user_id),
        INDEX idx_team_members_status (status),
        FOREIGN KEY (team_id) REFERENCES owner_teams(id) ON DELETE CASCADE,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (invited_by) REFERENCES users(id) ON DELETE SET NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    
    // Add foreign key for branches.team_id after owner_teams is created
    // Check if foreign key already exists
    try {
      await query(`
        ALTER TABLE branches
        ADD CONSTRAINT fk_branches_team_id
        FOREIGN KEY (team_id) REFERENCES owner_teams(id) ON DELETE SET NULL
      `);
      console.log('  Added foreign key for branches.team_id');
    } catch (error) {
      // Foreign key might already exist, ignore
      if (!error.message.includes('Duplicate foreign key')) {
        throw error;
      }
      console.log('  Foreign key for branches.team_id already exists');
    }
    
    console.log('  Created owner_team_members table');
  },
  
  down: async ({ query }) => {
    // Remove foreign key first
    try {
      await query(`ALTER TABLE branches DROP FOREIGN KEY branches_ibfk_3`);
    } catch (error) {
      // Foreign key might not exist or have different name
      console.log('  Note: Could not drop branches foreign key (might not exist)');
    }
    
    await query(`DROP TABLE IF EXISTS owner_team_members`);
    console.log('  Dropped owner_team_members table');
  }
};

