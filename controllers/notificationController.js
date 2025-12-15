const DeviceToken = require('../models/DeviceToken');
const expoPushService = require('../services/expoPushService');

// Register device token
const register = async (req, res, next) => {
  try {
    const { device_token, platform, device_name, app_version } = req.body;
    const userId = req.userId;

    if (!device_token) {
      return res.status(400).json({
        success: false,
        message: 'Device token is required'
      });
    }

    if (!platform || !['ios', 'android', 'web'].includes(platform)) {
      return res.status(400).json({
        success: false,
        message: 'Valid platform is required (ios, android, or web)'
      });
    }

    // Validate Expo push token format
    if (!expoPushService.isValidToken(device_token)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid Expo push token format'
      });
    }

    // Register or update device token
    const deviceToken = await DeviceToken.register({
      userId,
      deviceToken: device_token,
      platform,
      deviceName: device_name || null,
      appVersion: app_version || null
    });

    res.json({
      success: true,
      message: 'Device token registered successfully',
      data: {
        id: deviceToken.id,
        platform: deviceToken.platform,
        device_name: deviceToken.device_name
      }
    });
  } catch (error) {
    next(error);
  }
};

const unregister = async (req, res, next) => {
  try {
    const device_token = req.body?.device_token || req.query?.device_token;

    if (!device_token) {
      return res.status(400).json({
        success: false,
        message: 'Device token is required'
      });
    }

    if (req.userId) {
      await DeviceToken.unregister(req.userId, device_token);
    } else {
      await DeviceToken.unregisterByToken(device_token);
    }

    res.json({
      success: true,
      message: 'Device token unregistered successfully'
    });
  } catch (error) {
    next(error);
  }
};

// Get user's device tokens
const getTokens = async (req, res, next) => {
  try {
    const userId = req.userId;
    const tokens = await DeviceToken.findByUserId(userId);

    // Don't expose full token, just metadata
    const sanitized = tokens.map(token => ({
      id: token.id,
      platform: token.platform,
      device_name: token.device_name,
      app_version: token.app_version,
      is_active: token.is_active,
      last_used_at: token.last_used_at,
      created_at: token.created_at
    }));

    res.json({
      success: true,
      data: sanitized
    });
  } catch (error) {
    next(error);
  }
};

// Send test notification
const sendTest = async (req, res, next) => {
  try {
    const userId = req.userId;
    const { title, body, data } = req.body;

    const result = await expoPushService.sendTest(userId, {
      title: title || 'Test Notification',
      body: body || 'This is a test notification from VERKAS',
      data: data || {}
    });

    if (result.success) {
      res.json({
        success: true,
        message: `Test notification sent to ${result.sent} device(s)`,
        data: {
          sent: result.sent,
          total: result.total,
          tickets: result.tickets
        }
      });
    } else {
      res.status(400).json({
        success: false,
        message: result.message || 'Failed to send test notification',
        data: result
      });
    }
  } catch (error) {
    next(error);
  }
};

// Check device token status (for debugging)
const checkStatus = async (req, res, next) => {
  try {
    const userId = req.userId;
    const tokens = await DeviceToken.findByUserId(userId);
    
    // Check token validity and test sending
    const tokenStatus = tokens.map(token => {
      const isValid = expoPushService.isValidToken(token.device_token);
      const tokenPreview = token.device_token ? token.device_token.substring(0, 30) + '...' : 'N/A';
      
      // Check token format
      let formatCheck = 'unknown';
      if (token.device_token) {
        if (token.device_token.startsWith('ExponentPushToken[')) {
          formatCheck = 'valid_expo_format';
        } else if (token.device_token.startsWith('ExpoPushToken[')) {
          formatCheck = 'valid_expo_format_alt';
        } else {
          formatCheck = 'invalid_format';
        }
      }
      
      return {
        id: token.id,
        platform: token.platform,
        device_name: token.device_name,
        app_version: token.app_version,
        is_active: token.is_active,
        is_valid: isValid,
        format_check: formatCheck,
        token_preview: tokenPreview,
        token_length: token.device_token ? token.device_token.length : 0,
        last_used_at: token.last_used_at,
        created_at: token.created_at
      };
    });

    // Check backend configuration
    const backendConfig = {
      hasExpoAccessToken: !!process.env.EXPO_ACCESS_TOKEN,
      nodeEnv: process.env.NODE_ENV,
      expoAccessTokenLength: process.env.EXPO_ACCESS_TOKEN ? process.env.EXPO_ACCESS_TOKEN.length : 0
    };

    res.json({
      success: true,
      data: {
        total: tokens.length,
        active: tokens.filter(t => t.is_active).length,
        valid: tokens.filter(t => t.is_active && expoPushService.isValidToken(t.device_token)).length,
        backend_config: backendConfig,
        tokens: tokenStatus
      }
    });
  } catch (error) {
    next(error);
  }
};

// Test send notification (for debugging production issues)
const testSend = async (req, res, next) => {
  try {
    const userId = req.userId;
    const { title, body } = req.body;

    // Get tokens for debugging
    const tokens = await DeviceToken.findActiveByUserId(userId);
    
    const result = await expoPushService.sendTest(userId, {
      title: title || 'Test Notification',
      body: body || 'This is a test notification from VERKAS',
      data: {
        test: true,
        timestamp: new Date().toISOString()
      }
    });

    res.json({
      success: result.success,
      message: result.success 
        ? `Test notification sent to ${result.sent} device(s)` 
        : result.message || 'Failed to send test notification',
      data: {
        sent: result.sent,
        total: result.total,
        tickets: result.tickets || [],
        tokens_found: tokens.length,
        tokens_preview: tokens.map(t => ({
          platform: t.platform,
          is_valid: expoPushService.isValidToken(t.device_token),
          token_preview: t.device_token?.substring(0, 30) + '...'
        }))
      }
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  register,
  unregister,
  getTokens,
  sendTest,
  checkStatus,
  testSend
};

