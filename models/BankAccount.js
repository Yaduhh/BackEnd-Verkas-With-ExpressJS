const { query } = require('../config/database');
const { ensurePettyCashLockColumn, normalizeLockBankFlag } = require('../utils/pettyCashHelper');

let columnsReadyPromise = null;

async function ensureInitialBalanceColumns() {
  if (!columnsReadyPromise) {
    columnsReadyPromise = (async () => {
      try {
        const cols = await query(
          `SELECT COLUMN_NAME
           FROM INFORMATION_SCHEMA.COLUMNS
           WHERE TABLE_SCHEMA = DATABASE()
             AND TABLE_NAME = 'bank_accounts'
             AND COLUMN_NAME IN ('initial_balance', 'initial_balance_date', 'initial_balance_note')`
        );
        const existing = new Set(cols.map((c) => c.COLUMN_NAME));

        if (!existing.has('initial_balance')) {
          await query(
            `ALTER TABLE bank_accounts
             ADD COLUMN initial_balance DECIMAL(15, 2) NOT NULL DEFAULT 0.00 AFTER type`
          );
        }
        if (!existing.has('initial_balance_date')) {
          await query(
            `ALTER TABLE bank_accounts
             ADD COLUMN initial_balance_date DATE NULL DEFAULT NULL AFTER initial_balance`
          );
        }
        if (!existing.has('initial_balance_note')) {
          await query(
            `ALTER TABLE bank_accounts
             ADD COLUMN initial_balance_note VARCHAR(255) NULL DEFAULT NULL AFTER initial_balance_date`
          );
        }
      } catch (err) {
        columnsReadyPromise = null;
        throw err;
      }
    })();
  }
  return columnsReadyPromise;
}

