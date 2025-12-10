// Import xendit-node
const { Xendit } = require('xendit-node');
const config = require('../config/config');

// Initialize Xendit client
const xenditClient = new Xendit({
  secretKey: config.xendit.secretKey,
});

// For Virtual Account, E-Wallet, and QRIS, we'll use REST API directly
const axios = require('axios');

const XENDIT_API_BASE = 'https://api.xendit.co';

/**
 * Validate Xendit API Key
 */
function validateApiKey() {
  if (!config.xendit.secretKey) {
    throw new Error('XENDIT_SECRET_KEY tidak ditemukan di environment variables. Pastikan sudah di-set di file .env');
  }
  
  if (!config.xendit.secretKey.startsWith('xnd_development_') && !config.xendit.secretKey.startsWith('xnd_production_')) {
    throw new Error('Format XENDIT_SECRET_KEY tidak valid. Harus dimulai dengan xnd_development_ atau xnd_production_');
  }
  
  console.log('✅ Xendit API Key validated:', config.xendit.secretKey.substring(0, 20) + '...');
}

/**
 * Create Virtual Account using REST API
 * Documentation: https://docs.xendit.co/api-reference/#virtual-accounts
 * Note: For test mode, some features might be limited
 */
async function createVirtualAccount({ 
  externalId, 
  bankCode, 
  name, 
  expectedAmount,
  expirationDate 
}) {
  try {
    // Validate API key first
    validateApiKey();
    
    // Ensure expectedAmount is a number, not string
    const amount = typeof expectedAmount === 'string' ? parseFloat(expectedAmount) : expectedAmount;
    
    if (isNaN(amount) || amount <= 0) {
      throw new Error('expectedAmount harus berupa angka positif');
    }
    
    // Format expiration_date properly (ISO 8601)
    let expDate = null;
    if (expirationDate) {
      const date = new Date(expirationDate);
      if (isNaN(date.getTime())) {
        throw new Error('expirationDate format tidak valid');
      }
      expDate = date.toISOString();
    } else {
      // Default: 24 hours from now
      const defaultExp = new Date();
      defaultExp.setHours(defaultExp.getHours() + 24);
      expDate = defaultExp.toISOString();
    }
    
    // Prepare request body
    // According to Xendit docs, Virtual Account can be Fixed (FVA) or Non-Fixed
    // For Non-Fixed VA (single use), we use these parameters
    const requestBody = {
      external_id: externalId,
      bank_code: bankCode.toUpperCase(), // BCA, BNI, BRI, MANDIRI, PERMATA
      name: name,
      expected_amount: amount, // Must be number
      expiration_date: expDate, // ISO 8601 format
      is_single_use: true,
      is_closed: true, // Close VA after payment received
    };
    
    // Prepare auth header
    const authHeader = Buffer.from(config.xendit.secretKey + ':').toString('base64');
    
    console.log('📤 Creating Virtual Account:', {
      url: `${XENDIT_API_BASE}/virtual_accounts`,
      bank_code: bankCode.toUpperCase(),
      amount: amount,
      external_id: externalId,
      request_body: requestBody,
    });
    
    // Try different endpoints - Xendit might use different endpoints
    let response;
    let lastError;
    
    // Try different endpoints according to Xendit documentation
    // Based on official docs: https://developers.xendit.co/api-reference/#create-fixed-virtual-account
    const endpoints = [
      'callback_virtual_accounts', // For Fixed VA (FVA) - official endpoint
      'virtual_accounts', // Standard endpoint for Non-Fixed VA
      'v2/virtual_accounts', // v2 endpoint
    ];
    
    for (const endpoint of endpoints) {
      try {
        console.log(`🔄 Trying endpoint: ${endpoint}`);
        response = await axios.post(
          `${XENDIT_API_BASE}/${endpoint}`,
          requestBody,
          {
            headers: {
              'Authorization': `Basic ${authHeader}`,
              'Content-Type': 'application/json',
            },
            validateStatus: function (status) {
              return status < 500; // Don't throw for 4xx errors
            },
          }
        );
        
        // If successful, break
        if (response.status < 400) {
          console.log(`✅ Success with endpoint: ${endpoint}`);
          break;
        }
        
        // If 404, try next endpoint
        if (response.status === 404) {
          console.log(`⚠️ Endpoint ${endpoint} returned 404, trying next...`);
          lastError = response.data;
          continue;
        }
        
        // For other errors, break and handle
        break;
      } catch (error) {
        if (error.response?.status === 404) {
          console.log(`⚠️ Endpoint ${endpoint} returned 404, trying next...`);
          lastError = error.response?.data;
          continue;
        }
        throw error;
      }
    }
    
    // Check for errors in response
    if (response.status >= 400) {
      const errorData = response.data || {};
      console.error('❌ Xendit VA API Error:', {
        status: response.status,
        error_code: errorData.error_code,
        message: errorData.message,
        errors: errorData.errors,
      });
      
      if (response.status === 401 || response.status === 403) {
        throw new Error(
          'API Key tidak valid atau tidak punya izin. ' +
          'Pastikan: 1) API Key benar, 2) API Key punya izin Write untuk Virtual Account, ' +
          '3) Cek di Settings → API Keys di dashboard.xendit.co'
        );
      }
      
      if (response.status === 404) {
        throw new Error(
          'Endpoint tidak ditemukan. ' +
          'Kemungkinan: 1) API Key tidak punya akses, 2) Virtual Account belum diaktifkan, ' +
          '3) Hubungi support@xendit.co untuk aktivasi'
        );
      }
      
      throw new Error(errorData.message || `Xendit API Error: ${response.status}`);
    }

    // Parse response - callback_virtual_accounts might have different structure
    const responseData = response.data;
    
    console.log('📥 Xendit VA Response:', JSON.stringify(responseData, null, 2));
    
    // Handle different response structures
    // For callback_virtual_accounts, response might be nested
    let vaData;
    
    if (responseData.virtual_account) {
      // Nested structure
      const va = responseData.virtual_account;
      vaData = {
        id: va.id || responseData.id,
        accountNumber: va.account_number || va.virtual_account_number,
        bankCode: va.bank_code,
        name: va.name || va.customer_name || responseData.name,
        expectedAmount: va.expected_amount || va.amount || responseData.amount,
        expirationDate: va.expiration_date || va.expires_at || responseData.expiration_date,
        status: va.status || responseData.status || 'PENDING',
      };
    } else {
      // Flat structure
      vaData = {
        id: responseData.id || responseData.virtual_account_id,
        accountNumber: responseData.account_number || responseData.virtual_account_number,
        bankCode: responseData.bank_code,
        name: responseData.name || responseData.customer_name,
        expectedAmount: responseData.expected_amount || responseData.amount,
        expirationDate: responseData.expiration_date || responseData.expires_at,
        status: responseData.status || 'PENDING',
      };
    }
    
    // Validate required fields
    if (!vaData.id) {
      throw new Error('Virtual Account ID not found in response');
    }
    if (!vaData.accountNumber) {
      throw new Error('Virtual Account number not found in response');
    }
    if (!vaData.bankCode) {
      throw new Error('Bank code not found in response');
    }
    
    console.log('✅ Virtual Account created:', {
      id: vaData.id,
      account_number: vaData.accountNumber,
      bank_code: vaData.bankCode,
    });
    
    return vaData;
  } catch (error) {
    console.error('Xendit VA Error Details:', {
      status: error.response?.status,
      data: error.response?.data,
      message: error.message,
      url: `${XENDIT_API_BASE}/virtual_accounts`,
      body: {
        external_id: externalId,
        bank_code: bankCode,
        name: name,
        expected_amount: expectedAmount,
        expiration_date: expirationDate,
      }
    });
    
    // Provide more helpful error message
    if (error.response?.status === 404) {
      const errorDetails = error.response?.data || {};
      if (errorDetails.error_code === 'NOT_FOUND') {
        throw new Error(
          'Virtual Account tidak tersedia. ' +
          'Kemungkinan: 1) Virtual Account belum diaktifkan di Xendit Dashboard, ' +
          '2) Test key tidak support Virtual Account, atau ' +
          '3) Perlu aktivasi khusus. ' +
          'Solusi: Login ke dashboard.xendit.co → Settings → Products → Enable Virtual Accounts, ' +
          'atau hubungi support@xendit.co untuk aktivasi.'
        );
      }
      throw new Error('Virtual Account endpoint not found. Please check if Virtual Account is enabled in your Xendit Dashboard or contact Xendit support.');
    }
    if (error.response?.status === 403) {
      throw new Error('Virtual Account requires special permissions. Please enable Virtual Account in your Xendit Dashboard.');
    }
    if (error.response?.status === 400) {
      const errorMsg = error.response?.data?.message || 'Invalid request parameters';
      throw new Error(`Virtual Account validation error: ${errorMsg}. Check: bank_code, expected_amount, and expiration_date.`);
    }
    
    // Re-throw if it's already our custom error
    if (error.message.includes('API Key') || error.message.includes('Endpoint')) {
      throw error;
    }
    
    throw new Error(`Failed to create Virtual Account: ${error.response?.data?.message || error.message}`);
  }
}

