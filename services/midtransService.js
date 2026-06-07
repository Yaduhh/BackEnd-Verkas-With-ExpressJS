const midtransClient = require('midtrans-client');
const crypto = require('crypto');
const config = require('../config/config');

// Initialize Snap client
const snap = new midtransClient.Snap({
  isProduction: config.midtrans.isProduction,
  serverKey: config.midtrans.serverKey,
  clientKey: config.midtrans.clientKey
});

/**
 * Validate Midtrans Configuration
 */
function validateConfig() {
  if (!config.midtrans.serverKey || config.midtrans.serverKey === 'SB-Mid-server-DummyKey') {
    console.warn('⚠️ Warning: MIDTRANS_SERVER_KEY is set to dummy key or not configured. Payments will fail.');
  }
}

/**
 * Create Snap Transaction
 * @param {Object} params
 * @param {string} params.orderId - Unique order identifier
 * @param {number} params.grossAmount - Gross amount of transaction
 * @param {Object} params.customerDetails - Customer details (name, email, phone)
 * @returns {Promise<Object>} Snap transaction response { token, redirect_url }
 */
async function createSnapTransaction({ orderId, grossAmount, customerDetails }) {
  try {
    validateConfig();

    const parameter = {
      transaction_details: {
        order_id: orderId,
        gross_amount: Math.round(grossAmount) // Midtrans requires integer for gross_amount
      },
      customer_details: {
        first_name: customerDetails.name,
        email: customerDetails.email,
        phone: customerDetails.phone || undefined
      },
      // Optional: limit payment methods if needed, otherwise displays all active methods in Midtrans Snap
      credit_card: {
        secure: true
      }
    };

    console.log('📤 Creating Midtrans Snap Transaction:', {
      orderId,
      grossAmount,
      customerName: customerDetails.name
    });

    const transaction = await snap.createTransaction(parameter);
    return {
      token: transaction.token,
      redirect_url: transaction.redirect_url
    };
  } catch (error) {
    console.error('❌ Midtrans createSnapTransaction Error:', error.message);
    throw new Error(`Failed to create Midtrans transaction: ${error.message}`);
  }
}

/**
 * Verify Webhook Signature Key manually
 * Signature format: SHA512(order_id + status_code + gross_amount + server_key)
 * @param {Object} payload - Midtrans webhook body
 * @returns {boolean} True if signature matches
 */
function verifyWebhookSignature(payload) {
  try {
    const { order_id, status_code, gross_amount, signature_key } = payload;
    const serverKey = config.midtrans.serverKey;

    const inputStr = `${order_id}${status_code}${gross_amount}${serverKey}`;
    const calculatedSignature = crypto
      .createHash('sha512')
      .update(inputStr)
      .digest('hex');

    const isValid = calculatedSignature === signature_key;

    console.log('🔍 Midtrans Webhook Signature verification:', {
      order_id,
      isValid
    });

    return isValid;
  } catch (error) {
    console.error('❌ Error verifying Midtrans Webhook signature:', error.message);
    return false;
  }
}

/**
 * Cancel Snap Transaction in Midtrans
 * @param {string} orderId
 */
async function cancelTransaction(orderId) {
  try {
    validateConfig();
    const result = await snap.transaction.cancel(orderId);
    return result;
  } catch (error) {
    console.error('❌ Midtrans cancelTransaction Error:', error.message);
    throw error;
  }
}

module.exports = {
  createSnapTransaction,
  verifyWebhookSignature,
  cancelTransaction
};
