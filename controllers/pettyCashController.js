const { query } = require('../config/database');
const Branch = require('../models/Branch');
const { ensurePettyCashLockColumn, normalizeLockBankFlag } = require('../utils/pettyCashHelper');

/**
 * Helper to resolve and authorize branchId from request.
 */
async function resolveAuthorizedBranch(req, res) {
  const rawBranchId = req.branchId || req.headers['x-branch-id'];
  const branchId = parseInt(rawBranchId, 10);

  if (!branchId || isNaN(branchId)) {
    res.status(400).json({
      success: false,
      message: 'Branch ID is required. Please provide X-Branch-Id header.'
    });
    return null;
  }

  const hasAccess = await Branch.userHasAccess(req.userId, branchId, req.user?.role);
  if (!hasAccess) {
    res.status(403).json({
      success: false,
      message: 'No access to this branch'
    });
    return null;
  }

  return branchId;
}

/**
 * Helper to validate optional/required bank_account_id for petty cash expense.
 */
async function resolveValidBankAccount(rawBankAccountId, branchId) {
  if (rawBankAccountId === undefined) {
    return { provided: false, bankAccountId: undefined, bankAccountName: null };
  }
  if (rawBankAccountId === null || rawBankAccountId === '') {
    return { provided: true, bankAccountId: null, bankAccountName: null };
  }
  const parsed = parseInt(rawBankAccountId, 10);
  if (!parsed || isNaN(parsed)) {
    return { error: 'Rekening tidak valid' };
  }
  const rows = await query(
    `SELECT id, name, type, CAST(COALESCE(initial_balance, 0) AS DECIMAL(15, 2)) AS initial_balance
     FROM bank_accounts WHERE id = ? AND branch_id = ? AND is_active = 1`,
    [parsed, branchId]
  );
  if (!rows || rows.length === 0) {
    return { error: 'Rekening tidak ditemukan di buku kas ini' };
  }
  if (rows[0].type === 'savings') {
    return { error: 'Rekening bertipe Simpanan tidak dapat dipakai untuk Kas Kecil' };
  }
  return {
    provided: true,
    bankAccountId: parsed,
    bankAccountName: rows[0].name,
    bankInitialBalance: Number(rows[0].initial_balance || 0)
  };
}

/**
 * Resolves and enforces bank_account_id for petty cash expenses depending on pocket lock mode.
 */
async function resolveExpenseBankAccount(rawBankAccountId, branchId, pocket) {
  const bankCheck = await resolveValidBankAccount(rawBankAccountId, branchId);
  if (bankCheck.error) {
    return { error: bankCheck.error };
  }

  if (pocket?.lock_bank_account && pocket?.bank_account_id) {
    const lockedRows = await query(
      `SELECT id, name FROM bank_accounts WHERE id = ? AND branch_id = ? AND is_active = 1`,
      [pocket.bank_account_id, branchId]
    );
    if (!lockedRows || lockedRows.length === 0) {
      return { error: 'Rekening yang dikunci pada Kas Kecil ini tidak aktif atau tidak ditemukan' };
    }
    const lockedName = lockedRows[0].name;
    if (bankCheck.provided && bankCheck.bankAccountId !== null && bankCheck.bankAccountId !== pocket.bank_account_id) {
      return {
        error: `Pengeluaran Kas Kecil "${pocket.name}" dikunci hanya menggunakan rekening "${lockedName}"`
      };
    }
    return { provided: true, locked: true, bankAccountId: pocket.bank_account_id };
  }

  return {
    provided: bankCheck.provided,
    locked: false,
    bankAccountId: bankCheck.provided ? bankCheck.bankAccountId : null
  };
}

/**
 * GET /api/petty-cash
 * List all active petty cash pockets for a branch with cumulative balance.
 */