/**
 * Create E-Wallet Payment using REST API
 * Documentation: https://docs.xendit.co/api-reference/#ewallets
 * Note: For test mode, some e-wallets might not be available
 */
async function createEwalletPayment({
  externalId,
  amount,
  phone,
  ewalletType, // OVO, DANA, LINKAJA, SHOPEEPAY
  callbackUrl,
  redirectUrl,
}) {
  try {
    // Validate API key first
    validateApiKey();
    
    // Map ewallet type to Xendit channel_code
    // Based on official Xendit documentation: https://docs.xendit.co/api-reference/#ewallets
    const channelCodes = {
      'OVO': 'ID_OVO',
      'DANA': 'ID_DANA',
      'LINKAJA': 'ID_LINKAJA',
      'SHOPEEPAY': 'ID_SHOPEEPAY',
    };

    const channelCode = channelCodes[ewalletType.toUpperCase()];
    if (!channelCode) {
      throw new Error(`Unsupported e-wallet type: ${ewalletType}. Supported: OVO, DANA, LINKAJA, SHOPEEPAY`);
    }

    // Ensure amount is a number, not string
    const amountNum = typeof amount === 'string' ? parseFloat(amount) : amount;
    
    if (isNaN(amountNum) || amountNum <= 0) {
      throw new Error('amount harus berupa angka positif');
    }
    
    // Format phone number according to Xendit documentation
    // Xendit requires E.164 format: +[country code][number]
    // For Indonesia: +62[number without leading 0]
    // Example: 081234567890 -> +6281234567890
    // Regex validation: ^\\+?[1-9]\\d{1,14}$ (must start with 1-9, not 0!)
    let formattedPhone = null;
    if (phone) {
      // Remove all non-digit characters except +
      let cleaned = phone.replace(/[^\d+]/g, '');
      
      // If starts with 0, replace with +62 (Indonesia country code)
      if (cleaned.startsWith('0')) {
        cleaned = '+62' + cleaned.substring(1);
      }
      // If starts with 62 but no +, add +
      else if (cleaned.startsWith('62') && !cleaned.startsWith('+62')) {
        cleaned = '+' + cleaned;
      }
      // If doesn't start with +, add +62
      else if (!cleaned.startsWith('+')) {
        cleaned = '+62' + cleaned;
      }
      // If already has + but starts with +0, replace with +62
      else if (cleaned.startsWith('+0')) {
        cleaned = '+62' + cleaned.substring(2);
      }
      
      formattedPhone = cleaned;
    }
    
    // Xendit e-wallet API format according to official documentation
    // Endpoint: POST https://api.xendit.co/ewallets/charges
    // Reference: https://docs.xendit.co/api-reference/#ewallets
    const requestBody = {
      reference_id: externalId, // Required: unique reference ID
      currency: 'IDR', // Required: currency code
      amount: amountNum, // Required: amount as number
      checkout_method: 'ONE_TIME_PAYMENT', // Required: checkout method
      channel_code: channelCode, // Required: e-wallet channel code (ID_OVO, ID_DANA, etc.)
      channel_properties: {}, // Required: channel properties object
    };
    
    // Channel properties vary by e-wallet type
    // According to Xendit docs:
    // - OVO requires: mobile_number in E.164 format (+6281234567890)
    // - DANA, LinkAja, ShopeePay: check documentation for specific requirements
    
    // OVO requires mobile_number in E.164 format - MANDATORY!
    // If no phone provided for OVO, throw error
    if (channelCode === 'ID_OVO') {
      if (!formattedPhone) {
        throw new Error('Nomor telepon wajib untuk pembayaran OVO. Silakan input nomor telepon terlebih dahulu.');
      }
      requestBody.channel_properties.mobile_number = formattedPhone;
    }
    // DANA, LinkAja, ShopeePay: phone is NOT supported in channel_properties
    
    // Add redirect URL to channel_properties if provided
    // This is supported for most e-wallets
    if (redirectUrl) {
      requestBody.channel_properties.success_redirect_url = redirectUrl;
    }
    
    // Add callback URL if provided (for webhook)
    if (callbackUrl) {
      requestBody.callback_url = callbackUrl;
    }
    
    // Prepare auth header
    const authHeader = Buffer.from(config.xendit.secretKey + ':').toString('base64');
    
    // Official Xendit endpoint for E-Wallet charges
    // Documentation: https://docs.xendit.co/api-reference/#ewallets
    const endpoint = 'ewallets/charges';
    
    console.log('📤 Creating E-Wallet Payment (official endpoint):', {
      url: `${XENDIT_API_BASE}/${endpoint}`,
      ewallet_type: ewalletType,
      channel_code: channelCode,
      amount: amountNum,
      reference_id: externalId,
      channel_properties: requestBody.channel_properties,
    });
    
    const response = await axios.post(
      `${XENDIT_API_BASE}/${endpoint}`,
      requestBody,
      {
        headers: {
          'Authorization': `Basic ${authHeader}`,
          'Content-Type': 'application/json',
        },
        validateStatus: function (status) {
          return status < 500; // Don't throw for 4xx errors
        },
      }
    );
    
    // Check for errors in response
    if (response.status >= 400) {
      const errorData = response.data || {};
      console.error('❌ Xendit E-Wallet API Error:', {
        status: response.status,
        error_code: errorData.error_code,
        message: errorData.message,
        errors: errorData.errors,
        request_body: requestBody,
      });
      
      if (response.status === 401 || response.status === 403) {
        throw new Error(
          'API Key tidak valid atau tidak punya izin. ' +
          'Pastikan: 1) API Key benar, 2) API Key punya izin Write untuk E-Wallet, ' +
          '3) Cek di Settings → API Keys di dashboard.xendit.co'
        );
      }
      
      if (response.status === 404) {
        const errorCode = errorData.error_code;
        if (errorCode === 'CALLBACK_URL_NOT_FOUND') {
          throw new Error(
            'Callback URL belum di-set di Xendit Dashboard. ' +
            'Solusi: Login ke dashboard.xendit.co → Settings → Webhooks → ' +
            'Tambahkan callback URL: ' + (callbackUrl || 'your_webhook_url') + ' ' +
            'atau hubungi support@xendit.co untuk bantuan.'
          );
        }
        throw new Error(
          `E-Wallet ${ewalletType} (${channelCode}) tidak ditemukan. ` +
          'Kemungkinan: 1) E-Wallet belum diaktifkan di dashboard, ' +
          '2) Test mode tidak support E-Wallet ini, ' +
          '3) Perlu aktivasi khusus dari Xendit. ' +
          'Solusi: Cek di Settings → Channel Pembayaran, atau hubungi support@xendit.co'
        );
      }
      
      if (response.status === 400) {
        const errorMsg = errorData.message || 'Invalid request parameters';
        const errorDetails = errorData.errors ? JSON.stringify(errorData.errors) : '';
        throw new Error(
          `E-Wallet validation error: ${errorMsg}. ${errorDetails} ` +
          'Check: reference_id, currency, amount, checkout_method, channel_code, channel_properties.'
        );
      }
      
      throw new Error(errorData.message || `Xendit API Error: ${response.status}`);
    }

    console.log('✅ E-Wallet Payment created successfully:', {
      id: response.data.id,
      reference_id: response.data.reference_id,
      status: response.data.status,
    });
    
    // Parse response according to Xendit API format
    // Response structure: https://docs.xendit.co/api-reference/#ewallets
    const responseData = response.data;
    
    return {
      id: responseData.id,
      referenceId: responseData.reference_id,
      amount: responseData.amount,
      status: responseData.status,
      checkoutUrl: responseData.actions?.mobile_deeplink_checkout_url || 
                   responseData.actions?.mobile_web_checkout_url || 
                   responseData.actions?.desktop_web_checkout_url ||
                   responseData.checkout_url || 
                   null,
      ewalletType: ewalletType,
      channelCode: responseData.channel_code,
    };
  } catch (error) {
    console.error('❌ Xendit E-Wallet Error:', {
      message: error.message,
      status: error.response?.status,
      data: error.response?.data,
      ewalletType: ewalletType,
    });
    
    // Re-throw if it's already our custom error
    if (error.message.includes('API Key') || error.message.includes('Endpoint') || error.message.includes('Unsupported')) {
      throw error;
    }
    
    // For axios errors
    if (error.response) {
      const errorData = error.response.data || {};
      throw new Error(errorData.message || `Xendit API Error: ${error.response.status}`);
    }
    if (error.response?.status === 403) {
      throw new Error(`E-Wallet ${ewalletType} requires special permissions. Please enable ${ewalletType} in your Xendit Dashboard.`);
    }
    if (error.response?.status === 400) {
      const errorMsg = error.response?.data?.message || 'Invalid request parameters';
      throw new Error(`E-Wallet validation error: ${errorMsg}. Check: phone number format and amount.`);
    }
    
    throw new Error(`Failed to create E-Wallet payment: ${error.response?.data?.message || error.message}`);
  }
}

