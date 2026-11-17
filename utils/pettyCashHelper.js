const { query } = require('../config/database');

let lockColReadyPromise = null;

/**
 * Ensures `petty_cashes.lock_bank_account` exists even if migrations have not been run yet.
 */
async function ensurePettyCashLockColumn() {
  if (!lockColReadyPromise) {
    lockColReadyPromise = (async () => {
      try {
        const cols = await query(
          `SELECT COLUMN_NAME
           FROM INFORMATION_SCHEMA.COLUMNS
           WHERE TABLE_SCHEMA = DATABASE()
             AND TABLE_NAME = 'petty_cashes'
             AND COLUMN_NAME = 'lock_bank_account'`
        );
        if (!cols || cols.length === 0) {
          await query(
            `ALTER TABLE petty_cashes
             ADD COLUMN lock_bank_account TINYINT(1) NOT NULL DEFAULT 0 AFTER bank_account_id`
          );
        }
      } catch (err) {
        lockColReadyPromise = null;
        throw err;
      }
    })();
  }
  return lockColReadyPromise;
}

/**
 * Normalizes the lock_bank_account flag; unlinked pockets can never be locked.
 */
function normalizeLockBankFlag(rawValue, bankAccountId) {
  if (!bankAccountId) return 0;
  return rawValue === true || rawValue === 1 || rawValue === '1' || rawValue === 'true' ? 1 : 0;
}

module.exports = {
  ensurePettyCashLockColumn,
  normalizeLockBankFlag
};
