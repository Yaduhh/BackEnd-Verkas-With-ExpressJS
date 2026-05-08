const { query } = require('../config/database');

module.exports = {
  up: async (db) => {
    // Menghapus kolom amount karena user hanya ingin Nominal Apk dan Nominal Kasir
    await db.query('ALTER TABLE transaction_income_details DROP COLUMN amount');
  },

  down: async (db) => {
    // Jika rollback, kembalikan kolom amount
    await db.query('ALTER TABLE transaction_income_details ADD COLUMN amount DECIMAL(15, 2) NOT NULL DEFAULT 0 AFTER payment_method_id');
  }
};
