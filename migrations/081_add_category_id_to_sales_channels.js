module.exports = {
  up: async ({ query }) => {
    // 1. Add category_id column to sales_channels table
    await query(`
      ALTER TABLE sales_channels 
      ADD COLUMN category_id INT NULL AFTER branch_id,
      ADD INDEX idx_sales_channels_category (category_id),
      ADD CONSTRAINT fk_sales_channels_category FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE SET NULL
    `);
    console.log('  Added category_id column and foreign key to sales_channels table');

    // 2. Map existing sales_channels to each branch's "Omzet" / "Omzet Penjualan" category
    await query(`
      UPDATE sales_channels sc
      INNER JOIN categories c ON c.branch_id = sc.branch_id 
        AND (c.name LIKE '%Omzet%' OR c.name LIKE '%OMZET%' OR c.name LIKE '%Omset%' OR c.name LIKE '%OMSET%')
        AND c.parent_id IS NULL
        AND c.status_deleted = 0
      SET sc.category_id = c.id
      WHERE sc.category_id IS NULL
    `);
    console.log('  Mapped existing sales channels to their branch Omzet category');
  },

  down: async ({ query }) => {
    await query(`
      ALTER TABLE sales_channels 
      DROP FOREIGN KEY fk_sales_channels_category,
      DROP INDEX idx_sales_channels_category,
      DROP COLUMN category_id
    `);
  }
};
