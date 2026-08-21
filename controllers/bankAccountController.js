const BankAccount = require('../models/BankAccount');
const LogService = require('../services/logService');

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
    const { name, type } = req.body;
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

    const account = await BankAccount.create({
      name,
      branchId: parseInt(branchId),
      type: type || 'savings'
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
    const { name, type } = req.body;

    const account = await BankAccount.findById(id);
    if (!account) {
      return res.status(404).json({
        success: false,
        message: 'Bank account not found'
      });
    }

    const updated = await BankAccount.update(id, { name, type });

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

module.exports = {
  getAll,
  create,
  updateAccount,
  deleteAccount
};
