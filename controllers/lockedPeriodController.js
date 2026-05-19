const LockedPeriod = require('../models/LockedPeriod');
const LogService = require('../services/logService');

exports.getLockedPeriods = async (req, res) => {
  try {
    const branchId = req.params.id || req.headers['x-branch-id'];
    
    if (!branchId) {
      return res.status(400).json({
        success: false,
        message: 'Branch ID is required'
      });
    }

    const lockedPeriods = await LockedPeriod.findAllByBranch(branchId);
    
    res.json({
      success: true,
      data: lockedPeriods
    });
  } catch (error) {
    console.error('Error fetching locked periods:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while fetching locked periods'
    });
  }
};

exports.toggleLock = async (req, res) => {
  try {
    const branchId = req.params.id;
    const { month, year, is_locked } = req.body;
    
    if (!branchId || month === undefined || year === undefined || is_locked === undefined) {
      return res.status(400).json({
        success: false,
        message: 'Branch ID, month, year, and is_locked are required'
      });
    }

    const result = await LockedPeriod.toggleLock(
      branchId, 
      month, 
      year, 
      is_locked, 
      req.user.id
    );

    // Log activity
    await LogService.logActivity({
      userId: req.user.id,
      branchId: branchId,
      action: is_locked ? 'LOCK_PERIOD' : 'UNLOCK_PERIOD',
      target: 'BRANCH_PERIOD',
      details: `${is_locked ? 'Mengunci' : 'Membuka kunci'} pembukuan untuk periode ${month}/${year}`,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent']
    });
    
    res.json({
      success: true,
      message: `Pembukuan periode ${month}/${year} berhasil di${is_locked ? 'kunci' : 'buka'}`,
      data: result
    });
  } catch (error) {
    console.error('Error toggling lock period:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while toggling lock period'
    });
  }
};