const getAll = async (req, res, next) => {
  try {
    await ensurePettyCashLockColumn();
    const branchId = await resolveAuthorizedBranch(req, res);
    if (!branchId) return;

    const rows = await query(
      `SELECT
        pc.id,
        pc.branch_id,
        pc.name,
        pc.description,
        pc.initial_balance,
        pc.bank_account_id,
        pc.lock_bank_account,
        ba.name AS bank_account_name,
        ba.account_number AS bank_account_number,
        pc.created_by,
        pc.created_at,
        pc.updated_at,
        COALESCE(SUM(CASE WHEN pct.status_deleted = 0 AND pct.type = 'topup' THEN pct.amount ELSE 0 END), 0) AS pct_topup,
        COALESCE(SUM(CASE WHEN pct.status_deleted = 0 AND pct.type = 'expense' THEN pct.amount ELSE 0 END), 0) AS pct_expense,
        COUNT(CASE WHEN pct.status_deleted = 0 THEN 1 ELSE NULL END) AS pct_count,
        (CASE WHEN pc.bank_account_id IS NULL THEN 0 ELSE COALESCE((
          SELECT SUM(ft.amount) FROM fund_transfers ft
          WHERE ft.to_bank_account_id = pc.bank_account_id
            AND ft.status_deleted = 0
            AND (ba.initial_balance_date IS NULL OR DATE(ft.transfer_date) >= ba.initial_balance_date)
        ), 0) END) AS ft_in,
        (CASE WHEN pc.bank_account_id IS NULL THEN 0 ELSE COALESCE((
          SELECT SUM(ft.amount) FROM fund_transfers ft
          WHERE ft.from_bank_account_id = pc.bank_account_id
            AND ft.status_deleted = 0
            AND (ba.initial_balance_date IS NULL OR DATE(ft.transfer_date) >= ba.initial_balance_date)
        ), 0) END) AS ft_out,
        (CASE WHEN pc.bank_account_id IS NULL THEN 0 ELSE COALESCE((
          SELECT COUNT(ft.id) FROM fund_transfers ft
          WHERE (ft.to_bank_account_id = pc.bank_account_id OR ft.from_bank_account_id = pc.bank_account_id)
            AND ft.status_deleted = 0
            AND (ba.initial_balance_date IS NULL OR DATE(ft.transfer_date) >= ba.initial_balance_date)
        ), 0) END) AS ft_count
      FROM petty_cashes pc
      LEFT JOIN bank_accounts ba ON pc.bank_account_id = ba.id
      LEFT JOIN petty_cash_transactions pct ON pc.id = pct.petty_cash_id
      WHERE pc.branch_id = ? AND pc.status_deleted = 0
      GROUP BY pc.id
      ORDER BY pc.created_at ASC, pc.id ASC`,
      [branchId]
    );

    const formatted = rows.map((r) => {
      const initialBalance = parseFloat(r.initial_balance) || 0;
      const totalTopup = (parseFloat(r.pct_topup) || 0) + (parseFloat(r.ft_in) || 0);
      const totalExpense = (parseFloat(r.pct_expense) || 0) + (parseFloat(r.ft_out) || 0);
      const balance = initialBalance + totalTopup - totalExpense;
      const txCount = (Number(r.pct_count) || 0) + (Number(r.ft_count) || 0);
      return {
        id: r.id,
        branch_id: r.branch_id,
        name: r.name,
        description: r.description,
        initial_balance: initialBalance,
        bank_account_id: r.bank_account_id || null,
        lock_bank_account: Boolean(r.bank_account_id && r.lock_bank_account),
        bank_account_name: r.bank_account_name || null,
        bank_account_number: r.bank_account_number || null,
        created_by: r.created_by,
        created_at: r.created_at,
        updated_at: r.updated_at,
        total_topup: totalTopup,
        total_expense: totalExpense,
        balance,
        transaction_count: txCount
      };
    });

    const summary = formatted.reduce(
      (acc, row) => ({
        total_topup: acc.total_topup + row.total_topup,
        total_expense: acc.total_expense + row.total_expense,
        total_balance: acc.total_balance + row.balance
      }),
      { total_topup: 0, total_expense: 0, total_balance: 0 }
    );

    res.json({
      success: true,
      data: formatted,
      summary
    });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/petty-cash/:id
 * Get single petty cash pocket detail, cumulative balance, and its isolated transactions.
 */
const getById = async (req, res, next) => {
  try {
    await ensurePettyCashLockColumn();
    const branchId = await resolveAuthorizedBranch(req, res);
    if (!branchId) return;

    const pettyCashId = parseInt(req.params.id, 10);
    if (!pettyCashId || isNaN(pettyCashId)) {
      return res.status(400).json({ success: false, message: 'ID Kas Kecil tidak valid' });
    }

    const pockets = await query(
      `SELECT
        pc.id,
        pc.branch_id,
        pc.name,
        pc.description,
        pc.initial_balance,
        pc.bank_account_id,
        pc.lock_bank_account,
        ba.name AS bank_account_name,
        ba.account_number AS bank_account_number,
        DATE_FORMAT(ba.initial_balance_date, '%Y-%m-%d') AS bank_cutoff_date,
        pc.created_by,
        pc.created_at,
        pc.updated_at
       FROM petty_cashes pc
       LEFT JOIN bank_accounts ba ON pc.bank_account_id = ba.id
       WHERE pc.id = ? AND pc.branch_id = ? AND pc.status_deleted = 0`,
      [pettyCashId, branchId]
    );

    if (!pockets || pockets.length === 0) {
      return res.status(404).json({ success: false, message: 'Kas Kecil tidak ditemukan' });
    }

    const pocket = pockets[0];
    const linkedBankId = pocket.bank_account_id || null;
    const cutoffDate = pocket.bank_cutoff_date || null;
    const { startDate, endDate, type, search } = req.query;

    // Cumulative balance (always overall, regardless of date filter)
    const [balRow] = await query(
      `SELECT
        COALESCE(SUM(CASE WHEN type = 'topup' THEN amount ELSE 0 END), 0) AS total_topup,
        COALESCE(SUM(CASE WHEN type = 'expense' THEN amount ELSE 0 END), 0) AS total_expense
      FROM petty_cash_transactions
      WHERE petty_cash_id = ? AND branch_id = ? AND status_deleted = 0`,
      [pettyCashId, branchId]
    );

    let ftBalRow = { ft_in: 0, ft_out: 0 };
    if (linkedBankId) {
      const [ftSum] = await query(
        `SELECT
          COALESCE(SUM(CASE WHEN ft.to_bank_account_id = ? THEN ft.amount ELSE 0 END), 0) AS ft_in,
          COALESCE(SUM(CASE WHEN ft.from_bank_account_id = ? THEN ft.amount ELSE 0 END), 0) AS ft_out
        FROM fund_transfers ft
        WHERE (ft.to_bank_account_id = ? OR ft.from_bank_account_id = ?)
          AND ft.status_deleted = 0
          ${cutoffDate ? 'AND DATE(ft.transfer_date) >= ?' : ''}`,
        cutoffDate
          ? [linkedBankId, linkedBankId, linkedBankId, linkedBankId, cutoffDate]
          : [linkedBankId, linkedBankId, linkedBankId, linkedBankId]
      );
      if (ftSum) ftBalRow = ftSum;
    }

    let txSql = `
      SELECT
        CONCAT('pct_', pct.id) AS unique_id,
        pct.*,
        u.name AS created_by_name,
        t.note AS source_transaction_note,
        t.lampiran AS source_lampiran,
        c.name AS source_category_name,
        ba.name AS bank_account_name,
        ba.account_number AS bank_account_number,
        NULL AS source_fund_transfer_id,
        NULL AS from_account_name,
        NULL AS to_account_name
      FROM petty_cash_transactions pct
      LEFT JOIN users u ON pct.created_by = u.id
      LEFT JOIN transactions t ON pct.source_transaction_id = t.id
      LEFT JOIN categories c ON t.category_id = c.id
      LEFT JOIN bank_accounts ba ON COALESCE(pct.bank_account_id, t.bank_account_id) = ba.id
      WHERE pct.petty_cash_id = ? AND pct.branch_id = ? AND pct.status_deleted = 0
    `;
    const txParams = [pettyCashId, branchId];

    if (startDate && endDate) {
      txSql += ` AND pct.transaction_date BETWEEN ? AND ?`;
      txParams.push(startDate, endDate);
    }
    if (type === 'topup' || type === 'expense') {
      txSql += ` AND pct.type = ?`;
      txParams.push(type);
    }
    if (search && String(search).trim()) {
      txSql += ` AND (pct.description LIKE ? OR t.note LIKE ? OR c.name LIKE ? OR ba.name LIKE ?)`;
      const like = `%${String(search).trim()}%`;
      txParams.push(like, like, like, like);
    }

    txSql += ` ORDER BY pct.transaction_date DESC, pct.id DESC`;
    const pctRows = await query(txSql, txParams);

    let ftRows = [];
    if (linkedBankId) {
      let ftSql = `
        SELECT
          CONCAT('ft_', ft.id) AS unique_id,
          ft.id,
          ? AS petty_cash_id,
          ft.branch_id,
          CASE WHEN ft.to_bank_account_id = ? THEN 'topup' ELSE 'expense' END AS type,
          ft.amount,
          COALESCE(
            NULLIF(TRIM(ft.note), ''),
            CASE WHEN ft.to_bank_account_id = ?
              THEN CONCAT('Pemindahan Dana dari ', from_ba.name)
              ELSE CONCAT('Pemindahan Dana ke ', to_ba.name)
            END
          ) AS description,
          DATE_FORMAT(ft.transfer_date, '%Y-%m-%d') AS transaction_date,
          ft.lampiran,
          ? AS bank_account_id,
          ? AS bank_account_name,
          NULL AS bank_account_number,
          NULL AS source_transaction_id,
          NULL AS source_transaction_note,
          NULL AS source_lampiran,
          NULL AS source_category_name,
          ft.id AS source_fund_transfer_id,
          from_ba.name AS from_account_name,
          to_ba.name AS to_account_name,
          ft.user_id AS created_by,
          COALESCE(u.name, u.email) AS created_by_name,
          ft.created_at
        FROM fund_transfers ft
        JOIN bank_accounts from_ba ON ft.from_bank_account_id = from_ba.id
        JOIN bank_accounts to_ba ON ft.to_bank_account_id = to_ba.id
        LEFT JOIN users u ON ft.user_id = u.id
        WHERE (ft.to_bank_account_id = ? OR ft.from_bank_account_id = ?)
          AND ft.status_deleted = 0
          ${cutoffDate ? 'AND DATE(ft.transfer_date) >= ?' : ''}
      `;
      const ftParams = [
        pettyCashId,
        linkedBankId,
        linkedBankId,
        linkedBankId,
        pocket.bank_account_name || null,
        linkedBankId,
        linkedBankId
      ];
      if (cutoffDate) ftParams.push(cutoffDate);
      if (startDate && endDate) {
        ftSql += ` AND DATE(ft.transfer_date) BETWEEN ? AND ?`;
        ftParams.push(startDate, endDate);
      }
      if (type === 'topup') {
        ftSql += ` AND ft.to_bank_account_id = ?`;
        ftParams.push(linkedBankId);
      } else if (type === 'expense') {
        ftSql += ` AND ft.from_bank_account_id = ?`;
        ftParams.push(linkedBankId);
      }
      if (search && String(search).trim()) {
        ftSql += ` AND (ft.note LIKE ? OR from_ba.name LIKE ? OR to_ba.name LIKE ?)`;
        const like = `%${String(search).trim()}%`;
        ftParams.push(like, like, like);
      }
      ftRows = await query(ftSql, ftParams);
    }

    const transactions = [...pctRows, ...ftRows]
      .map((tx) => ({
        ...tx,
        amount: parseFloat(tx.amount) || 0
      }))
      .sort((a, b) => {
        const dA = String(a.transaction_date || '').slice(0, 10);
        const dB = String(b.transaction_date || '').slice(0, 10);
        if (dA !== dB) return dB.localeCompare(dA);
        const cA = a.created_at ? new Date(a.created_at).getTime() : 0;
        const cB = b.created_at ? new Date(b.created_at).getTime() : 0;
        if (cA !== cB) return cB - cA;
        return (b.id || 0) - (a.id || 0);
      });

    const periodSummary = transactions.reduce(
      (acc, tx) => {
        const amt = tx.amount || 0;
        if (tx.type === 'topup') acc.period_topup += amt;
        else acc.period_expense += amt;
        return acc;
      },
      { period_topup: 0, period_expense: 0 }
    );

    const initialBalance = parseFloat(pocket.initial_balance) || 0;
    const totalTopup = (parseFloat(balRow?.total_topup) || 0) + (parseFloat(ftBalRow.ft_in) || 0);
    const totalExpense = (parseFloat(balRow?.total_expense) || 0) + (parseFloat(ftBalRow.ft_out) || 0);

    res.json({
      success: true,
      data: {
        ...pocket,
        lock_bank_account: Boolean(pocket.bank_account_id && pocket.lock_bank_account),
        initial_balance: initialBalance,
        total_topup: totalTopup,
        total_expense: totalExpense,
        balance: initialBalance + totalTopup - totalExpense,
        ...periodSummary,
        transactions
      }
    });
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/petty-cash
 * Create a new petty cash pocket (e.g. PETTY CASH, KAS ONGKIR).
 */
const create = async (req, res, next) => {
  try {
    await ensurePettyCashLockColumn();
    const branchId = await resolveAuthorizedBranch(req, res);
    if (!branchId) return;

    const name = String(req.body?.name || '').trim();
    const description = req.body?.description ? String(req.body.description).trim() : null;
    const rawInitialBalance = req.body?.initial_balance;
    const hasInitialInput = rawInitialBalance !== undefined && rawInitialBalance !== null && rawInitialBalance !== '';
    let initialBalance = hasInitialInput ? parseFloat(rawInitialBalance) : 0;

    if (!name) {
      return res.status(400).json({ success: false, message: 'Nama Kas Kecil wajib diisi' });
    }
    if (isNaN(initialBalance) || initialBalance < 0) {
      return res.status(400).json({ success: false, message: 'Saldo awal tidak valid' });
    }

    const bankCheck = await resolveValidBankAccount(req.body?.bank_account_id, branchId);
    if (bankCheck.error) {
      return res.status(400).json({ success: false, message: bankCheck.error });
    }
    const bankAccountId = bankCheck.provided ? bankCheck.bankAccountId : null;
    const wantsLock = req.body?.lock_bank_account === true || req.body?.lock_bank_account === 1 || req.body?.lock_bank_account === '1' || req.body?.lock_bank_account === 'true';
    if (wantsLock && !bankAccountId) {
      return res.status(400).json({
        success: false,
        message: 'Mode kunci rekening hanya dapat diaktifkan jika Kas Kecil terhubung ke Rekening Bank & Cash'
      });
    }
    const lockBankAccount = normalizeLockBankFlag(req.body?.lock_bank_account, bankAccountId);

    if (bankAccountId) {
      const usedBy = await query(
        `SELECT id, name FROM petty_cashes WHERE branch_id = ? AND bank_account_id = ? AND status_deleted = 0`,
        [branchId, bankAccountId]
      );
      if (usedBy && usedBy.length > 0) {
        return res.status(400).json({
          success: false,
          message: `Rekening "${bankCheck.bankAccountName}" sudah terhubung ke Kas Kecil "${usedBy[0].name}"`
        });
      }
      if (!hasInitialInput && bankCheck.bankInitialBalance > 0) {
        initialBalance = bankCheck.bankInitialBalance;
      } else if (hasInitialInput) {
        await query(`UPDATE bank_accounts SET initial_balance = ? WHERE id = ?`, [initialBalance, bankAccountId]);
      }
    }

    const existing = await query(
      `SELECT id FROM petty_cashes WHERE branch_id = ? AND LOWER(name) = LOWER(?) AND status_deleted = 0`,
      [branchId, name]
    );
    if (existing && existing.length > 0) {
      return res.status(400).json({ success: false, message: `Kas Kecil "${name}" sudah ada` });
    }

    const result = await query(
      `INSERT INTO petty_cashes (branch_id, name, description, initial_balance, bank_account_id, lock_bank_account, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [branchId, name, description, initialBalance, bankAccountId, lockBankAccount, req.userId || null]
    );

    const [created] = await query(
      `SELECT pc.*, ba.name AS bank_account_name, ba.account_number AS bank_account_number
       FROM petty_cashes pc
       LEFT JOIN bank_accounts ba ON pc.bank_account_id = ba.id
       WHERE pc.id = ?`,
      [result.insertId]
    );

    res.status(201).json({
      success: true,
      message: 'Kas Kecil berhasil dibuat',
      data: {
        ...created,
        lock_bank_account: Boolean(created.bank_account_id && created.lock_bank_account),
        initial_balance: initialBalance,
        total_topup: 0,
        total_expense: 0,
        balance: initialBalance,
        transaction_count: 0
      }
    });
  } catch (error) {
    next(error);
  }
};

/**
 * PUT /api/petty-cash/:id
 * Rename, update description, initial balance, or linked Rekening of a petty cash pocket.
 */
const update = async (req, res, next) => {
  try {
    await ensurePettyCashLockColumn();
    const branchId = await resolveAuthorizedBranch(req, res);
    if (!branchId) return;

    const pettyCashId = parseInt(req.params.id, 10);
    const name = String(req.body?.name || '').trim();
    const description = req.body?.description !== undefined ? (req.body.description ? String(req.body.description).trim() : null) : undefined;
    const hasInitialBalance = req.body?.initial_balance !== undefined && req.body?.initial_balance !== null && req.body?.initial_balance !== '';
    let initialBalance = hasInitialBalance ? parseFloat(req.body.initial_balance) : undefined;

    if (!name) {
      return res.status(400).json({ success: false, message: 'Nama Kas Kecil wajib diisi' });
    }
    if (hasInitialBalance && (isNaN(initialBalance) || initialBalance < 0)) {
      return res.status(400).json({ success: false, message: 'Saldo awal tidak valid' });
    }

    const existing = await query(
      `SELECT id, initial_balance, bank_account_id, lock_bank_account FROM petty_cashes WHERE id = ? AND branch_id = ? AND status_deleted = 0`,
      [pettyCashId, branchId]
    );
    if (!existing || existing.length === 0) {
      return res.status(404).json({ success: false, message: 'Kas Kecil tidak ditemukan' });
    }

    const duplicate = await query(
      `SELECT id FROM petty_cashes WHERE branch_id = ? AND LOWER(name) = LOWER(?) AND id != ? AND status_deleted = 0`,
      [branchId, name, pettyCashId]
    );
    if (duplicate && duplicate.length > 0) {
      return res.status(400).json({ success: false, message: `Kas Kecil "${name}" sudah ada` });
    }

    const bankCheck = await resolveValidBankAccount(req.body?.bank_account_id, branchId);
    if (bankCheck.error) {
      return res.status(400).json({ success: false, message: bankCheck.error });
    }
    const targetBankAccountId = bankCheck.provided ? bankCheck.bankAccountId : existing[0].bank_account_id;
    const hasLockInput = req.body?.lock_bank_account !== undefined;
    const wantsLock = req.body?.lock_bank_account === true || req.body?.lock_bank_account === 1 || req.body?.lock_bank_account === '1' || req.body?.lock_bank_account === 'true';
    if (hasLockInput && wantsLock && !targetBankAccountId) {
      return res.status(400).json({
        success: false,
        message: 'Mode kunci rekening hanya dapat diaktifkan jika Kas Kecil terhubung ke Rekening Bank & Cash'
      });
    }

    if (targetBankAccountId) {
      const usedBy = await query(
        `SELECT id, name FROM petty_cashes WHERE branch_id = ? AND bank_account_id = ? AND id != ? AND status_deleted = 0`,
        [branchId, targetBankAccountId, pettyCashId]
      );
      if (usedBy && usedBy.length > 0) {
        return res.status(400).json({
          success: false,
          message: `Rekening sudah terhubung ke Kas Kecil "${usedBy[0].name}"`
        });
      }

      const currentPcInitial = hasInitialBalance ? initialBalance : (parseFloat(existing[0].initial_balance) || 0);
      if (hasInitialBalance) {
        await query(`UPDATE bank_accounts SET initial_balance = ? WHERE id = ?`, [currentPcInitial, targetBankAccountId]);
      } else if (bankCheck.provided && bankCheck.bankAccountId !== existing[0].bank_account_id) {
        if (currentPcInitial === 0 && bankCheck.bankInitialBalance > 0) {
          initialBalance = bankCheck.bankInitialBalance;
        } else if (currentPcInitial > 0 && bankCheck.bankInitialBalance === 0) {
          await query(`UPDATE bank_accounts SET initial_balance = ? WHERE id = ?`, [currentPcInitial, targetBankAccountId]);
        }
      }
    }

    const fields = ['name = ?'];
    const params = [name];
    if (description !== undefined) {
      fields.push('description = ?');
      params.push(description);
    }
    if (initialBalance !== undefined) {
      fields.push('initial_balance = ?');
      params.push(initialBalance);
    }
    if (bankCheck.provided) {
      fields.push('bank_account_id = ?');
      params.push(bankCheck.bankAccountId);
    }
    if (!targetBankAccountId) {
      fields.push('lock_bank_account = ?');
      params.push(0);
    } else if (hasLockInput) {
      fields.push('lock_bank_account = ?');
      params.push(normalizeLockBankFlag(req.body.lock_bank_account, targetBankAccountId));
    }
    params.push(pettyCashId, branchId);

    await query(`UPDATE petty_cashes SET ${fields.join(', ')} WHERE id = ? AND branch_id = ?`, params);

    const [updated] = await query(
      `SELECT pc.*, ba.name AS bank_account_name, ba.account_number AS bank_account_number
       FROM petty_cashes pc
       LEFT JOIN bank_accounts ba ON pc.bank_account_id = ba.id
       WHERE pc.id = ?`,
      [pettyCashId]
    );
    res.json({
      success: true,
      message: 'Kas Kecil berhasil diperbarui',
      data: {
        ...updated,
        lock_bank_account: Boolean(updated.bank_account_id && updated.lock_bank_account)
      }
    });
  } catch (error) {
    next(error);
  }
};

/**
 * DELETE /api/petty-cash/:id
 * Soft-delete a petty cash pocket (requires balance === 0 so funds aren't orphaned).
 */
const deletePettyCash = async (req, res, next) => {
  try {
    const branchId = await resolveAuthorizedBranch(req, res);
    if (!branchId) return;

    const pettyCashId = parseInt(req.params.id, 10);
    const existing = await query(
      `SELECT id, name, initial_balance FROM petty_cashes WHERE id = ? AND branch_id = ? AND status_deleted = 0`,
      [pettyCashId, branchId]
    );
    if (!existing || existing.length === 0) {
      return res.status(404).json({ success: false, message: 'Kas Kecil tidak ditemukan' });
    }

    const [balRow] = await query(
      `SELECT COALESCE(SUM(CASE WHEN type = 'topup' THEN amount ELSE -amount END), 0) AS balance
       FROM petty_cash_transactions
       WHERE petty_cash_id = ? AND branch_id = ? AND status_deleted = 0`,
      [pettyCashId, branchId]
    );
    const currentBalance = (parseFloat(existing[0].initial_balance) || 0) + (parseFloat(balRow?.balance) || 0);
    if (currentBalance > 0) {
      return res.status(400).json({
        success: false,
        message: `Saldo "${existing[0].name}" masih Rp ${currentBalance.toLocaleString('id-ID')}. Habiskan atau nol-kan saldo terlebih dahulu sebelum menghapus.`
      });
    }

    const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
    await query(`UPDATE petty_cashes SET status_deleted = 1, deleted_at = ? WHERE id = ? AND branch_id = ?`, [
      now,
      pettyCashId,
      branchId
    ]);

    res.json({ success: true, message: 'Kas Kecil berhasil dihapus' });
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/petty-cash/:id/expenses
 * Record an isolated expense inside a petty cash pocket (does NOT affect Kas Berjalan / Laporan Keuangan).
 */
const createExpense = async (req, res, next) => {
  try {
    await ensurePettyCashLockColumn();
    const branchId = await resolveAuthorizedBranch(req, res);
    if (!branchId) return;

    const pettyCashId = parseInt(req.params.id, 10);
    const amount = parseFloat(req.body?.amount);
    const description = req.body?.description ? String(req.body.description).trim() : null;
    const transactionDate = req.body?.transaction_date || req.body?.date || new Date().toISOString().slice(0, 10);
    const lampiran = req.body?.lampiran
      ? Array.isArray(req.body.lampiran)
        ? JSON.stringify(req.body.lampiran)
        : String(req.body.lampiran)
      : null;

    if (!amount || isNaN(amount) || amount <= 0) {
      return res.status(400).json({ success: false, message: 'Nominal pengeluaran harus lebih dari 0' });
    }

    const existing = await query(
      `SELECT id, name, bank_account_id, lock_bank_account FROM petty_cashes WHERE id = ? AND branch_id = ? AND status_deleted = 0`,
      [pettyCashId, branchId]
    );
    if (!existing || existing.length === 0) {
      return res.status(404).json({ success: false, message: 'Kas Kecil tidak ditemukan' });
    }

    const expBank = await resolveExpenseBankAccount(req.body?.bank_account_id, branchId, existing[0]);
    if (expBank.error) {
      return res.status(400).json({ success: false, message: expBank.error });
    }
    const bankAccountId = expBank.bankAccountId;

    const result = await query(
      `INSERT INTO petty_cash_transactions (petty_cash_id, branch_id, type, amount, description, transaction_date, lampiran, bank_account_id, created_by)
       VALUES (?, ?, 'expense', ?, ?, ?, ?, ?, ?)`,
      [pettyCashId, branchId, amount, description, transactionDate, lampiran, bankAccountId, req.userId || null]
    );

    const [created] = await query(
      `SELECT pct.*, ba.name AS bank_account_name, ba.account_number AS bank_account_number
       FROM petty_cash_transactions pct
       LEFT JOIN bank_accounts ba ON pct.bank_account_id = ba.id
       WHERE pct.id = ?`,
      [result.insertId]
    );

    res.status(201).json({
      success: true,
      message: 'Pengeluaran Kas Kecil berhasil dicatat',
      data: {
        ...created,
        amount: parseFloat(created.amount) || 0
      }
    });
  } catch (error) {
    next(error);
  }
};

/**
 * PUT /api/petty-cash/:id/expenses/:txId
 * Update an isolated expense inside petty cash.
 */
const updateExpense = async (req, res, next) => {
  try {
    await ensurePettyCashLockColumn();
    const branchId = await resolveAuthorizedBranch(req, res);
    if (!branchId) return;

    const pettyCashId = parseInt(req.params.id, 10);
    const txId = parseInt(req.params.txId, 10);
    const amount = parseFloat(req.body?.amount);
    const description = req.body?.description !== undefined ? (req.body.description ? String(req.body.description).trim() : null) : undefined;
    const transactionDate = req.body?.transaction_date || req.body?.date;
    const lampiran = req.body?.lampiran !== undefined
      ? (req.body.lampiran ? (Array.isArray(req.body.lampiran) ? JSON.stringify(req.body.lampiran) : String(req.body.lampiran)) : null)
      : undefined;

    const pockets = await query(
      `SELECT id, name, bank_account_id, lock_bank_account FROM petty_cashes WHERE id = ? AND branch_id = ? AND status_deleted = 0`,
      [pettyCashId, branchId]
    );
    if (!pockets || pockets.length === 0) {
      return res.status(404).json({ success: false, message: 'Kas Kecil tidak ditemukan' });
    }

    const rows = await query(
      `SELECT * FROM petty_cash_transactions WHERE id = ? AND petty_cash_id = ? AND branch_id = ? AND status_deleted = 0`,
      [txId, pettyCashId, branchId]
    );
    if (!rows || rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Transaksi Kas Kecil tidak ditemukan' });
    }
    if (rows[0].type === 'topup') {
      return res.status(400).json({
        success: false,
        message: 'Top-up berasal dari Kas Berjalan. Silakan ubah melalui transaksi di Kas Berjalan.'
      });
    }

    if (!amount || isNaN(amount) || amount <= 0) {
      return res.status(400).json({ success: false, message: 'Nominal pengeluaran harus lebih dari 0' });
    }

    const expBank = await resolveExpenseBankAccount(req.body?.bank_account_id, branchId, pockets[0]);
    if (expBank.error) {
      return res.status(400).json({ success: false, message: expBank.error });
    }
    const nextBankAccountId = expBank.locked
      ? expBank.bankAccountId
      : (expBank.provided ? expBank.bankAccountId : rows[0].bank_account_id);

    await query(
      `UPDATE petty_cash_transactions
       SET amount = ?, description = ?, transaction_date = ?, lampiran = ?, bank_account_id = ?
       WHERE id = ? AND petty_cash_id = ? AND branch_id = ?`,
      [
        amount,
        description !== undefined ? description : rows[0].description,
        transactionDate || rows[0].transaction_date,
        lampiran !== undefined ? lampiran : rows[0].lampiran,
        nextBankAccountId,
        txId,
        pettyCashId,
        branchId
      ]
    );

    const [updated] = await query(
      `SELECT pct.*, ba.name AS bank_account_name, ba.account_number AS bank_account_number
       FROM petty_cash_transactions pct
       LEFT JOIN bank_accounts ba ON pct.bank_account_id = ba.id
       WHERE pct.id = ?`,
      [txId]
    );
    res.json({
      success: true,
      message: 'Pengeluaran Kas Kecil berhasil diperbarui',
      data: { ...updated, amount: parseFloat(updated.amount) || 0 }
    });
  } catch (error) {
    next(error);
  }
};

/**
 * DELETE /api/petty-cash/:id/expenses/:txId
 * Soft-delete an isolated expense inside petty cash.
 */
const deleteExpense = async (req, res, next) => {
  try {
    const branchId = await resolveAuthorizedBranch(req, res);
    if (!branchId) return;

    const pettyCashId = parseInt(req.params.id, 10);
    const txId = parseInt(req.params.txId, 10);

    const rows = await query(
      `SELECT * FROM petty_cash_transactions WHERE id = ? AND petty_cash_id = ? AND branch_id = ? AND status_deleted = 0`,
      [txId, pettyCashId, branchId]
    );
    if (!rows || rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Transaksi Kas Kecil tidak ditemukan' });
    }
    if (rows[0].type === 'topup') {
      return res.status(400).json({
        success: false,
        message: 'Top-up berasal dari Kas Berjalan. Silakan hapus melalui transaksi di Kas Berjalan.'
      });
    }

    const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
    await query(
      `UPDATE petty_cash_transactions SET status_deleted = 1, deleted_at = ? WHERE id = ? AND petty_cash_id = ? AND branch_id = ?`,
      [now, txId, pettyCashId, branchId]
    );

    res.json({ success: true, message: 'Pengeluaran Kas Kecil berhasil dihapus' });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getAll,
  getById,
  create,
  update,
  deletePettyCash,
  createExpense,
  updateExpense,
  deleteExpense
};

