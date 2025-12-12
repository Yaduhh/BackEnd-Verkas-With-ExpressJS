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
          total: result.total
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

module.exports = {
  register,
  unregister,
  getTokens,
  sendTest
};