/**
 * Create QRIS Payment using REST API
 * Documentation: https://docs.xendit.co/api-reference/#qr-codes
 * Note: QRIS might require special permissions in Xendit Dashboard
 */
async function createQrisPayment({
  externalId,
  amount,
  callbackUrl,
}) {
  try {
    // Ensure amount is a number, not string
    const amountNum = typeof amount === 'string' ? parseFloat(amount) : amount;
    
    const response = await axios.post(
      `${XENDIT_API_BASE}/qr_codes`,
      {
        reference_id: externalId,
        type: 'DYNAMIC',
        callback_url: callbackUrl,
        amount: amountNum, // Must be number
      },
      {
        headers: {
          'Authorization': `Basic ${Buffer.from(config.xendit.secretKey + ':').toString('base64')}`,
          'Content-Type': 'application/json',
        },
      }
    );

    return {
      id: response.data.id,
      referenceId: response.data.reference_id,
      qrString: response.data.qr_string,
      amount: response.data.amount,
      status: response.data.status,
      expiresAt: response.data.expires_at,
    };
  } catch (error) {
    console.error('Xendit QRIS Error:', error.response?.data || error.message);
    if (error.response?.status === 403) {
      throw new Error('QRIS payment requires special permissions. Please enable QRIS in your Xendit Dashboard or contact Xendit support.');
    }
    throw new Error(`Failed to create QRIS payment: ${error.response?.data?.message || error.message}`);
  }
}

