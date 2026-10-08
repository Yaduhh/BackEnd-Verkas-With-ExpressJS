module.exports = {
  up: async ({ query }) => {
    // 1. Create sales_channels table
    await query(`
      CREATE TABLE IF NOT EXISTS sales_channels (
        id INT AUTO_INCREMENT PRIMARY KEY,
        branch_id INT NULL,
        name VARCHAR(100) NOT NULL,
        description VARCHAR(255) NULL,
        is_active TINYINT(1) DEFAULT 1,
        status_deleted TINYINT(1) DEFAULT 0,
        deleted_at TIMESTAMP NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_sales_channels_branch (branch_id),
        INDEX idx_sales_channels_status (status_deleted),
        CONSTRAINT fk_sc_branch FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    console.log('  Created sales_channels table');

    // 2. Create transaction_sales_channels table
    await query(`
      CREATE TABLE IF NOT EXISTS transaction_sales_channels (
        id INT AUTO_INCREMENT PRIMARY KEY,
        transaction_id INT NOT NULL,
        sales_channel_id INT NOT NULL,
        amount DECIMAL(15,2) NOT NULL DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_tsc_transaction (transaction_id),
        INDEX idx_tsc_sales_channel (sales_channel_id),
        CONSTRAINT fk_tsc_transaction FOREIGN KEY (transaction_id) REFERENCES transactions(id) ON DELETE CASCADE,
        CONSTRAINT fk_tsc_sales_channel FOREIGN KEY (sales_channel_id) REFERENCES sales_channels(id) ON DELETE RESTRICT
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    console.log('  Created transaction_sales_channels table');

    // 3. Seed default sales channels (global default with branch_id = NULL)
    const defaultChannels = [
      { name: 'Dine In / Kasir Offline', description: 'Penjualan langsung di outlet/kasir' },
      { name: 'GrabFood', description: 'Pesanan melalui platform GrabFood' },
      { name: 'GoFood', description: 'Pesanan melalui platform GoFood' },
      { name: 'ShopeeFood', description: 'Pesanan melalui platform ShopeeFood' },
      { name: 'Takeaway / Delivery Manual', description: 'Pesanan bungkus / WhatsApp delivery' }
    ];

    for (const ch of defaultChannels) {
      const existing = await query('SELECT id FROM sales_channels WHERE name = ? AND branch_id IS NULL LIMIT 1', [ch.name]);
      if (existing.length === 0) {
        await query(
          'INSERT INTO sales_channels (name, description, branch_id, is_active, status_deleted) VALUES (?, ?, NULL, 1, 0)',
          [ch.name, ch.description]
        );
      }
    }
    console.log('  Seeded default global sales channels');
  },

  down: async ({ query }) => {
    await query('DROP TABLE IF EXISTS transaction_sales_channels');
    console.log('  Dropped transaction_sales_channels table');
    await query('DROP TABLE IF EXISTS sales_channels');
    console.log('  Dropped sales_channels table');
  }
};
