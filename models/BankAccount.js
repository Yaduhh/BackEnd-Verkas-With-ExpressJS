const { query } = require('../config/database');

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
               AND (t.is_draft = false OR t.is_draft IS NULL)),
            0
          )
          +
          COALESCE(
            (SELECT SUM(COALESCE(tid.amount_cashier, tid.amount_app, 0))
             FROM transaction_income_details tid
             JOIN transactions t ON tid.transaction_id = t.id
             WHERE tid.bank_account_id = ba.id
               AND t.status_deleted = false
               AND (t.is_draft = false OR t.is_draft IS NULL)),
            0
          )
          -
          COALESCE(
            (SELECT SUM(t.amount)
             FROM transactions t
             WHERE t.bank_account_id = ba.id
               AND t.type = 'expense'
               AND t.status_deleted = false
               AND (t.is_draft = false OR t.is_draft IS NULL)),
            0
          )
          +
          COALESCE(
            (SELECT SUM(ft.amount)
             FROM fund_transfers ft
             WHERE ft.to_bank_account_id = ba.id
               AND ft.status_deleted = 0),
            0
          )
          -
          COALESCE(
            (SELECT SUM(ft.amount)
             FROM fund_transfers ft
             WHERE ft.from_bank_account_id = ba.id
               AND ft.status_deleted = 0),
            0
          )
        )
    END AS DECIMAL(15, 2)
  ) AS balance
`;

class BankAccount {
  static async findAll(branchId, type = null) {
    let sql = `
      SELECT 
        ba.*,
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
    return await query(sql, params);
  }

  static async findById(id) {
    const results = await query(
      `SELECT 
        ba.*,
        ${BALANCE_SQL}
      FROM bank_accounts ba
      WHERE ba.id = ?`,
      [id]
    );
    return results[0] || null;
  }

  static async create({ name, accountNumber = null, branchId, type = 'savings' }) {
    const validTypes = ['savings', 'operational', 'income', 'both'];
    const selectedType = validTypes.includes(type) ? type : 'savings';

    const result = await query(
      'INSERT INTO bank_accounts (name, account_number, branch_id, type) VALUES (?, ?, ?, ?)',
      [name, accountNumber, branchId, selectedType]
    );
    return await this.findById(result.insertId);
  }

  static async update(id, { name, accountNumber, type }) {
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

    if (type !== undefined) {
      const validTypes = ['savings', 'operational', 'income', 'both'];
      if (validTypes.includes(type)) {
        updates.push('type = ?');
        params.push(type);
      }
    }

    if (updates.length > 0) {
      params.push(id);
      await query(
        `UPDATE bank_accounts SET ${updates.join(', ')} WHERE id = ?`,
        params
      );
    }

    return await this.findById(id);
  }

  static async delete(id) {
    return await query('DELETE FROM bank_accounts WHERE id = ?', [id]);
  }

  static async getStatement(id, { startDate = null, endDate = null, type = 'all', search = '', page = 1, limit = 50 } = {}) {
    const account = await this.findById(id);
    if (!account) return null;

    // 1. Direct Income Summary
    const [directIncome] = await query(`
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
    `, [id]);

    // 2. Income Details Summary (Omzet kasir / apps)
    const [incomeDetails] = await query(`
      SELECT 
        COALESCE(SUM(COALESCE(tid.amount_cashier, tid.amount_app, 0)), 0) as total,
        COUNT(DISTINCT tid.transaction_id) as count
      FROM transaction_income_details tid
      JOIN transactions t ON tid.transaction_id = t.id
      WHERE tid.bank_account_id = ?
        AND t.status_deleted = false
        AND (t.is_draft = false OR t.is_draft IS NULL)
    `, [id]);

    // 3. Operational Expenses Summary
    const [expenses] = await query(`
      SELECT 
        COALESCE(SUM(t.amount), 0) as total,
        COUNT(t.id) as count
      FROM transactions t
      WHERE t.bank_account_id = ?
        AND t.type = 'expense'
        AND t.status_deleted = false
        AND (t.is_draft = false OR t.is_draft IS NULL)
    `, [id]);

    // 4. Fund Transfers Incoming Summary (Transfer Masuk)
    const [transfersIn] = await query(`
      SELECT 
        COALESCE(SUM(ft.amount), 0) as total,
        COUNT(ft.id) as count
      FROM fund_transfers ft
      WHERE ft.to_bank_account_id = ?
        AND ft.status_deleted = 0
    `, [id]);

    // 5. Fund Transfers Outgoing Summary (Transfer Keluar)
    const [transfersOut] = await query(`
      SELECT 
        COALESCE(SUM(ft.amount), 0) as total,
        COUNT(ft.id) as count
      FROM fund_transfers ft
      WHERE ft.from_bank_account_id = ?
        AND ft.status_deleted = 0
    `, [id]);

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
    const totalExpense = Number(expenses.total);
    const totalTransferIn = Number(transfersIn.total);
    const totalTransferOut = Number(transfersOut.total);
    const calculatedBalance = (totalIncome + totalTransferIn) - (totalExpense + totalTransferOut);

    // 7. Fetch all 3 mutation streams safely (avoids collation mismatch on MySQL UNION across utf8mb4_unicode_ci and utf8mb4_general_ci)
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
      txQuery += ' AND t.transaction_date >= ?';
      txParams.push(startDate);
    }
    if (endDate) {
      txQuery += ' AND t.transaction_date <= ?';
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
      tidQuery += ' AND t.transaction_date >= ?';
      tidParams.push(startDate);
    }
    if (endDate) {
      tidQuery += ' AND t.transaction_date <= ?';
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
      ftQuery += ' AND ft.transfer_date >= ?';
      ftParams.push(startDate);
    }
    if (endDate) {
      ftQuery += ' AND ft.transfer_date <= ?';
      ftParams.push(endDate);
    }

    const [txResults, tidResults, ftResults] = await Promise.all([
      query(txQuery, txParams),
      query(tidQuery, tidParams),
      query(ftQuery, ftParams)
    ]);

    let allMutations = [...txResults, ...tidResults, ...ftResults];

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

    const formattedMutations = paginatedMutations.map(m => {
      let parsedLampiran = [];
      if (m.lampiran) {
        if (typeof m.lampiran === 'string') {
          try {
            parsedLampiran = JSON.parse(m.lampiran);
          } catch (e) {
            parsedLampiran = [m.lampiran];
          }
        } else if (Array.isArray(m.lampiran)) {
          parsedLampiran = m.lampiran;
        }
      }
      return {
        ...m,
        amount: Number(m.amount),
        lampiran: Array.isArray(parsedLampiran) ? parsedLampiran : [parsedLampiran].filter(Boolean)
      };
    });

    return {
      account,
      breakdown: {
        total_income_direct: Number(directIncome.total),
        direct_income_count: directIncome.count,
        total_income_details: Number(incomeDetails.total),
        income_details_count: incomeDetails.count,
        total_income: totalIncome,
        total_expense: totalExpense,
        expense_count: expenses.count,
        total_transfer_in: totalTransferIn,
        transfer_in_count: transfersIn.count,
        total_transfer_out: totalTransferOut,
        transfer_out_count: transfersOut.count,
        net_transfer: totalTransferIn - totalTransferOut,
        calculated_balance: calculatedBalance,
        total_allocations: totalAllocations,
        allocations
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
