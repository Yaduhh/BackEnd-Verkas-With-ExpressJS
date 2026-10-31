const ApiKey = require('../models/ApiKey');

/**
 * Middleware to authenticate external requests using API Key
 */
const apiKeyAuth = (requiredScope = null) => {
  return async (req, res, next) => {
    try {
      const apiKeyHeader = req.headers['x-api-key'] || req.headers['X-Api-Key'] || req.headers['X-API-KEY'];
      const authHeader = req.headers.authorization || req.headers.Authorization;
      
      let apiKey = apiKeyHeader;
      if (!apiKey && authHeader && authHeader.startsWith('Bearer vk_')) {
        apiKey = authHeader.substring(7).trim();
      } else if (!apiKey && req.query.api_key) {
        apiKey = req.query.api_key;
      }

      if (!apiKey) {
        return res.status(401).json({
          success: false,
          message: 'API Key is required. Please provide X-API-Key header.'
        });
      }

      const keyData = await ApiKey.findByKey(apiKey);
      if (!keyData) {
        return res.status(401).json({
          success: false,
          message: 'Invalid or inactive API Key.'
        });
      }

      // Check scope if required
      if (requiredScope && Array.isArray(keyData.scopes)) {
        if (!keyData.scopes.includes(requiredScope) && !keyData.scopes.includes('*')) {
          return res.status(403).json({
            success: false,
            message: `API Key does not have the required permission: ${requiredScope}`
          });
        }
      }

      // Update last used asynchronously (non-blocking)
      ApiKey.updateLastUsed(keyData.id).catch(err => {
        console.error('Failed to update API key last_used_at:', err);
      });

      // Attach context to request
      req.apiKey = keyData;
      req.user = {
        id: keyData.owner_id,
        name: keyData.owner_name,
        email: keyData.owner_email,
        role: keyData.owner_role || 'owner'
      };
      req.userId = keyData.owner_id;

      // If API key is tied to a specific branch, enforce branch context
      if (keyData.branch_id) {
        const branchHeader = req.headers['x-branch-id'];
        if (branchHeader && parseInt(branchHeader) !== keyData.branch_id) {
          return res.status(403).json({
            success: false,
            message: `This API Key is restricted to Branch ID ${keyData.branch_id}`
          });
        }
        req.branchId = keyData.branch_id;
      }

      next();
    } catch (error) {
      console.error('API Key Authentication Error:', error);
      return res.status(500).json({
        success: false,
        message: 'Internal server error during authentication'
      });
    }
  };
};

module.exports = apiKeyAuth;

