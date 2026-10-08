const SalesChannel = require('../models/SalesChannel');

// Get all sales channels
const getSalesChannels = async (req, res, next) => {
  try {
    const branchId = req.branchId || req.headers['x-branch-id'];
    const { include_inactive, only_deleted } = req.query;

    const channels = await SalesChannel.findAll({
      branchId: branchId ? parseInt(branchId) : null,
      includeInactive: include_inactive === 'true' || include_inactive === '1' || req.user.role === 'owner' || req.user.role === 'master',
      onlyDeleted: only_deleted === 'true' || only_deleted === '1'
    });

    res.json({
      success: true,
      data: channels
    });
  } catch (error) {
    next(error);
  }
};

// Get single sales channel
const getSalesChannelById = async (req, res, next) => {
  try {
    const { id } = req.params;
    const channel = await SalesChannel.findById(parseInt(id));

    if (!channel) {
      return res.status(404).json({
        success: false,
        message: 'Sales Channel tidak ditemukan'
      });
    }

    res.json({
      success: true,
      data: channel
    });
  } catch (error) {
    next(error);
  }
};

// Create sales channel
const createSalesChannel = async (req, res, next) => {
  try {
    const branchId = req.branchId || req.headers['x-branch-id'];
    const { name, description, is_active = true } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({
        success: false,
        message: 'Nama Sales Channel wajib diisi'
      });
    }

    const channel = await SalesChannel.create({
      branchId: branchId ? parseInt(branchId) : null,
      name: name.trim(),
      description: description ? description.trim() : null,
      isActive: is_active !== false && is_active !== 0 && is_active !== '0'
    });

    res.status(201).json({
      success: true,
      message: 'Sales Channel berhasil dibuat',
      data: channel
    });
  } catch (error) {
    next(error);
  }
};

// Update sales channel
const updateSalesChannel = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { name, description, is_active } = req.body;

    const existing = await SalesChannel.findById(parseInt(id));
    if (!existing) {
      return res.status(404).json({
        success: false,
        message: 'Sales Channel tidak ditemukan'
      });
    }

    const updated = await SalesChannel.update(parseInt(id), {
      name: name !== undefined ? name.trim() : undefined,
      description: description !== undefined ? description.trim() : undefined,
      isActive: is_active !== undefined ? (is_active !== false && is_active !== 0 && is_active !== '0') : undefined
    });

    res.json({
      success: true,
      message: 'Sales Channel berhasil diperbarui',
      data: updated
    });
  } catch (error) {
    next(error);
  }
};

// Soft delete sales channel
const deleteSalesChannel = async (req, res, next) => {
  try {
    const { id } = req.params;
    const existing = await SalesChannel.findById(parseInt(id));

    if (!existing) {
      return res.status(404).json({
        success: false,
        message: 'Sales Channel tidak ditemukan'
      });
    }

    await SalesChannel.softDelete(parseInt(id));

    res.json({
      success: true,
      message: 'Sales Channel berhasil dihapus'
    });
  } catch (error) {
    next(error);
  }
};

// Restore soft deleted sales channel
const restoreSalesChannel = async (req, res, next) => {
  try {
    const { id } = req.params;
    const restored = await SalesChannel.restore(parseInt(id));

    if (!restored) {
      return res.status(404).json({
        success: false,
        message: 'Sales Channel tidak ditemukan'
      });
    }

    res.json({
      success: true,
      message: 'Sales Channel berhasil dipulihkan',
      data: restored
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getSalesChannels,
  getSalesChannelById,
  createSalesChannel,
  updateSalesChannel,
  deleteSalesChannel,
  restoreSalesChannel
};