/**
 * Get Payment Status using REST API
 */
async function getPaymentStatus(paymentId, paymentMethod) {
  try {
    validateApiKey();
    
    let response;
    const authHeader = Buffer.from(config.xendit.secretKey + ':').toString('base64');
    
    switch (paymentMethod) {
      case 'virtual_account':
        // Try different endpoints for Virtual Account status
        // Since we created with callback_virtual_accounts, try that first
        const vaEndpoints = [
          `callback_virtual_accounts/${paymentId}`, // For Fixed VA
          `virtual_accounts/${paymentId}`, // Standard endpoint
          `v2/virtual_accounts/${paymentId}`, // v2 endpoint
        ];
        
        let lastError;
        for (const endpoint of vaEndpoints) {
          try {
            console.log(`🔍 Getting VA status from: ${endpoint}`);
            response = await axios.get(
              `${XENDIT_API_BASE}/${endpoint}`,
              {
                headers: {
                  'Authorization': `Basic ${authHeader}`,
                },
                validateStatus: function (status) {
                  return status < 500; // Don't throw for 4xx errors
                },
              }
            );
            
            if (response.status < 400) {
              console.log(`✅ VA status found from: ${endpoint}`);
              break;
            }
            
            if (response.status === 404) {
              console.log(`⚠️ Endpoint ${endpoint} returned 404, trying next...`);
              lastError = response.data;
              continue;
            }
            
            // For other errors, break and handle
            break;
          } catch (error) {
            if (error.response?.status === 404) {
              console.log(`⚠️ Endpoint ${endpoint} returned 404, trying next...`);
              lastError = error.response?.data;
              continue;
            }
            throw error;
          }
        }
        
        if (!response || response.status >= 400) {
          throw new Error(
            `Virtual Account status not found. ` +
            `Kemungkinan: 1) VA ID tidak valid, 2) VA sudah expired, ` +
            `3) Endpoint tidak tersedia. Cek di Xendit Dashboard.`
          );
        }
        
        // Parse response - handle different structures
        const responseData = response.data;
        const vaData = responseData.virtual_account || responseData;
        
        return {
          id: vaData.id || responseData.id,
          status: vaData.status || responseData.status,
          amount: vaData.expected_amount || vaData.amount || responseData.expected_amount,
          accountNumber: vaData.account_number || responseData.account_number,
          bankCode: vaData.bank_code || responseData.bank_code,
          paidAt: vaData.paid_at || responseData.paid_at,
        };
        
      case 'ewallet':
        // E-Wallet status is usually checked via webhook
        throw new Error('E-Wallet status should be checked via webhook');
        
      case 'qris':
        response = await axios.get(
          `${XENDIT_API_BASE}/qr_codes/${paymentId}`,
          {
            headers: {
              'Authorization': `Basic ${Buffer.from(config.xendit.secretKey + ':').toString('base64')}`,
            },
          }
        );
        return {
          id: response.data.id,
          status: response.data.status,
          amount: response.data.amount,
          qrString: response.data.qr_string,
          expiresAt: response.data.expires_at,
        };
        
      default:
        throw new Error(`Unsupported payment method: ${paymentMethod}`);
    }
  } catch (error) {
    console.error('Xendit Get Status Error:', error.response?.data || error.message);
    throw new Error(`Failed to get payment status: ${error.response?.data?.message || error.message}`);
  }
}

/**
 * Verify Webhook Signature
 */
function verifyWebhookSignature(token, body) {
  return token === config.xendit.webhookToken;
}

module.exports = {
  createVirtualAccount,
  createEwalletPayment,
  createQrisPayment,
  getPaymentStatus,
  verifyWebhookSignature,
};
