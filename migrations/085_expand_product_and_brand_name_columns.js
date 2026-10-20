module.exports = {
  up: async ({ query }) => {
    try {
      await query(`
        ALTER TABLE products 
        MODIFY COLUMN name VARCHAR(255) NOT NULL,
        MODIFY COLUMN description TEXT NULL
      `);
      console.log('  Expanded products name to VARCHAR(255) and description to TEXT');
    } catch (e) {
      console.warn('  Warning altering products table:', e.message);
    }

    try {
      await query(`
        ALTER TABLE product_brands 
        MODIFY COLUMN name VARCHAR(255) NOT NULL,
        MODIFY COLUMN description TEXT NULL
      `);
      console.log('  Expanded product_brands name to VARCHAR(255) and description to TEXT');
    } catch (e) {
      console.warn('  Warning altering product_brands table:', e.message);
    }
  },

  down: async ({ query }) => {
    try {
      await query(`
        ALTER TABLE products 
        MODIFY COLUMN name VARCHAR(100) NOT NULL,
        MODIFY COLUMN description VARCHAR(255) NULL
      `);
      await query(`
        ALTER TABLE product_brands 
        MODIFY COLUMN name VARCHAR(100) NOT NULL,
        MODIFY COLUMN description VARCHAR(255) NULL
      `);
      console.log('  Reverted products and product_brands column lengths to 100/255');
    } catch (e) {
      console.warn('  Warning reverting column lengths:', e.message);
    }
  }
};
