module.exports = {
  up: async ({ query }) => {
    await query(`
      CREATE TABLE IF NOT EXISTS bagi_hasil_templates (
        id INT AUTO_INCREMENT PRIMARY KEY,
        branch_id INT NOT NULL,
        name VARCHAR(255) NOT NULL,
        template_data JSON NOT NULL,
        is_default TINYINT(1) DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        CONSTRAINT fk_bht_branch FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE CASCADE
      )
    `);

    try {
      await query(`CREATE INDEX idx_bht_branch_id ON bagi_hasil_templates(branch_id)`);
    } catch (e) {
      console.log('Index idx_bht_branch_id may already exist');
    }

    console.log('  Created bagi_hasil_templates table');
  },

  down: async ({ query }) => {
    await query(`DROP TABLE IF EXISTS bagi_hasil_templates`);
    console.log('  Dropped bagi_hasil_templates table');
  }
};
