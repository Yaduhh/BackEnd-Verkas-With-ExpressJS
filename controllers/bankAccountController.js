const BankAccount = require('../models/BankAccount');
const Branch = require('../models/Branch');

const parseSharedBranchIds = (raw) => {
  if (raw === undefined) return undefined;
  if (!Array.isArray(raw)) return [];
  return Array.from(
    new Set(raw.map((id) => parseInt(id, 10)).filter((id) => Number.isFinite(id) && id > 0))
  );
};

const filterAccessibleSharedBranches = async (requestedIds, homeBranchId, req) => {
  if (requestedIds === undefined) return undefined;
  const userBranches = await Branch.findByUserAccess(req.userId || req.user?.id, req.user?.role);
  const accessibleSet = new Set(userBranches.map((b) => Number(b.id)));
  const homeBranch = userBranches.find((b) => Number(b.id) === Number(homeBranchId));
  const homeGroup = homeBranch?.group_name ? String(homeBranch.group_name).trim().toLowerCase() : null;

  return requestedIds.filter((id) => {
    if (!accessibleSet.has(id)) return false;
    if (!homeGroup) return id === Number(homeBranchId);
    const target = userBranches.find((b) => Number(b.id) === id);
    const targetGroup = target?.group_name ? String(target.group_name).trim().toLowerCase() : null;
    return targetGroup === homeGroup;
  });
};

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

const getByGroup = async (req, res, next) => {
  try {
    const { group_name, branchIds, type } = req.query;
    const userBranches = await Branch.findByUserAccess(req.userId || req.user?.id, req.user?.role);
    const accessibleMap = new Map(userBranches.map((b) => [Number(b.id), b]));

    let targetBranchIds = [];
    if (branchIds) {
      targetBranchIds = String(branchIds)
        .split(',')
        .map((id) => parseInt(id.trim(), 10))
        .filter((id) => Number.isFinite(id) && accessibleMap.has(id));
    } else if (group_name) {
      const normalizedGroup = String(group_name).trim().toLowerCase();
      targetBranchIds = userBranches
        .filter((b) => String(b.group_name || '').trim().toLowerCase() === normalizedGroup)
        .map((b) => Number(b.id));
    } else {
      targetBranchIds = userBranches.map((b) => Number(b.id));
    }

    const accounts = await BankAccount.findByGroup(targetBranchIds, type || null);
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
      initial_balance_note,
      sharedBranchIds,
      shared_branch_ids,
      branchId: bodyBranchId,
      branch_id: bodyBranchIdSnake
    } = req.body;
    const rawBranchId = bodyBranchId || bodyBranchIdSnake || req.branchId || req.headers['x-branch-id'] || null;

    if (!name) {
      return res.status(400).json({
        success: false,
        message: 'Account name is required'
      });
    }

    if (!rawBranchId) {
      return res.status(400).json({
        success: false,
        message: 'Branch ID is required'
      });
    }

    const homeBranchId = parseInt(rawBranchId, 10);
    const resolvedInitialBalance =
      initialBalance !== undefined ? initialBalance : (initial_balance !== undefined ? initial_balance : 0);
    const resolvedInitialDate =
      initialBalanceDate !== undefined ? initialBalanceDate : (initial_balance_date !== undefined ? initial_balance_date : null);
    const resolvedInitialNote =
      initialBalanceNote !== undefined ? initialBalanceNote : (initial_balance_note !== undefined ? initial_balance_note : null);
    const parsedSharedIds = parseSharedBranchIds(sharedBranchIds !== undefined ? sharedBranchIds : shared_branch_ids);
    const safeSharedBranchIds = await filterAccessibleSharedBranches(parsedSharedIds, homeBranchId, req);

    const account = await BankAccount.create({
      name,
      accountNumber: accountNumber || account_number || null,
      branchId: homeBranchId,
      type: type || 'savings',
      accountCategory: accountCategory !== undefined ? accountCategory : (account_category !== undefined ? account_category : 'real'),
      initialBalance: resolvedInitialBalance,
      initialBalanceDate: resolvedInitialDate,
      initialBalanceNote: resolvedInitialNote,
      sharedBranchIds: safeSharedBranchIds
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
      linked_petty_cash_lock_bank,
      sharedBranchIds,
      shared_branch_ids
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
    const parsedSharedIds = parseSharedBranchIds(sharedBranchIds !== undefined ? sharedBranchIds : shared_branch_ids);
    const safeSharedBranchIds = await filterAccessibleSharedBranches(parsedSharedIds, account.branch_id, req);

    const updated = await BankAccount.update(id, {
      name,
      accountNumber: resolvedAccountNumber,
      type,
      accountCategory: resolvedAccountCategory,
      initialBalance: resolvedInitialBalance,
      initialBalanceDate: resolvedInitialDate,
      initialBalanceNote: resolvedInitialNote,
      linkedPettyCashId: resolvedLinkedPettyCashId,
      linkedPettyCashLockBank: resolvedLinkedPettyCashLockBank,
      sharedBranchIds: safeSharedBranchIds
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
    const { startDate, endDate, type, search, branchId, page = 1, limit = 50 } = req.query;

    const data = await BankAccount.getStatement(parseInt(id), {
      startDate: startDate || null,
      endDate: endDate || null,
      type: type || 'all',
      search: search || '',
      branchId: branchId || null,
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
  getByGroup,
  create,
  updateAccount,
  deleteAccount,
  getStatement
};
