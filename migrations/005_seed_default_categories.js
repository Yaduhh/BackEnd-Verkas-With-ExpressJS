module.exports = {
  up: async ({ query }) => {
    // Default Expense Categories
    const expenseCategories = [
      'Makanan',
      'Minuman',
      'Transport',
      'Tagihan',
      'Belanja',
      'Kesehatan',
      'Hiburan',
      'Pendidikan',
      'Hadiah',
      'Lainnya'
    ];
    
    // Default Income Categories
    const incomeCategories = [
      'Gaji',
      'Bonus',
      'Side Job',
      'Investasi'
    ];
    
    // Insert expense categories
    for (const name of expenseCategories) {
      await query(`
        INSERT INTO categories (name, type, user_id, is_default, status_deleted)
        VALUES (?, 'expense', NULL, true, false)
      `, [name]);
    }
    
    // Insert income categories
    for (const name of incomeCategories) {
      await query(`
        INSERT INTO categories (name, type, user_id, is_default, status_deleted)
        VALUES (?, 'income', NULL, true, false)
      `, [name]);
    }
    
    console.log(`  Seeded ${expenseCategories.length} expense categories`);
    console.log(`  Seeded ${incomeCategories.length} income categories`);
  },
  
  down: async ({ query }) => {
    await query(`DELETE FROM categories WHERE is_default = true`);
    console.log('  Removed default categories');
  }
};

