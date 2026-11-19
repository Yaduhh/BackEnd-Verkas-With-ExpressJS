const BankAccount = require('../models/BankAccount');

const getAll = async (req, res, next) => {
  try {
    const branchId = req.branchId || req.headers['x-branch-id'] || null;
    const { type } = req.query;

    if (!branchId) {
      return res.status(400).json({
        success: false,
        message: 'Branch ID is required'
      });
    }

    const accounts = await BankAccount.findAll(parseInt(branchId), type || null);
    res.json({
      success: true,
      data: accounts
    });
  } catch (error) {
    next(error);
  }
};

const create = async (req, res, next) => {
  try {
    const {
      name,
      accountNumber,
      account_number,
      type,
      accountCategory,
      account_category,
      initialBalance,
      initial_balance,
      initialBalanceDate,
      initial_balance_date,
      initialBalanceNote,
      initial_balance_note
    } = req.body;
    const branchId = req.branchId || req.headers['x-branch-id'] || null;

    if (!name) {
      return res.status(400).json({
        success: false,
        message: 'Account name is required'
      });
    }

    if (!branchId) {
      return res.status(400).json({
        success: false,
        message: 'Branch ID is required'
      });
    }

    const resolvedInitialBalance =
      initialBalance !== undefined ? initialBalance : (initial_balance !== undefined ? initial_balance : 0);
    const resolvedInitialDate =
      initialBalanceDate !== undefined ? initialBalanceDate : (initial_balance_date !== undefined ? initial_balance_date : null);
    const resolvedInitialNote =
      initialBalanceNote !== undefined ? initialBalanceNote : (initial_balance_note !== undefined ? initial_balance_note : null);

    const account = await BankAccount.create({
      name,
      accountNumber: accountNumber || account_number || null,
      branchId: parseInt(branchId),
      type: type || 'savings',
      accountCategory: accountCategory !== undefined ? accountCategory : (account_category !== undefined ? account_category : 'real'),
      initialBalance: resolvedInitialBalance,
      initialBalanceDate: resolvedInitialDate,
      initialBalanceNote: resolvedInitialNote
    });

    res.status(201).json({
      success: true,
      message: 'Bank account created successfully',
      data: account
    });
  } catch (error) {
    next(error);
  }
};

const updateAccount = async (req, res, next) => {
  try {
    const { id } = req.params;
    const {
      name,
      accountNumber,
      account_number,
      type,
      accountCategory,
      account_category,
      initialBalance,
      initial_balance,
      initialBalanceDate,
      initial_balance_date,
      initialBalanceNote,
      initial_balance_note,
      linkedPettyCashId,
      linked_petty_cash_id,
      linkedPettyCashLockBank,
      linked_petty_cash_lock_bank
    } = req.body;

    const account = await BankAccount.findById(id);
    if (!account) {
      return res.status(404).json({
        success: false,
        message: 'Bank account not found'
      });
    }

    const resolvedAccountNumber = accountNumber !== undefined ? accountNumber : account_number;
    const resolvedAccountCategory = accountCategory !== undefined ? accountCategory : account_category;
    const resolvedInitialBalance = initialBalance !== undefined ? initialBalance : initial_balance;
    const resolvedInitialDate = initialBalanceDate !== undefined ? initialBalanceDate : initial_balance_date;
    const resolvedInitialNote = initialBalanceNote !== undefined ? initialBalanceNote : initial_balance_note;
    const resolvedLinkedPettyCashId = linkedPettyCashId !== undefined ? linkedPettyCashId : linked_petty_cash_id;
    const resolvedLinkedPettyCashLockBank = linkedPettyCashLockBank !== undefined ? linkedPettyCashLockBank : linked_petty_cash_lock_bank;

    const updated = await BankAccount.update(id, {
      name,
      accountNumber: resolvedAccountNumber,
      type,
      accountCategory: resolvedAccountCategory,
      initialBalance: resolvedInitialBalance,
      initialBalanceDate: resolvedInitialDate,
      initialBalanceNote: resolvedInitialNote,
      linkedPettyCashId: resolvedLinkedPettyCashId,
      linkedPettyCashLockBank: resolvedLinkedPettyCashLockBank
    });

    res.json({
      success: true,
      message: 'Bank account updated successfully',
      data: updated
    });
  } catch (error) {
    next(error);
  }
};

const deleteAccount = async (req, res, next) => {
  try {
    const { id } = req.params;

    const account = await BankAccount.findById(id);
    if (!account) {
      return res.status(404).json({
        success: false,
        message: 'Bank account not found'
      });
    }

    await BankAccount.delete(id);

    res.json({
      success: true,
      message: 'Bank account deleted successfully'
    });
  } catch (error) {
    next(error);
  }
};

const getStatement = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { startDate, endDate, type, search, page = 1, limit = 50 } = req.query;

    const data = await BankAccount.getStatement(parseInt(id), {
      startDate: startDate || null,
      endDate: endDate || null,
      type: type || 'all',
      search: search || '',
      page: parseInt(page),
      limit: parseInt(limit)
    });

    if (!data) {
      return res.status(404).json({
        success: false,
        message: 'Bank account not found'
      });
    }

    res.json({
      success: true,
      data
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getAll,
  create,
  updateAccount,
  deleteAccount,
  getStatement
};
