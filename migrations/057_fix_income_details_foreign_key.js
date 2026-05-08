module.exports = {
  up: async (db) => {
    // 1. Hapus Foreign Key yang salah (ngerujuk ke categories)
    try {
      await db.query('ALTER TABLE transaction_income_details DROP FOREIGN KEY fk_tid_category');
    } catch (e) {
      console.log('  Constraint fk_tid_category not found or already dropped.');
    }

    // 2. Tambahkan Foreign Key yang benar (ngerujuk ke payment_methods)
    await db.query(`
      ALTER TABLE transaction_income_details 
      ADD CONSTRAINT fk_tid_payment_method 
      FOREIGN KEY (payment_method_id) REFERENCES payment_methods(id) 
      ON DELETE CASCADE
    `);
    
    console.log('  Fixed foreign key: payment_method_id now references payment_methods(id)');
  },

  down: async (db) => {
    // Kembalikan ke yang salah (kalo mau rollback)
    try {
      await db.query('ALTER TABLE transaction_income_details DROP FOREIGN KEY fk_tid_payment_method');
      await db.query(`
        ALTER TABLE transaction_income_details 
        ADD CONSTRAINT fk_tid_category 
        FOREIGN KEY (payment_method_id) REFERENCES categories(id) 
        ON DELETE CASCADE
      `);
    } catch (e) {
      console.log('  Rollback failed: constraints might not exist.');
    }
  }
};
