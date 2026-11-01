const ApiKey = require('../models/ApiKey');
const Branch = require('../models/Branch');

const apiKeyController = {
  // Get all API keys for logged in user/owner
  getAll: async (req, res, next) => {
    try {
      const isMaster = req.user && req.user.role === 'master';
      const targetOwnerId = (req.user?.role === 'admin' && req.user?.created_by) ? req.user.created_by : req.userId;
      const keys = isMaster ? await ApiKey.findAll() : await ApiKey.findByOwner(targetOwnerId);
      return res.json({
        success: true,
        data: keys
      });
    } catch (error) {
      console.error('[ApiKeyController getAll Error]:', error);
      next(error);
    }
  },

  // Create new API key
  create: async (req, res, next) => {
    try {
      const { name, branch_id = null, scopes = ['*'], expires_at = null } = req.body;

      if (!name || !name.trim()) {
        return res.status(400).json({
          success: false,
          message: 'Nama integrasi API Key wajib diisi'
        });
      }

      // If branch_id specified, check ownership
      if (branch_id) {
        const hasAccess = await Branch.userHasAccess(req.userId, parseInt(branch_id), req.user.role);
        if (!hasAccess) {
          return res.status(403).json({
            success: false,
            message: 'Anda tidak memiliki akses ke cabang ini'
          });
        }
      }

      const targetOwnerId = (req.user?.role === 'admin' && req.user?.created_by) ? req.user.created_by : req.userId;

      const newKey = await ApiKey.create({
        owner_id: targetOwnerId,
        name: name.trim(),
        branch_id: branch_id ? parseInt(branch_id) : null,
        scopes: Array.isArray(scopes) ? scopes : ['*'],
        expires_at: expires_at || null
      });

      return res.status(201).json({
        success: true,
        message: 'API Key berhasil dibuat. Salin kunci ini karena tidak akan ditampilkan lagi sepenuhnya.',
        data: newKey
      });
    } catch (error) {
      console.error('[ApiKeyController create Error]:', error);
      next(error);
    }
  },

  // Revoke/Deactivate key
  revoke: async (req, res, next) => {
    try {
      const { id } = req.params;
      const isMaster = req.user && req.user.role === 'master';
      const targetOwnerId = (req.user?.role === 'admin' && req.user?.created_by) ? req.user.created_by : req.userId;
      const success = await ApiKey.revoke(id, isMaster ? null : targetOwnerId);
      if (!success) {
        return res.status(404).json({
          success: false,
          message: 'API Key tidak ditemukan atau sudah tidak aktif'
        });
      }

      return res.json({
        success: true,
        message: 'API Key berhasil dinonaktifkan'
      });
    } catch (error) {
      console.error('[ApiKeyController revoke Error]:', error);
      next(error);
    }
  },

  // Activate/Reactivate key
  activate: async (req, res, next) => {
    try {
      const { id } = req.params;
      const isMaster = req.user && req.user.role === 'master';
      const targetOwnerId = (req.user?.role === 'admin' && req.user?.created_by) ? req.user.created_by : req.userId;
      const success = await ApiKey.activate(id, isMaster ? null : targetOwnerId);
      if (!success) {
        return res.status(404).json({
          success: false,
          message: 'API Key tidak ditemukan'
        });
      }

      return res.json({
        success: true,
        message: 'API Key berhasil diaktifkan kembali'
      });
    } catch (error) {
      console.error('[ApiKeyController activate Error]:', error);
      next(error);
    }
  },

  // Delete key
  delete: async (req, res, next) => {
    try {
      const { id } = req.params;
      const isMaster = req.user && req.user.role === 'master';
      const targetOwnerId = (req.user?.role === 'admin' && req.user?.created_by) ? req.user.created_by : req.userId;
      const success = await ApiKey.delete(id, isMaster ? null : targetOwnerId);
      if (!success) {
        return res.status(404).json({
          success: false,
          message: 'API Key tidak ditemukan'
        });
      }

      return res.json({
        success: true,
        message: 'API Key berhasil dihapus'
      });
    } catch (error) {
      console.error('[ApiKeyController delete Error]:', error);
      next(error);
    }
  }
};

module.exports = apiKeyController;

