module.exports = {
  up: async ({ query }) => {
    const cols = await query(`
      SELECT COLUMN_NAME
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'payment_methods'
        AND COLUMN_NAME = 'sort_order'
    `);
    if (cols.length === 0) {
      await query(`
        ALTER TABLE payment_methods
        ADD COLUMN sort_order INT NOT NULL DEFAULT 0 AFTER default_bank_account_id
      `);
      console.log('  Added sort_order to payment_methods');
    }

    // Backfill initial sort order matching current default grouping (PB1 first alphabetically, then non-PB1)
    const rows = await query(`
      SELECT id
      FROM payment_methods
      ORDER BY (CASE WHEN is_taxable = 1 THEN 0 ELSE 1 END) ASC, name ASC, id ASC
    `);
    for (let i = 0; i < rows.length; i += 1) {
      await query(`UPDATE payment_methods SET sort_order = ? WHERE id = ?`, [i + 1, rows[i].id]);
    }
    console.log(`  Initialized sort_order for ${rows.length} payment method(s)`);
  },

  down: async ({ query }) => {
    await query(`
      ALTER TABLE payment_methods
      DROP COLUMN IF EXISTS sort_order
    `);
  }
};
