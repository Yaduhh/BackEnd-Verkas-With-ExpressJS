module.exports = {
  up: async ({ query }) => {
    // 1. Create products table
    await query(`
      CREATE TABLE IF NOT EXISTS products (
        id INT AUTO_INCREMENT PRIMARY KEY,
        branch_id INT NOT NULL,
        name VARCHAR(100) NOT NULL,
        description VARCHAR(255) NULL,
        is_active TINYINT(1) DEFAULT 1,
        status_deleted TINYINT(1) DEFAULT 0,
        deleted_at TIMESTAMP NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_products_branch (branch_id),
        INDEX idx_products_status (status_deleted),
        CONSTRAINT fk_products_branch FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    console.log('  Created products table');

    // 2. Create product_brands table
    await query(`
      CREATE TABLE IF NOT EXISTS product_brands (
        id INT AUTO_INCREMENT PRIMARY KEY,
        product_id INT NOT NULL,
        name VARCHAR(100) NOT NULL,
        description VARCHAR(255) NULL,
        is_active TINYINT(1) DEFAULT 1,
        status_deleted TINYINT(1) DEFAULT 0,
        deleted_at TIMESTAMP NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_product_brands_product (product_id),
        INDEX idx_product_brands_status (status_deleted),
        CONSTRAINT fk_pb_product FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    console.log('  Created product_brands table');

    // 3. Create transaction_product_items table
    await query(`
      CREATE TABLE IF NOT EXISTS transaction_product_items (
        id INT AUTO_INCREMENT PRIMARY KEY,
        transaction_id INT NOT NULL,
        product_id INT NOT NULL,
        brand_id INT NULL,
        amount DECIMAL(15,2) NOT NULL DEFAULT 0,
        notes VARCHAR(255) NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_tpi_transaction (transaction_id),
        INDEX idx_tpi_product (product_id),
        INDEX idx_tpi_brand (brand_id),
        CONSTRAINT fk_tpi_transaction FOREIGN KEY (transaction_id) REFERENCES transactions(id) ON DELETE CASCADE,
        CONSTRAINT fk_tpi_product FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE RESTRICT,
        CONSTRAINT fk_tpi_brand FOREIGN KEY (brand_id) REFERENCES product_brands(id) ON DELETE SET NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    console.log('  Created transaction_product_items table');
  },

  down: async ({ query }) => {
    await query('DROP TABLE IF EXISTS transaction_product_items');
    await query('DROP TABLE IF EXISTS product_brands');
    await query('DROP TABLE IF EXISTS products');
    console.log('  Dropped products, product_brands, and transaction_product_items tables');
  }
};