function normalizeDateOnly(val) {
  if (!val) return null;
  if (val instanceof Date) {
    if (isNaN(val.getTime())) return null;
    const y = val.getFullYear();
    const m = String(val.getMonth() + 1).padStart(2, '0');
    const d = String(val.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  const str = String(val).trim();
  if (!str) return null;
  const match = str.match(/^(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : null;
}

const BALANCE_SQL = `
  CAST(
    CASE 
      WHEN ba.type = 'savings' THEN
        COALESCE(
          (SELECT SUM(saa.allocated_amount)
           FROM savings_account_allocations saa
           JOIN categories c ON saa.category_id = c.id
           WHERE saa.bank_account_id = ba.id 
             AND c.status_deleted = false
             AND (
               c.branch_id = ba.branch_id
               OR EXISTS (
                 SELECT 1 FROM bank_account_branches bab
                 WHERE bab.bank_account_id = ba.id AND bab.branch_id = c.branch_id
               )
             )),
          0
        )
      ELSE
        (
          COALESCE(ba.initial_balance, 0)
          +
          COALESCE(
            (SELECT SUM(
               CASE 
                 WHEN (t.is_debt_payment = 1 OR t.is_debt_payment = true) THEN COALESCE(t.paid_amount, 0)
                 ELSE t.amount 
               END
             )
             FROM transactions t
             WHERE t.bank_account_id = ba.id 
               AND t.type = 'income'
               AND t.status_deleted = false 
               AND (t.is_draft = false OR t.is_draft IS NULL)
               AND (ba.initial_balance_date IS NULL OR DATE(t.transaction_date) >= ba.initial_balance_date)),
            0
          )
          +
          COALESCE(
            (SELECT SUM(CASE WHEN tid.amount_cashier > 0 THEN tid.amount_cashier ELSE COALESCE(tid.amount_app, 0) END)
             FROM transaction_income_details tid
             JOIN transactions t ON tid.transaction_id = t.id
             WHERE tid.bank_account_id = ba.id
               AND t.status_deleted = false
               AND (t.is_draft = false OR t.is_draft IS NULL)
               AND (ba.initial_balance_date IS NULL OR DATE(t.transaction_date) >= ba.initial_balance_date)),
            0
          )
          -
          COALESCE(
            (SELECT SUM(t.amount)
             FROM transactions t
             WHERE t.bank_account_id = ba.id
               AND t.type = 'expense'
               AND t.status_deleted = false
               AND (t.is_draft = false OR t.is_draft IS NULL)
               AND (ba.initial_balance_date IS NULL OR DATE(t.transaction_date) >= ba.initial_balance_date)),
            0
          )
          -
          COALESCE(
            (SELECT SUM(pct.amount)
             FROM petty_cash_transactions pct
             JOIN petty_cashes pc ON pct.petty_cash_id = pc.id
             WHERE pct.bank_account_id = ba.id
               AND pct.type = 'expense'
               AND pct.status_deleted = 0
               AND pc.status_deleted = 0
               AND (ba.initial_balance_date IS NULL OR DATE(pct.transaction_date) >= ba.initial_balance_date)),
            0
          )
          +
          COALESCE(
            (SELECT SUM(ft.amount)
             FROM fund_transfers ft
             WHERE ft.to_bank_account_id = ba.id
               AND ft.status_deleted = 0
               AND (ba.initial_balance_date IS NULL OR DATE(ft.transfer_date) >= ba.initial_balance_date)),
            0
          )
          -
          COALESCE(
            (SELECT SUM(ft.amount)
             FROM fund_transfers ft
             WHERE ft.from_bank_account_id = ba.id
               AND ft.status_deleted = 0
               AND (ba.initial_balance_date IS NULL OR DATE(ft.transfer_date) >= ba.initial_balance_date)),
            0
          )
          +
          COALESCE(
            (SELECT SUM(pct.amount)
             FROM petty_cash_transactions pct
             JOIN petty_cashes pc ON pct.petty_cash_id = pc.id
             WHERE pc.bank_account_id = ba.id
               AND pct.type = 'topup'
               AND pct.status_deleted = 0
               AND pc.status_deleted = 0
               AND (ba.initial_balance_date IS NULL OR DATE(pct.transaction_date) >= ba.initial_balance_date)),
            0
          )
          -
          COALESCE(
            (SELECT SUM(pct.amount)
             FROM petty_cash_transactions pct
             JOIN petty_cashes pc ON pct.petty_cash_id = pc.id
             WHERE pct.bank_account_id = ba.id
               AND pct.type = 'topup'
               AND pct.status_deleted = 0
               AND pc.status_deleted = 0
               AND (ba.initial_balance_date IS NULL OR DATE(pct.transaction_date) >= ba.initial_balance_date)),
            0
          )
        )
    END AS DECIMAL(15, 2)
  ) AS balance
`;

const ACCESSIBLE_ACCOUNT_CLAUSE = (alias = 'ba') =>
  `(${alias}.branch_id = ? OR EXISTS (SELECT 1 FROM bank_account_branches bab WHERE bab.bank_account_id = ${alias}.id AND bab.branch_id = ?))`;

class BankAccount {
  static async _attachSharedBranches(rows) {
    if (!Array.isArray(rows) || rows.length === 0) return [];
    const ids = rows.map((r) => Number(r.id)).filter((id) => Number.isFinite(id) && id > 0);
    if (ids.length === 0) return rows;

    const placeholders = ids.map(() => '?').join(',');
    const branchRows = await query(
      `SELECT bab.bank_account_id, b.id as branch_id, b.name as branch_name, b.code as branch_code, b.group_name
       FROM bank_account_branches bab
       JOIN branches b ON bab.branch_id = b.id
       WHERE bab.bank_account_id IN (${placeholders})
       ORDER BY b.name ASC`,
      ids
    );

    const byAccount = new Map();
    for (const row of branchRows) {
      const accId = Number(row.bank_account_id);
      if (!byAccount.has(accId)) byAccount.set(accId, []);
      byAccount.get(accId).push({
        id: Number(row.branch_id),
        name: row.branch_name,
        code: row.branch_code || null,
        group_name: row.group_name || null
      });
    }

    return rows.map((row) => {
      const accId = Number(row.id);
      const mapped = byAccount.get(accId) || [];
      const fallbackHome = row.branch_id
        ? [{ id: Number(row.branch_id), name: row.branch_name || '', code: row.branch_code || null, group_name: row.branch_group_name || null }]
        : [];
      const sharedBranches = mapped.length > 0 ? mapped : fallbackHome;
      const sharedIds = sharedBranches.map((b) => b.id);

      return {
        ...row,
        linked_petty_cash_lock_bank: Boolean(row.linked_petty_cash_id && row.linked_petty_cash_lock_bank),
        initial_balance: Number(row.initial_balance || 0),
        balance: Number(row.balance || 0),
        shared_branch_ids: sharedIds,
        shared_branches: sharedBranches,
        is_shared: sharedIds.length > 1
      };
    });
  }

  static async _syncSharedBranches(accountId, homeBranchId, type, sharedBranchIds) {
    const cleanIds = Array.from(
      new Set(
        [homeBranchId, ...(Array.isArray(sharedBranchIds) ? sharedBranchIds : [])]
          .map((id) => parseInt(id, 10))
          .filter((id) => Number.isFinite(id) && id > 0)
      )
    );

    if (cleanIds.length === 0) return;

    await query(`DELETE FROM bank_account_branches WHERE bank_account_id = ?`, [accountId]);
    for (const bId of cleanIds) {
      await query(
        `INSERT IGNORE INTO bank_account_branches (bank_account_id, branch_id) VALUES (?, ?)`,
        [accountId, bId]
      );
    }
  }

  static async findAll(branchId, type = null) {
    await ensureInitialBalanceColumns();
    await ensurePettyCashLockColumn();

    let sql = `
      SELECT 
        ba.id,
        ba.name,
        ba.account_number,
        ba.branch_id,
        b.name as branch_name,
        b.code as branch_code,
        b.group_name as branch_group_name,
        ba.type,
        COALESCE(ba.account_category, 'real') AS account_category,
        CAST(COALESCE(ba.initial_balance, 0) AS DECIMAL(15, 2)) AS initial_balance,
        DATE_FORMAT(ba.initial_balance_date, '%Y-%m-%d') AS initial_balance_date,
        ba.initial_balance_note,
        ba.is_active,
        ba.created_at,
        ba.updated_at,
        (SELECT pc.id FROM petty_cashes pc WHERE pc.bank_account_id = ba.id AND pc.status_deleted = 0 LIMIT 1) AS linked_petty_cash_id,
        (SELECT pc.name FROM petty_cashes pc WHERE pc.bank_account_id = ba.id AND pc.status_deleted = 0 LIMIT 1) AS linked_petty_cash_name,
        COALESCE((SELECT pc.lock_bank_account FROM petty_cashes pc WHERE pc.bank_account_id = ba.id AND pc.status_deleted = 0 LIMIT 1), 0) AS linked_petty_cash_lock_bank,
        ${BALANCE_SQL}
      FROM bank_accounts ba
      LEFT JOIN branches b ON ba.branch_id = b.id
      WHERE ${ACCESSIBLE_ACCOUNT_CLAUSE('ba')} AND ba.is_active = 1
    `;
    const params = [branchId, branchId];

    if (type) {
      if (type === 'operational') {
        sql += " AND (ba.type = 'operational' OR ba.type = 'both')";
      } else if (type === 'income') {
        sql += " AND (ba.type = 'income' OR ba.type = 'both')";
      } else {
        sql += ' AND ba.type = ?';
        params.push(type);
      }
    }

    sql += ' ORDER BY ba.name ASC';
    const rows = await query(sql, params);
    return await this._attachSharedBranches(rows);
  }

  static async findByGroup(branchIds = [], type = null) {
    await ensureInitialBalanceColumns();
    await ensurePettyCashLockColumn();

    const validIds = Array.from(
      new Set((Array.isArray(branchIds) ? branchIds : []).map((id) => parseInt(id, 10)).filter((id) => Number.isFinite(id) && id > 0))
    );
    if (validIds.length === 0) return [];

    const placeholders = validIds.map(() => '?').join(',');
    let sql = `
      SELECT 
        ba.id,
        ba.name,
        ba.account_number,
        ba.branch_id,
        b.name as branch_name,
        b.code as branch_code,
        b.group_name as branch_group_name,
        ba.type,
        COALESCE(ba.account_category, 'real') AS account_category,
        CAST(COALESCE(ba.initial_balance, 0) AS DECIMAL(15, 2)) AS initial_balance,
        DATE_FORMAT(ba.initial_balance_date, '%Y-%m-%d') AS initial_balance_date,
        ba.initial_balance_note,
        ba.is_active,
        ba.created_at,
        ba.updated_at,
        (SELECT pc.id FROM petty_cashes pc WHERE pc.bank_account_id = ba.id AND pc.status_deleted = 0 LIMIT 1) AS linked_petty_cash_id,
        (SELECT pc.name FROM petty_cashes pc WHERE pc.bank_account_id = ba.id AND pc.status_deleted = 0 LIMIT 1) AS linked_petty_cash_name,
        COALESCE((SELECT pc.lock_bank_account FROM petty_cashes pc WHERE pc.bank_account_id = ba.id AND pc.status_deleted = 0 LIMIT 1), 0) AS linked_petty_cash_lock_bank,
        ${BALANCE_SQL}
      FROM bank_accounts ba
      LEFT JOIN branches b ON ba.branch_id = b.id
      WHERE ba.is_active = 1
        AND (
          ba.branch_id IN (${placeholders})
          OR EXISTS (
            SELECT 1 FROM bank_account_branches bab
            WHERE bab.bank_account_id = ba.id AND bab.branch_id IN (${placeholders})
          )
        )
    `;
    const params = [...validIds, ...validIds];

    if (type) {
      if (type === 'operational') {
        sql += " AND (ba.type = 'operational' OR ba.type = 'both')";
      } else if (type === 'income') {
        sql += " AND (ba.type = 'income' OR ba.type = 'both')";
      } else {
        sql += ' AND ba.type = ?';
        params.push(type);
      }
    }

    sql += ' ORDER BY ba.name ASC, ba.id ASC';
    const rows = await query(sql, params);
    return await this._attachSharedBranches(rows);
  }

  static async findById(id) {
    await ensureInitialBalanceColumns();
    await ensurePettyCashLockColumn();

    const results = await query(
      `SELECT 
        ba.id,
        ba.name,
        ba.account_number,
        ba.branch_id,
        b.name as branch_name,
        b.code as branch_code,
        b.group_name as branch_group_name,
        ba.type,
        COALESCE(ba.account_category, 'real') AS account_category,
        CAST(COALESCE(ba.initial_balance, 0) AS DECIMAL(15, 2)) AS initial_balance,
        DATE_FORMAT(ba.initial_balance_date, '%Y-%m-%d') AS initial_balance_date,
        ba.initial_balance_note,
        ba.is_active,
        ba.created_at,
        ba.updated_at,
        (SELECT pc.id FROM petty_cashes pc WHERE pc.bank_account_id = ba.id AND pc.status_deleted = 0 LIMIT 1) AS linked_petty_cash_id,
        (SELECT pc.name FROM petty_cashes pc WHERE pc.bank_account_id = ba.id AND pc.status_deleted = 0 LIMIT 1) AS linked_petty_cash_name,
        COALESCE((SELECT pc.lock_bank_account FROM petty_cashes pc WHERE pc.bank_account_id = ba.id AND pc.status_deleted = 0 LIMIT 1), 0) AS linked_petty_cash_lock_bank,
        ${BALANCE_SQL}
      FROM bank_accounts ba
      LEFT JOIN branches b ON ba.branch_id = b.id
      WHERE ba.id = ?`,
      [id]
    );
    if (!results[0]) return null;
    const enriched = await this._attachSharedBranches(results);
    return enriched[0] || null;
  }

  static async create({
    name,
    accountNumber = null,
    branchId,
    type = 'savings',
    accountCategory = 'real',
    initialBalance = 0,
    initialBalanceDate = null,
    initialBalanceNote = null,
    sharedBranchIds = null
  }) {
    await ensureInitialBalanceColumns();

    const validTypes = ['savings', 'operational', 'income', 'both'];
    const selectedType = validTypes.includes(type) ? type : 'savings';
    const validCategories = ['real', 'penampung'];
    const selectedCategory = validCategories.includes(accountCategory) ? accountCategory : 'real';
    const isSavings = selectedType === 'savings';

    const parsedInitialBalance = isSavings ? 0 : (Number.isFinite(Number(initialBalance)) ? Number(initialBalance) : 0);
    const parsedInitialDate = isSavings ? null : normalizeDateOnly(initialBalanceDate);
    const parsedInitialNote = isSavings
      ? null
      : (initialBalanceNote && String(initialBalanceNote).trim() ? String(initialBalanceNote).trim() : null);

    const result = await query(
      `INSERT INTO bank_accounts (name, account_number, branch_id, type, account_category, initial_balance, initial_balance_date, initial_balance_note)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [name, accountNumber, branchId, selectedType, selectedCategory, parsedInitialBalance, parsedInitialDate, parsedInitialNote]
    );
    await this._syncSharedBranches(result.insertId, branchId, selectedType, sharedBranchIds);
    return await this.findById(result.insertId);
  }

  static async update(
    id,
    { name, accountNumber, type, accountCategory, initialBalance, initialBalanceDate, initialBalanceNote, linkedPettyCashId, linkedPettyCashLockBank, sharedBranchIds }
  ) {
    await ensureInitialBalanceColumns();
    await ensurePettyCashLockColumn();

    const existing = await this.findById(id);
    if (!existing) return null;

    const validTypes = ['savings', 'operational', 'income', 'both'];
    const validCategories = ['real', 'penampung'];
    const effectiveType = type !== undefined && validTypes.includes(type) ? type : existing.type;
    const isSavings = effectiveType === 'savings';

    const updates = [];
    const params = [];

    if (name !== undefined) {
      updates.push('name = ?');
      params.push(name);
    }

    if (accountNumber !== undefined) {
      updates.push('account_number = ?');
      params.push(accountNumber);
    }

    if (type !== undefined && validTypes.includes(type)) {
      updates.push('type = ?');
      params.push(type);
    }

    if (accountCategory !== undefined && validCategories.includes(accountCategory)) {
      updates.push('account_category = ?');
      params.push(accountCategory);
    }

    if (isSavings) {
      if (
        type === 'savings' ||
        initialBalance !== undefined ||
        initialBalanceDate !== undefined ||
        initialBalanceNote !== undefined
      ) {
        updates.push('initial_balance = ?', 'initial_balance_date = ?', 'initial_balance_note = ?');
        params.push(0, null, null);
      }
      // Savings account cannot remain linked to Kas Kecil
      await query(
        `UPDATE petty_cashes SET bank_account_id = NULL, lock_bank_account = 0 WHERE bank_account_id = ? AND status_deleted = 0`,
        [id]
      );
    } else {
      if (initialBalance !== undefined) {
        const num = Number(initialBalance);
        updates.push('initial_balance = ?');
        params.push(Number.isFinite(num) ? num : 0);
      }

      if (initialBalanceDate !== undefined) {
        updates.push('initial_balance_date = ?');
        params.push(normalizeDateOnly(initialBalanceDate));
      }

      if (initialBalanceNote !== undefined) {
        const cleanNote =
          initialBalanceNote && String(initialBalanceNote).trim()
            ? String(initialBalanceNote).trim()
            : null;
        updates.push('initial_balance_note = ?');
        params.push(cleanNote);
      }
    }

    if (updates.length > 0) {
      params.push(id);
      await query(
        `UPDATE bank_accounts SET ${updates.join(', ')} WHERE id = ?`,
        params
      );
    }

    // Handle linked Kas Kecil association & initial balance sync
    if (!isSavings && linkedPettyCashId !== undefined) {
      if (linkedPettyCashId === null || linkedPettyCashId === '') {
        await query(
          `UPDATE petty_cashes SET bank_account_id = NULL, lock_bank_account = 0 WHERE bank_account_id = ? AND status_deleted = 0`,
          [id]
        );
      } else {
        const targetPcId = parseInt(linkedPettyCashId, 10);
        const pcRows = await query(
          `SELECT id, initial_balance FROM petty_cashes WHERE id = ? AND branch_id = ? AND status_deleted = 0`,
          [targetPcId, existing.branch_id]
        );
        if (!pcRows || pcRows.length === 0) {
          throw new Error('Kantong Kas Kecil tidak ditemukan di buku kas ini');
        }
        // Clear any prior pocket linked to this bank account
        await query(
          `UPDATE petty_cashes SET bank_account_id = NULL, lock_bank_account = 0 WHERE bank_account_id = ? AND id != ? AND status_deleted = 0`,
          [id, targetPcId]
        );
        if (linkedPettyCashLockBank !== undefined) {
          const nextLock = normalizeLockBankFlag(linkedPettyCashLockBank, id);
          await query(
            `UPDATE petty_cashes SET bank_account_id = ?, lock_bank_account = ? WHERE id = ? AND branch_id = ?`,
            [id, nextLock, targetPcId, existing.branch_id]
          );
        } else {
          await query(
            `UPDATE petty_cashes SET bank_account_id = ? WHERE id = ? AND branch_id = ?`,
            [id, targetPcId, existing.branch_id]
          );
        }

        const [refreshedBa] = await query(`SELECT initial_balance FROM bank_accounts WHERE id = ?`, [id]);
        const currentBaInitial = Number(refreshedBa?.initial_balance || 0);
        const currentPcInitial = Number(pcRows[0].initial_balance || 0);
        if (initialBalance !== undefined && Number(initialBalance) > 0) {
          await query(`UPDATE petty_cashes SET initial_balance = ? WHERE id = ?`, [Number(initialBalance), targetPcId]);
        } else if (currentBaInitial === 0 && currentPcInitial > 0) {
          await query(`UPDATE bank_accounts SET initial_balance = ? WHERE id = ?`, [currentPcInitial, id]);
        } else if (currentBaInitial > 0 && currentPcInitial === 0) {
          await query(`UPDATE petty_cashes SET initial_balance = ? WHERE id = ?`, [currentBaInitial, targetPcId]);
        }
      }
    } else if (!isSavings) {
      if (linkedPettyCashLockBank !== undefined) {
        const nextLock = normalizeLockBankFlag(linkedPettyCashLockBank, id);
        await query(
          `UPDATE petty_cashes SET lock_bank_account = ? WHERE bank_account_id = ? AND status_deleted = 0`,
          [nextLock, id]
        );
      }
      if (initialBalance !== undefined) {
        // Keep already linked pocket's initial_balance in sync when user edits Rekening initial balance
        const num = Number(initialBalance);
        await query(
          `UPDATE petty_cashes SET initial_balance = ? WHERE bank_account_id = ? AND status_deleted = 0`,
          [Number.isFinite(num) ? num : 0, id]
        );
      }
    }

    if (sharedBranchIds !== undefined) {
      await this._syncSharedBranches(id, existing.branch_id, effectiveType, sharedBranchIds);
    }

    return await this.findById(id);
  }

  static async delete(id) {
    await query('DELETE FROM bank_account_branches WHERE bank_account_id = ?', [id]);
    return await query('DELETE FROM bank_accounts WHERE id = ?', [id]);
  }

  static async getStatement(id, { startDate = null, endDate = null, type = 'all', search = '', branchId = null, page = 1, limit = 50 } = {}) {
    const account = await this.findById(id);
    if (!account) return null;

    const filterBranchId = branchId ? parseInt(branchId, 10) : null;
    const validFilterBranchId = Number.isFinite(filterBranchId) && filterBranchId > 0 ? filterBranchId : null;

    const isSavings = account.type === 'savings';
    const initialBalance = isSavings ? 0 : Number(account.initial_balance || 0);
    const cutoffDate = !isSavings && account.initial_balance_date ? account.initial_balance_date : null;
    const initialBalanceNote = !isSavings ? (account.initial_balance_note || null) : null;

    // 1. Direct Income Summary (respects cut-off date when set)
    const directIncomeSql = `
      SELECT 
        COALESCE(SUM(
          CASE 
            WHEN (t.is_debt_payment = 1 OR t.is_debt_payment = true) THEN COALESCE(t.paid_amount, 0)
            ELSE t.amount 
          END
        ), 0) as total,
        COUNT(t.id) as count
      FROM transactions t
      WHERE t.bank_account_id = ?
        AND t.type = 'income'
        AND t.status_deleted = false
        AND (t.is_draft = false OR t.is_draft IS NULL)
        ${cutoffDate ? 'AND DATE(t.transaction_date) >= ?' : ''}
        ${validFilterBranchId ? 'AND t.branch_id = ?' : ''}
    `;
    const directIncomeParams = [id];
    if (cutoffDate) directIncomeParams.push(cutoffDate);
    if (validFilterBranchId) directIncomeParams.push(validFilterBranchId);
    const [directIncome] = await query(directIncomeSql, directIncomeParams);

    // 2. Income Details Summary (Omzet kasir / apps — respects cut-off date when set)
    const incomeDetailsSql = `
      SELECT 
        COALESCE(SUM(CASE WHEN tid.amount_cashier > 0 THEN tid.amount_cashier ELSE COALESCE(tid.amount_app, 0) END), 0) as total,
        COUNT(DISTINCT tid.transaction_id) as count
      FROM transaction_income_details tid
      JOIN transactions t ON tid.transaction_id = t.id
      WHERE tid.bank_account_id = ?
        AND t.status_deleted = false
        AND (t.is_draft = false OR t.is_draft IS NULL)
        ${cutoffDate ? 'AND DATE(t.transaction_date) >= ?' : ''}
        ${validFilterBranchId ? 'AND t.branch_id = ?' : ''}
    `;
    const incomeDetailsParams = [id];
    if (cutoffDate) incomeDetailsParams.push(cutoffDate);
    if (validFilterBranchId) incomeDetailsParams.push(validFilterBranchId);
    const [incomeDetails] = await query(incomeDetailsSql, incomeDetailsParams);

    // 3. Operational Expenses Summary (respects cut-off date when set)
    const expensesSql = `
      SELECT 
        COALESCE(SUM(t.amount), 0) as total,
        COUNT(t.id) as count
      FROM transactions t
      WHERE t.bank_account_id = ?
        AND t.type = 'expense'
        AND t.status_deleted = false
        AND (t.is_draft = false OR t.is_draft IS NULL)
        ${cutoffDate ? 'AND DATE(t.transaction_date) >= ?' : ''}
        ${validFilterBranchId ? 'AND t.branch_id = ?' : ''}
    `;
    const expensesParams = [id];
    if (cutoffDate) expensesParams.push(cutoffDate);
    if (validFilterBranchId) expensesParams.push(validFilterBranchId);

    const pettyCashExpensesSql = `
      SELECT
        COALESCE(SUM(pct.amount), 0) as total,
        COUNT(pct.id) as count
      FROM petty_cash_transactions pct
      JOIN petty_cashes pc ON pct.petty_cash_id = pc.id
      WHERE pct.bank_account_id = ?
        AND pct.type = 'expense'
        AND pct.status_deleted = 0
        AND pc.status_deleted = 0
        ${cutoffDate ? 'AND DATE(pct.transaction_date) >= ?' : ''}
        ${validFilterBranchId ? 'AND pct.branch_id = ?' : ''}
    `;
    const pettyCashExpParams = [id];
    if (cutoffDate) pettyCashExpParams.push(cutoffDate);
    if (validFilterBranchId) pettyCashExpParams.push(validFilterBranchId);

    const [[expenses], [pettyCashExpenses]] = await Promise.all([
      query(expensesSql, expensesParams),
      query(pettyCashExpensesSql, pettyCashExpParams)
    ]);

    // 4. Fund Transfers & Linked Petty Cash Top-Ups Incoming Summary (respects cut-off date when set)
    const transfersInSql = `
      SELECT 
        COALESCE(SUM(ft.amount), 0) as total,
        COUNT(ft.id) as count
      FROM fund_transfers ft
      WHERE ft.to_bank_account_id = ?
        AND ft.status_deleted = 0
        ${cutoffDate ? 'AND DATE(ft.transfer_date) >= ?' : ''}
        ${validFilterBranchId ? 'AND ft.branch_id = ?' : ''}
    `;
    const transfersInParams = [id];
    if (cutoffDate) transfersInParams.push(cutoffDate);
    if (validFilterBranchId) transfersInParams.push(validFilterBranchId);

    const pettyCashTopupsInSql = `
      SELECT
        COALESCE(SUM(pct.amount), 0) as total,
        COUNT(pct.id) as count
      FROM petty_cash_transactions pct
      JOIN petty_cashes pc ON pct.petty_cash_id = pc.id
      WHERE pc.bank_account_id = ?
        AND pct.type = 'topup'
        AND pct.status_deleted = 0
        AND pc.status_deleted = 0
        ${cutoffDate ? 'AND DATE(pct.transaction_date) >= ?' : ''}
        ${validFilterBranchId ? 'AND pct.branch_id = ?' : ''}
    `;
    const pettyCashTopupParams = [id];
    if (cutoffDate) pettyCashTopupParams.push(cutoffDate);
    if (validFilterBranchId) pettyCashTopupParams.push(validFilterBranchId);

    const [[transfersIn], [pettyCashTopupsIn]] = await Promise.all([
      query(transfersInSql, transfersInParams),
      query(pettyCashTopupsInSql, pettyCashTopupParams)
    ]);

    // 5. Fund Transfers Outgoing Summary (respects cut-off date when set)
    const transfersOutSql = `
      SELECT 
        COALESCE(SUM(ft.amount), 0) as total,
        COUNT(ft.id) as count
      FROM fund_transfers ft
      WHERE ft.from_bank_account_id = ?
        AND ft.status_deleted = 0
        ${cutoffDate ? 'AND DATE(ft.transfer_date) >= ?' : ''}
        ${validFilterBranchId ? 'AND ft.branch_id = ?' : ''}
    `;
    const transfersOutParams = [id];
    if (cutoffDate) transfersOutParams.push(cutoffDate);
    if (validFilterBranchId) transfersOutParams.push(validFilterBranchId);

    const pettyCashTopupsOutSql = `
      SELECT
        COALESCE(SUM(pct.amount), 0) as total,
        COUNT(pct.id) as count
      FROM petty_cash_transactions pct
      JOIN petty_cashes pc ON pct.petty_cash_id = pc.id
      WHERE pct.bank_account_id = ?
        AND pct.type = 'topup'
        AND pct.status_deleted = 0
        AND pc.status_deleted = 0
        ${cutoffDate ? 'AND DATE(pct.transaction_date) >= ?' : ''}
        ${validFilterBranchId ? 'AND pct.branch_id = ?' : ''}
    `;
    const pettyCashTopupOutParams = [id];
    if (cutoffDate) pettyCashTopupOutParams.push(cutoffDate);
    if (validFilterBranchId) pettyCashTopupOutParams.push(validFilterBranchId);

    const [[transfersOut], [pettyCashTopupsOut]] = await Promise.all([
      query(transfersOutSql, transfersOutParams),
      query(pettyCashTopupsOutSql, pettyCashTopupOutParams)
    ]);

    // 6. Savings Allocations (if savings — supports shared accounts across branches in group)
    const allocationsSql = `
      SELECT 
        saa.id,
        saa.category_id,
        c.name as category_name,
        c.branch_id,
        br.name as branch_name,
        saa.allocated_amount
      FROM savings_account_allocations saa
      JOIN categories c ON saa.category_id = c.id
      LEFT JOIN branches br ON c.branch_id = br.id
      WHERE saa.bank_account_id = ?
        AND c.status_deleted = false
        AND (
          c.branch_id = ?
          OR EXISTS (
            SELECT 1 FROM bank_account_branches bab
            WHERE bab.bank_account_id = saa.bank_account_id AND bab.branch_id = c.branch_id
          )
        )
        ${validFilterBranchId ? 'AND c.branch_id = ?' : ''}
      ORDER BY br.name ASC, c.name ASC
    `;
    const allocationsParams = validFilterBranchId
      ? [id, account.branch_id, validFilterBranchId]
      : [id, account.branch_id];
    const allocations = await query(allocationsSql, allocationsParams);

    const totalAllocations = allocations.reduce((sum, a) => sum + Number(a.allocated_amount || 0), 0);
    const totalIncome = Number(directIncome.total) + Number(incomeDetails.total);
    const totalExpense = Number(expenses.total) + Number(pettyCashExpenses.total);
    const totalExpenseCount = Number(expenses.count || 0) + Number(pettyCashExpenses.count || 0);
    const totalTransferIn = Number(transfersIn.total) + Number(pettyCashTopupsIn.total);
    const totalTransferInCount = Number(transfersIn.count || 0) + Number(pettyCashTopupsIn.count || 0);
    const totalTransferOut = Number(transfersOut.total) + Number(pettyCashTopupsOut.total);
    const totalTransferOutCount = Number(transfersOut.count || 0) + Number(pettyCashTopupsOut.count || 0);
    const effectiveInitialBalance =
      !validFilterBranchId || validFilterBranchId === Number(account.branch_id) ? initialBalance : 0;
    const calculatedBalance = isSavings
      ? totalAllocations
      : effectiveInitialBalance + (totalIncome + totalTransferIn) - (totalExpense + totalTransferOut);

    // 7. Fetch all 3 mutation streams safely (historical records preserved, flagged if before cut-off)
    let txQuery = `
      SELECT 
        CONCAT('tx_', t.id) as unique_id,
        t.id as reference_id,
        'transaction' as source_type,
        t.type as mutation_type,
        CASE 
          WHEN (t.is_debt_payment = 1 OR t.is_debt_payment = true) THEN COALESCE(t.paid_amount, 0)
          ELSE t.amount 
        END as amount,
        DATE_FORMAT(t.transaction_date, '%Y-%m-%d') as date,
        t.created_at,
        c.name as category_name,
        t.note as description,
        COALESCE(u.name, u.email) as user_name,
        t.lampiran,
        NULL as from_account_name,
        NULL as to_account_name,
        t.branch_id,
        br.name as branch_name
      FROM transactions t
      LEFT JOIN categories c ON t.category_id = c.id
      LEFT JOIN users u ON t.user_id = u.id
      LEFT JOIN branches br ON t.branch_id = br.id
      WHERE t.bank_account_id = ?
        AND t.status_deleted = false
        AND (t.is_draft = false OR t.is_draft IS NULL)
    `;
    const txParams = [id];
    if (validFilterBranchId) {
      txQuery += ' AND t.branch_id = ?';
      txParams.push(validFilterBranchId);
    }
    if (startDate) {
      txQuery += ' AND DATE(t.transaction_date) >= ?';
      txParams.push(startDate);
    }
    if (endDate) {
      txQuery += ' AND DATE(t.transaction_date) <= ?';
      txParams.push(endDate);
    }

    let tidQuery = `
      SELECT 
        CONCAT('tid_', tid.id) as unique_id,
        t.id as reference_id,
        'income_detail' as source_type,
        'income' as mutation_type,
        CASE WHEN tid.amount_cashier > 0 THEN tid.amount_cashier ELSE COALESCE(tid.amount_app, 0) END as amount,
        DATE_FORMAT(t.transaction_date, '%Y-%m-%d') as date,
        t.created_at,
        CONCAT(COALESCE(pm.name, 'Omzet'), ' (', COALESCE(c.name, 'Pemasukan'), ')') as category_name,
        t.note as description,
        COALESCE(u.name, u.email) as user_name,
        t.lampiran,
        NULL as from_account_name,
        NULL as to_account_name,
        t.branch_id,
        br.name as branch_name
      FROM transaction_income_details tid
      JOIN transactions t ON tid.transaction_id = t.id
      LEFT JOIN categories c ON t.category_id = c.id
      LEFT JOIN payment_methods pm ON tid.payment_method_id = pm.id
      LEFT JOIN users u ON t.user_id = u.id
      LEFT JOIN branches br ON t.branch_id = br.id
      WHERE tid.bank_account_id = ?
        AND t.status_deleted = false
        AND (t.is_draft = false OR t.is_draft IS NULL)
    `;
    const tidParams = [id];
    if (validFilterBranchId) {
      tidQuery += ' AND t.branch_id = ?';
      tidParams.push(validFilterBranchId);
    }
    if (startDate) {
      tidQuery += ' AND DATE(t.transaction_date) >= ?';
      tidParams.push(startDate);
    }
    if (endDate) {
      tidQuery += ' AND DATE(t.transaction_date) <= ?';
      tidParams.push(endDate);
    }

    let ftQuery = `
      SELECT 
        CONCAT(CASE WHEN ft.to_bank_account_id = ? THEN 'ft_in_' ELSE 'ft_out_' END, ft.id) as unique_id,
        ft.id as reference_id,
        'fund_transfer' as source_type,
        CASE WHEN ft.to_bank_account_id = ? THEN 'transfer_in' ELSE 'transfer_out' END as mutation_type,
        ft.amount as amount,
        DATE_FORMAT(ft.transfer_date, '%Y-%m-%d') as date,
        ft.created_at,
        CASE WHEN ft.to_bank_account_id = ? THEN CONCAT('Transfer dari ', from_ba.name) ELSE CONCAT('Transfer ke ', to_ba.name) END as category_name,
        ft.note as description,
        COALESCE(u.name, u.email) as user_name,
        ft.lampiran,
        from_ba.name as from_account_name,
        to_ba.name as to_account_name,
        ft.branch_id,
        br.name as branch_name
      FROM fund_transfers ft
      JOIN bank_accounts from_ba ON ft.from_bank_account_id = from_ba.id
      JOIN bank_accounts to_ba ON ft.to_bank_account_id = to_ba.id
      LEFT JOIN users u ON ft.user_id = u.id
      LEFT JOIN branches br ON ft.branch_id = br.id
      WHERE (ft.to_bank_account_id = ? OR ft.from_bank_account_id = ?)
        AND ft.status_deleted = 0
    `;
    const ftParams = [id, id, id, id, id];
    if (validFilterBranchId) {
      ftQuery += ' AND ft.branch_id = ?';
      ftParams.push(validFilterBranchId);
    }
    if (startDate) {
      ftQuery += ' AND DATE(ft.transfer_date) >= ?';
      ftParams.push(startDate);
    }
    if (endDate) {
      ftQuery += ' AND DATE(ft.transfer_date) <= ?';
      ftParams.push(endDate);
    }

    let pctQuery = `
      SELECT
        CONCAT('pct_', pct.id) as unique_id,
        pct.petty_cash_id as reference_id,
        'petty_cash' as source_type,
        'expense' as mutation_type,
        pct.amount as amount,
        DATE_FORMAT(pct.transaction_date, '%Y-%m-%d') as date,
        pct.created_at,
        CONCAT('Kas Kecil: ', COALESCE(pc.name, '-')) as category_name,
        pct.description as description,
        COALESCE(u.name, u.email) as user_name,
        pct.lampiran,
        NULL as from_account_name,
        NULL as to_account_name,
        pct.branch_id,
        br.name as branch_name
      FROM petty_cash_transactions pct
      JOIN petty_cashes pc ON pct.petty_cash_id = pc.id
      LEFT JOIN users u ON pct.created_by = u.id
      LEFT JOIN branches br ON pct.branch_id = br.id
      WHERE pct.bank_account_id = ?
        AND pct.type = 'expense'
        AND pct.status_deleted = 0
        AND pc.status_deleted = 0
    `;
    const pctParams = [id];
    if (validFilterBranchId) {
      pctQuery += ' AND pct.branch_id = ?';
      pctParams.push(validFilterBranchId);
    }
    if (startDate) {
      pctQuery += ' AND DATE(pct.transaction_date) >= ?';
      pctParams.push(startDate);
    }
    if (endDate) {
      pctQuery += ' AND DATE(pct.transaction_date) <= ?';
      pctParams.push(endDate);
    }

    let pctTopupQuery = `
      SELECT
        CONCAT('pct_in_', pct.id) as unique_id,
        pct.petty_cash_id as reference_id,
        'petty_cash' as source_type,
        'transfer_in' as mutation_type,
        pct.amount as amount,
        DATE_FORMAT(pct.transaction_date, '%Y-%m-%d') as date,
        pct.created_at,
        CONCAT('Top-Up Kas Kecil: ', COALESCE(pc.name, '-')) as category_name,
        COALESCE(pct.description, t.note) as description,
        COALESCE(u.name, u.email) as user_name,
        COALESCE(pct.lampiran, t.lampiran) as lampiran,
        src_ba.name as from_account_name,
        ba.name as to_account_name,
        pct.branch_id,
        br.name as branch_name
      FROM petty_cash_transactions pct
      JOIN petty_cashes pc ON pct.petty_cash_id = pc.id
      JOIN bank_accounts ba ON pc.bank_account_id = ba.id
      LEFT JOIN transactions t ON pct.source_transaction_id = t.id
      LEFT JOIN bank_accounts src_ba ON COALESCE(pct.bank_account_id, t.bank_account_id) = src_ba.id
      LEFT JOIN users u ON pct.created_by = u.id
      LEFT JOIN branches br ON pct.branch_id = br.id
      WHERE pc.bank_account_id = ?
        AND pct.type = 'topup'
        AND pct.status_deleted = 0
        AND pc.status_deleted = 0
    `;
    const pctTopupParams = [id];
    if (validFilterBranchId) {
      pctTopupQuery += ' AND pct.branch_id = ?';
      pctTopupParams.push(validFilterBranchId);
    }
    if (startDate) {
      pctTopupQuery += ' AND DATE(pct.transaction_date) >= ?';
      pctTopupParams.push(startDate);
    }
    if (endDate) {
      pctTopupQuery += ' AND DATE(pct.transaction_date) <= ?';
      pctTopupParams.push(endDate);
    }

    let pctTopupOutQuery = `
      SELECT
        CONCAT('pct_out_', pct.id) as unique_id,
        pct.petty_cash_id as reference_id,
        'petty_cash' as source_type,
        'transfer_out' as mutation_type,
        pct.amount as amount,
        DATE_FORMAT(pct.transaction_date, '%Y-%m-%d') as date,
        pct.created_at,
        CONCAT('Transfer ke Kas Kecil: ', COALESCE(pc.name, '-')) as category_name,
        COALESCE(pct.description, t.note) as description,
        COALESCE(u.name, u.email) as user_name,
        COALESCE(pct.lampiran, t.lampiran) as lampiran,
        ba.name as from_account_name,
        COALESCE(dst_ba.name, pc.name) as to_account_name,
        pct.branch_id,
        br.name as branch_name
      FROM petty_cash_transactions pct
      JOIN petty_cashes pc ON pct.petty_cash_id = pc.id
      JOIN bank_accounts ba ON pct.bank_account_id = ba.id
      LEFT JOIN bank_accounts dst_ba ON pc.bank_account_id = dst_ba.id
      LEFT JOIN transactions t ON pct.source_transaction_id = t.id
      LEFT JOIN users u ON pct.created_by = u.id
      LEFT JOIN branches br ON pct.branch_id = br.id
      WHERE pct.bank_account_id = ?
        AND pct.type = 'topup'
        AND pct.status_deleted = 0
        AND pc.status_deleted = 0
    `;
    const pctTopupOutParams = [id];
    if (validFilterBranchId) {
      pctTopupOutQuery += ' AND pct.branch_id = ?';
      pctTopupOutParams.push(validFilterBranchId);
    }
    if (startDate) {
      pctTopupOutQuery += ' AND DATE(pct.transaction_date) >= ?';
      pctTopupOutParams.push(startDate);
    }
    if (endDate) {
      pctTopupOutQuery += ' AND DATE(pct.transaction_date) <= ?';
      pctTopupOutParams.push(endDate);
    }

    // Per-branch net contribution breakdown (useful for shared accounts, including savings)
    let branchBreakdown = [];
    if (account.is_shared && Array.isArray(account.shared_branches) && account.shared_branches.length > 1) {
      const [bIncDir, bIncDet, bExp, bPcExp, bFtIn, bPcTopupIn, bFtOut, bPcTopupOut, bSavingsAlloc] = await Promise.all([
        query(
          `SELECT t.branch_id, COALESCE(SUM(CASE WHEN (t.is_debt_payment = 1 OR t.is_debt_payment = true) THEN COALESCE(t.paid_amount, 0) ELSE t.amount END), 0) as total
           FROM transactions t
           WHERE t.bank_account_id = ? AND t.type = 'income' AND t.status_deleted = false AND (t.is_draft = false OR t.is_draft IS NULL)
           ${cutoffDate ? 'AND DATE(t.transaction_date) >= ?' : ''}
           GROUP BY t.branch_id`,
          cutoffDate ? [id, cutoffDate] : [id]
        ),
        query(
          `SELECT t.branch_id, COALESCE(SUM(CASE WHEN tid.amount_cashier > 0 THEN tid.amount_cashier ELSE COALESCE(tid.amount_app, 0) END), 0) as total
           FROM transaction_income_details tid
           JOIN transactions t ON tid.transaction_id = t.id
           WHERE tid.bank_account_id = ? AND t.status_deleted = false AND (t.is_draft = false OR t.is_draft IS NULL)
           ${cutoffDate ? 'AND DATE(t.transaction_date) >= ?' : ''}
           GROUP BY t.branch_id`,
          cutoffDate ? [id, cutoffDate] : [id]
        ),
        query(
          `SELECT t.branch_id, COALESCE(SUM(t.amount), 0) as total
           FROM transactions t
           WHERE t.bank_account_id = ? AND t.type = 'expense' AND t.status_deleted = false AND (t.is_draft = false OR t.is_draft IS NULL)
           ${cutoffDate ? 'AND DATE(t.transaction_date) >= ?' : ''}
           GROUP BY t.branch_id`,
          cutoffDate ? [id, cutoffDate] : [id]
        ),
        query(
          `SELECT pct.branch_id, COALESCE(SUM(pct.amount), 0) as total
           FROM petty_cash_transactions pct
           JOIN petty_cashes pc ON pct.petty_cash_id = pc.id
           WHERE pct.bank_account_id = ? AND pct.type = 'expense' AND pct.status_deleted = 0 AND pc.status_deleted = 0
           ${cutoffDate ? 'AND DATE(pct.transaction_date) >= ?' : ''}
           GROUP BY pct.branch_id`,
          cutoffDate ? [id, cutoffDate] : [id]
        ),
        query(
          `SELECT ft.branch_id, COALESCE(SUM(ft.amount), 0) as total
           FROM fund_transfers ft
           WHERE ft.to_bank_account_id = ? AND ft.status_deleted = 0
           ${cutoffDate ? 'AND DATE(ft.transfer_date) >= ?' : ''}
           GROUP BY ft.branch_id`,
          cutoffDate ? [id, cutoffDate] : [id]
        ),
        query(
          `SELECT pct.branch_id, COALESCE(SUM(pct.amount), 0) as total
           FROM petty_cash_transactions pct
           JOIN petty_cashes pc ON pct.petty_cash_id = pc.id
           WHERE pc.bank_account_id = ? AND pct.type = 'topup' AND pct.status_deleted = 0 AND pc.status_deleted = 0
           ${cutoffDate ? 'AND DATE(pct.transaction_date) >= ?' : ''}
           GROUP BY pct.branch_id`,
          cutoffDate ? [id, cutoffDate] : [id]
        ),
        query(
          `SELECT ft.branch_id, COALESCE(SUM(ft.amount), 0) as total
           FROM fund_transfers ft
           WHERE ft.from_bank_account_id = ? AND ft.status_deleted = 0
           ${cutoffDate ? 'AND DATE(ft.transfer_date) >= ?' : ''}
           GROUP BY ft.branch_id`,
          cutoffDate ? [id, cutoffDate] : [id]
        ),
        query(
          `SELECT pct.branch_id, COALESCE(SUM(pct.amount), 0) as total
           FROM petty_cash_transactions pct
           JOIN petty_cashes pc ON pct.petty_cash_id = pc.id
           WHERE pct.bank_account_id = ? AND pct.type = 'topup' AND pct.status_deleted = 0 AND pc.status_deleted = 0
           ${cutoffDate ? 'AND DATE(pct.transaction_date) >= ?' : ''}
           GROUP BY pct.branch_id`,
          cutoffDate ? [id, cutoffDate] : [id]
        ),
        isSavings
          ? query(
              `SELECT c.branch_id, COALESCE(SUM(saa.allocated_amount), 0) as total, COUNT(DISTINCT CASE WHEN saa.allocated_amount != 0 THEN saa.category_id END) as alloc_count
               FROM savings_account_allocations saa
               JOIN categories c ON saa.category_id = c.id
               WHERE saa.bank_account_id = ?
                 AND c.status_deleted = false
                 AND (
                   c.branch_id = ?
                   OR EXISTS (
                     SELECT 1 FROM bank_account_branches bab
                     WHERE bab.bank_account_id = saa.bank_account_id AND bab.branch_id = c.branch_id
                   )
                 )
               GROUP BY c.branch_id`,
              [id, account.branch_id]
            )
          : Promise.resolve([])
      ]);

      const toMap = (rows) => new Map(rows.map((r) => [Number(r.branch_id), Number(r.total || 0)]));
      const mIncDir = toMap(bIncDir);
      const mIncDet = toMap(bIncDet);
      const mExp = toMap(bExp);
      const mPcExp = toMap(bPcExp);
      const mFtIn = toMap(bFtIn);
      const mPcTopupIn = toMap(bPcTopupIn);
      const mFtOut = toMap(bFtOut);
      const mPcTopupOut = toMap(bPcTopupOut);
      const mSavingsAlloc = toMap(bSavingsAlloc);
      const mSavingsCount = new Map(bSavingsAlloc.map((r) => [Number(r.branch_id), Number(r.alloc_count || 0)]));

      branchBreakdown = account.shared_branches.map((sb) => {
        const bId = Number(sb.id);
        const inc = (mIncDir.get(bId) || 0) + (mIncDet.get(bId) || 0);
        const exp = (mExp.get(bId) || 0) + (mPcExp.get(bId) || 0);
        const trIn = (mFtIn.get(bId) || 0) + (mPcTopupIn.get(bId) || 0);
        const trOut = (mFtOut.get(bId) || 0) + (mPcTopupOut.get(bId) || 0);
        const initPortion = bId === Number(account.branch_id) ? initialBalance : 0;
        const allocPortion = mSavingsAlloc.get(bId) || 0;
        return {
          branch_id: bId,
          branch_name: sb.name,
          branch_code: sb.code || null,
          total_income: inc,
          total_expense: exp,
          total_transfer_in: trIn,
          total_transfer_out: trOut,
          total_allocations: allocPortion,
          allocation_count: mSavingsCount.get(bId) || 0,
          net_balance: isSavings ? allocPortion : (initPortion + inc + trIn - exp - trOut)
        };
      });
    }

    const [txResults, tidResults, ftResults, pctResults, pctTopupResults, pctTopupOutResults] = await Promise.all([
      query(txQuery, txParams),
      query(tidQuery, tidParams),
      query(ftQuery, ftParams),
      query(pctQuery, pctParams),
      query(pctTopupQuery, pctTopupParams),
      query(pctTopupOutQuery, pctTopupOutParams)
    ]);

    let allMutations = [...txResults, ...tidResults, ...ftResults, ...pctResults, ...pctTopupResults, ...pctTopupOutResults];

    // Filter by type
    if (type && type !== 'all') {
      if (type === 'transfer') {
        allMutations = allMutations.filter(m => m.mutation_type === 'transfer_in' || m.mutation_type === 'transfer_out');
      } else {
        allMutations = allMutations.filter(m => m.mutation_type === type);
      }
    }

    // Filter by search
    if (search && search.trim() !== '') {
      const q = search.trim().toLowerCase();
      allMutations = allMutations.filter(m => {
        const cat = (m.category_name || '').toLowerCase();
        const desc = (m.description || '').toLowerCase();
        const user = (m.user_name || '').toLowerCase();
        return cat.includes(q) || desc.includes(q) || user.includes(q);
      });
    }

    // Sort by date DESC, created_at DESC
    allMutations.sort((a, b) => {
      const dateA = new Date(a.date).getTime();
      const dateB = new Date(b.date).getTime();
      if (dateA !== dateB) return dateB - dateA;
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });

    const totalCount = allMutations.length;
    const validLimit = Math.max(1, parseInt(limit) || 50);
    const validPage = Math.max(1, parseInt(page) || 1);
    const offset = (validPage - 1) * validLimit;
    const paginatedMutations = allMutations.slice(offset, offset + validLimit);

    const extractAttachmentUrls = (raw) => {
      if (!raw) return [];
      if (Array.isArray(raw)) {
        return raw
          .map((item) => {
            if (typeof item === 'string') return item.trim();
            if (item && typeof item === 'object') {
              return String(item.url || item.path || item.filename || item.file_path || '').trim();
            }
            return '';
          })
          .filter(Boolean);
      }
      if (typeof raw === 'string') {
        const trimmed = raw.trim();
        if (!trimmed) return [];
        try {
          const parsed = JSON.parse(trimmed);
          return extractAttachmentUrls(parsed);
        } catch (e) {
          return [trimmed];
        }
      }
      if (typeof raw === 'object') {
        const u = String(raw.url || raw.path || raw.filename || raw.file_path || '').trim();
        return u ? [u] : [];
      }
      return [];
    };

    const formattedMutations = paginatedMutations.map(m => ({
      ...m,
      amount: Number(m.amount),
      lampiran: extractAttachmentUrls(m.lampiran),
      is_before_cutoff: Boolean(cutoffDate && m.date && m.date < cutoffDate)
    }));

    return {
      account,
      breakdown: {
        initial_balance: initialBalance,
        initial_balance_date: cutoffDate,
        initial_balance_note: initialBalanceNote,
        total_income_direct: Number(directIncome.total),
        direct_income_count: directIncome.count,
        total_income_details: Number(incomeDetails.total),
        income_details_count: incomeDetails.count,
        total_income: totalIncome,
        total_expense: totalExpense,
        expense_count: totalExpenseCount,
        total_transfer_in: totalTransferIn,
        transfer_in_count: totalTransferInCount,
        total_transfer_out: totalTransferOut,
        transfer_out_count: totalTransferOutCount,
        net_transfer: totalTransferIn - totalTransferOut,
        calculated_balance: calculatedBalance,
        current_balance: calculatedBalance,
        total_allocations: totalAllocations,
        allocations: allocations.map(a => ({
          ...a,
          allocated_amount: Number(a.allocated_amount)
        })),
        branch_breakdown: branchBreakdown
      },
      mutations: formattedMutations,
      pagination: {
        page: validPage,
        limit: validLimit,
        total: totalCount,
        total_pages: Math.ceil(totalCount / validLimit)
      }
    };
  }
}

module.exports = BankAccount;
