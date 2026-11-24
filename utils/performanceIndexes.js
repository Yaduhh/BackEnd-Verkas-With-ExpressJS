const { query } = require('../config/database');

const PERFORMANCE_INDEXES = [
  { table: 'transactions', name: 'idx_tx_branch_del_date', columns: '(branch_id, status_deleted, transaction_date)' },
  { table: 'transactions', name: 'idx_tx_branch_type_del_cat', columns: '(branch_id, type, status_deleted, category_id)' },
  { table: 'transactions', name: 'idx_tx_mitra_del_date', columns: '(mitra_piutang_id, status_deleted, transaction_date)' },
  { table: 'transaction_repayments', name: 'idx_tr_paydate_del_tx', columns: '(deleted_at, payment_date, transaction_id)' },
  { table: 'transaction_repayments', name: 'idx_tr_tx_del_paydate', columns: '(transaction_id, deleted_at, payment_date)' },
  { table: 'transaction_repayments', name: 'idx_tr_income_tx_del', columns: '(income_transaction_id, deleted_at)' },
  { table: 'transaction_refunds', name: 'idx_tref_refund_date_tx', columns: '(refund_date, transaction_id)' },
  { table: 'transaction_refunds', name: 'idx_tref_tx_refund_date', columns: '(transaction_id, refund_date)' },
  { table: 'transaction_income_details', name: 'idx_tid_tx_id', columns: '(transaction_id)' },
  { table: 'transaction_savings_details', name: 'idx_tsd_tx_cat', columns: '(transaction_id, category_id)' },
  { table: 'transaction_mitra_details', name: 'idx_tmd_mitra_tx', columns: '(mitra_piutang_id, transaction_id)' },
];

let ensurePromise = null;

/**
 * Ensures composite indexes required by Kas Berjalan / Dashboard queries exist.
 * Idempotent and cached per process so it runs the metadata check once.
 */
async function ensurePerformanceIndexes(queryFn = query) {
  const existingTablesRows = await queryFn(
    `SELECT TABLE_NAME
     FROM INFORMATION_SCHEMA.TABLES
     WHERE TABLE_SCHEMA = DATABASE()`
  );
  const existingTables = new Set(existingTablesRows.map((r) => r.TABLE_NAME));

  const indexNames = PERFORMANCE_INDEXES.map((i) => i.name);
  const placeholders = indexNames.map(() => '?').join(',');
  const existingIdxRows = await queryFn(
    `SELECT DISTINCT TABLE_NAME, INDEX_NAME
     FROM INFORMATION_SCHEMA.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE()
       AND INDEX_NAME IN (${placeholders})`,
    indexNames
  );
  const existingIdxSet = new Set(existingIdxRows.map((r) => `${r.TABLE_NAME}.${r.INDEX_NAME}`));

  for (const idx of PERFORMANCE_INDEXES) {
    if (!existingTables.has(idx.table)) continue;
    if (existingIdxSet.has(`${idx.table}.${idx.name}`)) continue;
    try {
      await queryFn(`ALTER TABLE ${idx.table} ADD INDEX ${idx.name} ${idx.columns}`);
    } catch (err) {
      // Ignore duplicate index errors in case of concurrent workers
      if (err && err.code !== 'ER_DUP_KEYNAME') {
        console.warn(`[PerformanceIndexes] Failed creating ${idx.name} on ${idx.table}:`, err.message);
      }
    }
  }
}

function ensurePerformanceIndexesOnce() {
  if (!ensurePromise) {
    ensurePromise = ensurePerformanceIndexes().catch((err) => {
      console.warn('[PerformanceIndexes] Lazy index check skipped:', err.message);
    });
  }
  return ensurePromise;
}

module.exports = {
  PERFORMANCE_INDEXES,
  ensurePerformanceIndexes,
  ensurePerformanceIndexesOnce,
};
