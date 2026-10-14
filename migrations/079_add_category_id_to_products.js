module.exports = {
  up: async ({ query }) => {
    // 1. Add category_id column to products table
    await query(`
      ALTER TABLE products 
      ADD COLUMN category_id INT NULL AFTER branch_id,
      ADD INDEX idx_products_category (category_id),
      ADD CONSTRAINT fk_products_category FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE SET NULL
    `);
    console.log('  Added category_id column and foreign key to products table');

    // 2. Map existing products to their branch's "Bahan Baku" category
    await query(`
      UPDATE products p
      INNER JOIN categories c ON c.branch_id = p.branch_id 
        AND (c.name LIKE '%Bahan Baku%' OR c.name LIKE '%BAHAN BAKU%')
        AND c.status_deleted = 0
      SET p.category_id = c.id
      WHERE p.category_id IS NULL
    `);
    console.log('  Mapped existing seeded products to their branch Bahan Baku category');
  },

  down: async ({ query }) => {
    await query(`
      ALTER TABLE products 
      DROP FOREIGN KEY fk_products_category,
      DROP INDEX idx_products_category,
      DROP COLUMN category_id
    `);
  }
};
