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
             AND c.branch_id = ba.branch_id),
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
            (SELECT SUM(COALESCE(tid.amount_cashier, tid.amount_app, 0))
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
        )
    END AS DECIMAL(15, 2)
  ) AS balance
`;

class BankAccount {
  static async findAll(branchId, type = null) {
    await ensureInitialBalanceColumns();
    await ensurePettyCashLockColumn();

    let sql = `
      SELECT 
        ba.id,
        ba.name,
        ba.account_number,
        ba.branch_id,
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
      WHERE ba.branch_id = ? AND ba.is_active = 1
    `;
    const params = [branchId];

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
    return rows.map((row) => ({
      ...row,
      linked_petty_cash_lock_bank: Boolean(row.linked_petty_cash_id && row.linked_petty_cash_lock_bank),
      initial_balance: Number(row.initial_balance || 0),
      balance: Number(row.balance || 0)
    }));
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
      WHERE ba.id = ?`,
      [id]
    );
    if (!results[0]) return null;
    return {
      ...results[0],
      linked_petty_cash_lock_bank: Boolean(results[0].linked_petty_cash_id && results[0].linked_petty_cash_lock_bank),
      initial_balance: Number(results[0].initial_balance || 0),
      balance: Number(results[0].balance || 0)
    };
  }

  static async create({
    name,
    accountNumber = null,
    branchId,
    type = 'savings',
    accountCategory = 'real',
    initialBalance = 0,
    initialBalanceDate = null,
    initialBalanceNote = null
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
    return await this.findById(result.insertId);
  }

  static async update(
    id,
    { name, accountNumber, type, accountCategory, initialBalance, initialBalanceDate, initialBalanceNote, linkedPettyCashId, linkedPettyCashLockBank }
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

    return await this.findById(id);
  }

  static async delete(id) {
    return await query('DELETE FROM bank_accounts WHERE id = ?', [id]);
  }

  static async getStatement(id, { startDate = null, endDate = null, type = 'all', search = '', page = 1, limit = 50 } = {}) {
    const account = await this.findById(id);
    if (!account) return null;

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
    `;
    const [directIncome] = await query(directIncomeSql, cutoffDate ? [id, cutoffDate] : [id]);

    // 2. Income Details Summary (Omzet kasir / apps — respects cut-off date when set)
    const incomeDetailsSql = `
      SELECT 
        COALESCE(SUM(COALESCE(tid.amount_cashier, tid.amount_app, 0)), 0) as total,
        COUNT(DISTINCT tid.transaction_id) as count
      FROM transaction_income_details tid
      JOIN transactions t ON tid.transaction_id = t.id
      WHERE tid.bank_account_id = ?
        AND t.status_deleted = false
        AND (t.is_draft = false OR t.is_draft IS NULL)
        ${cutoffDate ? 'AND DATE(t.transaction_date) >= ?' : ''}
    `;
    const [incomeDetails] = await query(incomeDetailsSql, cutoffDate ? [id, cutoffDate] : [id]);

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
    `;
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
    `;
    const [[expenses], [pettyCashExpenses]] = await Promise.all([
      query(expensesSql, cutoffDate ? [id, cutoffDate] : [id]),
      query(pettyCashExpensesSql, cutoffDate ? [id, cutoffDate] : [id])
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
    `;
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
    `;
    const [[transfersIn], [pettyCashTopupsIn]] = await Promise.all([
      query(transfersInSql, cutoffDate ? [id, cutoffDate] : [id]),
      query(pettyCashTopupsInSql, cutoffDate ? [id, cutoffDate] : [id])
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
    `;
    const [transfersOut] = await query(transfersOutSql, cutoffDate ? [id, cutoffDate] : [id]);

    // 6. Savings Allocations (if savings)
    const allocations = await query(`
      SELECT 
        saa.id,
        saa.category_id,
        c.name as category_name,
        saa.allocated_amount
      FROM savings_account_allocations saa
      JOIN categories c ON saa.category_id = c.id
      WHERE saa.bank_account_id = ?
        AND c.status_deleted = false
        AND c.branch_id = ?
    `, [id, account.branch_id]);

    const totalAllocations = allocations.reduce((sum, a) => sum + Number(a.allocated_amount || 0), 0);
    const totalIncome = Number(directIncome.total) + Number(incomeDetails.total);
    const totalExpense = Number(expenses.total) + Number(pettyCashExpenses.total);
    const totalExpenseCount = Number(expenses.count || 0) + Number(pettyCashExpenses.count || 0);
    const totalTransferIn = Number(transfersIn.total) + Number(pettyCashTopupsIn.total);
    const totalTransferInCount = Number(transfersIn.count || 0) + Number(pettyCashTopupsIn.count || 0);
    const totalTransferOut = Number(transfersOut.total);
    const calculatedBalance = isSavings
      ? totalAllocations
      : initialBalance + (totalIncome + totalTransferIn) - (totalExpense + totalTransferOut);

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
        NULL as to_account_name
      FROM transactions t
      LEFT JOIN categories c ON t.category_id = c.id
      LEFT JOIN users u ON t.user_id = u.id
      WHERE t.bank_account_id = ?
        AND t.status_deleted = false
        AND (t.is_draft = false OR t.is_draft IS NULL)
    `;
    const txParams = [id];
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
        COALESCE(tid.amount_cashier, tid.amount_app, 0) as amount,
        DATE_FORMAT(t.transaction_date, '%Y-%m-%d') as date,
        t.created_at,
        CONCAT(COALESCE(pm.name, 'Omzet'), ' (', COALESCE(c.name, 'Pemasukan'), ')') as category_name,
        t.note as description,
        COALESCE(u.name, u.email) as user_name,
        t.lampiran,
        NULL as from_account_name,
        NULL as to_account_name
      FROM transaction_income_details tid
      JOIN transactions t ON tid.transaction_id = t.id
      LEFT JOIN categories c ON t.category_id = c.id
      LEFT JOIN payment_methods pm ON tid.payment_method_id = pm.id
      LEFT JOIN users u ON t.user_id = u.id
      WHERE tid.bank_account_id = ?
        AND t.status_deleted = false
        AND (t.is_draft = false OR t.is_draft IS NULL)
    `;
    const tidParams = [id];
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
        to_ba.name as to_account_name
      FROM fund_transfers ft
      JOIN bank_accounts from_ba ON ft.from_bank_account_id = from_ba.id
      JOIN bank_accounts to_ba ON ft.to_bank_account_id = to_ba.id
      LEFT JOIN users u ON ft.user_id = u.id
      WHERE (ft.to_bank_account_id = ? OR ft.from_bank_account_id = ?)
        AND ft.status_deleted = 0
    `;
    const ftParams = [id, id, id, id, id];
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
        NULL as to_account_name
      FROM petty_cash_transactions pct
      JOIN petty_cashes pc ON pct.petty_cash_id = pc.id
      LEFT JOIN users u ON pct.created_by = u.id
      WHERE pct.bank_account_id = ?
        AND pct.type = 'expense'
        AND pct.status_deleted = 0
        AND pc.status_deleted = 0
    `;
    const pctParams = [id];
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
        ba.name as to_account_name
      FROM petty_cash_transactions pct
      JOIN petty_cashes pc ON pct.petty_cash_id = pc.id
      JOIN bank_accounts ba ON pc.bank_account_id = ba.id
      LEFT JOIN transactions t ON pct.source_transaction_id = t.id
      LEFT JOIN bank_accounts src_ba ON t.bank_account_id = src_ba.id
      LEFT JOIN users u ON pct.created_by = u.id
      WHERE pc.bank_account_id = ?
        AND pct.type = 'topup'
        AND pct.status_deleted = 0
        AND pc.status_deleted = 0
    `;
    const pctTopupParams = [id];
    if (startDate) {
      pctTopupQuery += ' AND DATE(pct.transaction_date) >= ?';
      pctTopupParams.push(startDate);
    }
    if (endDate) {
      pctTopupQuery += ' AND DATE(pct.transaction_date) <= ?';
      pctTopupParams.push(endDate);
    }

    const [txResults, tidResults, ftResults, pctResults, pctTopupResults] = await Promise.all([
      query(txQuery, txParams),
      query(tidQuery, tidParams),
      query(ftQuery, ftParams),
      query(pctQuery, pctParams),
      query(pctTopupQuery, pctTopupParams)
    ]);

    let allMutations = [...txResults, ...tidResults, ...ftResults, ...pctResults, ...pctTopupResults];

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
        transfer_out_count: transfersOut.count,
        net_transfer: totalTransferIn - totalTransferOut,
        calculated_balance: calculatedBalance,
        current_balance: calculatedBalance,
        total_allocations: totalAllocations,
        allocations: allocations.map(a => ({
          ...a,
          allocated_amount: Number(a.allocated_amount)
        }))
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
