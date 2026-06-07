const Payment = require('../models/Payment');
const Subscription = require('../models/Subscription');
const xenditService = require('../services/xenditService');
const config = require('../config/config');

// Get pending payments (owner and co-owner)
const getPending = async (req, res, next) => {
  try {
    if (req.user.role !== 'owner' && req.user.role !== 'co-owner') {
      return res.status(403).json({
        success: false,
        message: 'Only owners and co-owners can view payments'
      });
    }
    
    // For co-owner, get payments from the owner who created them
    let targetUserId = req.userId;
    if (req.user.role === 'co-owner' && req.user.created_by) {
      targetUserId = req.user.created_by;
    }
    
    const payments = await Payment.getPendingPayments(targetUserId);
    
    res.json({
      success: true,
      data: { payments }
    });
  } catch (error) {
    next(error);
  }
};

// Get all payments (owner and co-owner)
const getAll = async (req, res, next) => {
  try {
    if (req.user.role !== 'owner' && req.user.role !== 'co-owner') {
      return res.status(403).json({
        success: false,
        message: 'Only owners and co-owners can view payments'
      });
    }
    
    // For co-owner, get payments from the owner who created them
    let targetUserId = req.userId;
    if (req.user.role === 'co-owner' && req.user.created_by) {
      targetUserId = req.user.created_by;
    }
    
    const payments = await Payment.getAllPayments(targetUserId);
    
    res.json({
      success: true,
      data: { payments }
    });
  } catch (error) {
    next(error);
  }
};

// Get payment by ID
const getById = async (req, res, next) => {
  try {
    const { id } = req.params;
    const payment = await Payment.findById(id);
    
    if (!payment) {
      return res.status(404).json({
        success: false,
        message: 'Payment not found'
      });
    }
    
    // Check ownership
    if (payment.user_id !== req.userId) {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }
    
    res.json({
      success: true,
      data: { payment }
    });
  } catch (error) {
    next(error);
  }
};

// Verify payment (webhook from payment gateway)
const verify = async (req, res, next) => {
  try {
    const { transaction_id, status, amount } = req.body;
    
    if (!transaction_id) {
      return res.status(400).json({
        success: false,
        message: 'Transaction ID is required'
      });
    }
    
    // Find payment by transaction ID
    const payment = await Payment.findByTransactionId(transaction_id);
    if (!payment) {
      return res.status(404).json({
        success: false,
        message: 'Payment not found'
      });
    }
    
    // Verify amount matches
    if (amount && parseFloat(amount) !== parseFloat(payment.amount)) {
      return res.status(400).json({
        success: false,
        message: 'Payment amount mismatch'
      });
    }
    
    // Update payment status
    if (status === 'paid' && payment.status === 'pending') {
      const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
      await Payment.updateStatus(payment.id, 'paid', transaction_id, now);
      
      // Activate or extend subscription
      const subscription = await Subscription.activateOrExtend(payment.subscription_id);
      
      // Send notification to user - NON-BLOCKING
      setImmediate(async () => {
        try {
          const notificationQueue = require('../services/notificationQueue');
          const SubscriptionPlan = require('../models/SubscriptionPlan');
          const plan = await SubscriptionPlan.findById(subscription.plan_id);
          
          const amount = new Intl.NumberFormat('id-ID', {
            style: 'currency',
            currency: 'IDR',
            minimumFractionDigits: 0
          }).format(payment.amount);
          
          // Queue notification (non-blocking)
          notificationQueue.enqueue({
            userId: subscription.user_id,
            title: 'Pembayaran Berhasil',
            body: `Pembayaran subscription ${plan?.name || 'Plan'} sebesar ${amount} telah berhasil`,
            data: {
              screen: 'subscription',
              paymentId: payment.id,
              subscriptionId: subscription.id,
              type: 'payment_success',
            },
          });
        } catch (notifError) {
          console.error('Error queuing notification:', notifError);
        }
      });
    } else if (status === 'failed') {
      await Payment.updateStatus(payment.id, 'failed', transaction_id);
      
      // Send notification to user - NON-BLOCKING
      setImmediate(async () => {
        try {
          const notificationQueue = require('../services/notificationQueue');
          const subscription = await Subscription.findById(payment.subscription_id);
          
          const amount = new Intl.NumberFormat('id-ID', {
            style: 'currency',
            currency: 'IDR',
            minimumFractionDigits: 0
          }).format(payment.amount);
          
          // Queue notification (non-blocking)
          notificationQueue.enqueue({
            userId: subscription.user_id,
            title: 'Pembayaran Gagal',
            body: `Pembayaran sebesar ${amount} gagal. Silakan coba lagi.`,
            data: {
              screen: 'payment',
              paymentId: payment.id,
              type: 'payment_failed',
            },
          });
        } catch (notifError) {
          console.error('Error queuing notification:', notifError);
        }
      });
    }
    
    res.json({
      success: true,
      message: 'Payment verified successfully'
    });
  } catch (error) {
    next(error);
  }
};

// Update payment status manually (for manual payment confirmation)
const updateStatus = async (req, res, next) => {
  try {
    if (req.user.role !== 'owner' && req.user.role !== 'co-owner') {
      return res.status(403).json({
        success: false,
        message: 'Only owners and co-owners can update payment status'
      });
    }
    
    const { id } = req.params;
    const { status, transaction_id } = req.body;
    
    const payment = await Payment.findById(id);
    if (!payment || payment.user_id !== req.userId) {
      return res.status(404).json({
        success: false,
        message: 'Payment not found'
      });
    }
    
    if (!['pending', 'paid', 'failed', 'refunded'].includes(status)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid payment status'
      });
    }
    
    const updatedPayment = await Payment.updateStatus(id, status, transaction_id);
    
    // If paid, activate subscription
    if (status === 'paid' && payment.status === 'pending') {
      await Subscription.activateOrExtend(payment.subscription_id);
    }
    
    res.json({
      success: true,
      message: 'Payment status updated successfully',
      data: { payment: updatedPayment }
    });
  } catch (error) {
    next(error);
  }
};

// Create Xendit payment
const createXenditPayment = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { 
      payment_method, 
      ewallet_type, 
      virtual_account_bank,
      customer_name,
      customer_email,
      customer_phone 
    } = req.body;

    // Get payment
    const payment = await Payment.findById(id);
    if (!payment || payment.user_id !== req.userId) {
      return res.status(404).json({
        success: false,
        message: 'Payment not found'
      });
    }

    // Check if payment already has Xendit transaction
    if (payment.payment_provider === 'xendit' && payment.transaction_id) {
      return res.status(400).json({
        success: false,
        message: 'Payment already has Xendit transaction'
      });
    }

    // Create external ID
    const externalId = `PAYMENT_${payment.id}_${Date.now()}`;
    
    // Calculate expiration date (24 hours from now)
    // Format: ISO 8601 string (required by Xendit)
    const expirationDate = new Date();
    expirationDate.setHours(expirationDate.getHours() + 24);
    const expirationDateISO = expirationDate.toISOString();

    let xenditResponse;
    let paymentMethod = payment_method;

    // Create payment based on method
    switch (payment_method) {
      case 'virtual_account':
        if (!virtual_account_bank) {
          return res.status(400).json({
            success: false,
            message: 'Bank code is required for Virtual Account'
          });
        }

        xenditResponse = await xenditService.createVirtualAccount({
          externalId,
          bankCode: virtual_account_bank,
          name: customer_name || 'Customer',
          expectedAmount: parseFloat(payment.amount), // Ensure it's a number
          expirationDate: expirationDateISO,
        });

        // Update payment with Xendit info
        try {
          console.log('📝 Updating payment:', {
            payment_id: payment.id,
            xendit_id: xenditResponse.id,
            account_number: xenditResponse.accountNumber,
          });
          
          await Payment.updateStatus(payment.id, 'pending', xenditResponse.id);
          await Payment.updateInvoiceUrl(payment.id, null);
          
          // Update payment provider and Xendit details
          await require('../config/database').query(
            'UPDATE payments SET payment_provider = ?, payment_method = ? WHERE id = ?',
            ['xendit', 'bank_transfer', payment.id]
          );
          
          // Save Xendit-specific data
          await Payment.updateXenditDetails(payment.id, {
            accountNumber: xenditResponse.accountNumber,
            bankCode: xenditResponse.bankCode,
            expiresAt: xenditResponse.expirationDate,
          });

          // Reload payment to get updated data
          console.log('🔍 Reloading payment:', payment.id);
          const updatedPayment = await Payment.findById(payment.id);
          
          if (!updatedPayment) {
            console.error('❌ Payment not found after update:', {
              payment_id: payment.id,
              user_id: payment.user_id,
              subscription_id: payment.subscription_id,
            });
            
            // Try to get payment directly from database
            const db = require('../config/database');
            const directResult = await db.query(
              'SELECT * FROM payments WHERE id = ?',
              [payment.id]
            );
            
            if (directResult.length > 0) {
              console.log('✅ Payment found in database directly');
              // Payment exists but JOIN might be failing
              // Return with xendit data anyway
              return res.json({
                success: true,
                message: 'Virtual Account created successfully',
                data: {
                  payment: {
                    ...directResult[0],
                    user_id: payment.user_id,
                  },
                  xendit: {
                    id: xenditResponse.id,
                    account_number: xenditResponse.accountNumber,
                    bank_code: xenditResponse.bankCode,
                    expires_at: xenditResponse.expirationDate,
                    status: xenditResponse.status,
                  }
                }
              });
            }
            
            return res.status(500).json({
              success: false,
              message: 'Payment updated but not found. Please refresh the page.'
            });
          }

          console.log('✅ Payment updated successfully:', {
            payment_id: updatedPayment.id,
            status: updatedPayment.status,
            transaction_id: updatedPayment.transaction_id,
          });

          return res.json({
            success: true,
            message: 'Virtual Account created successfully',
            data: {
              payment: updatedPayment,
              xendit: {
                id: xenditResponse.id,
                account_number: xenditResponse.accountNumber,
                bank_code: xenditResponse.bankCode,
                expires_at: xenditResponse.expirationDate,
                status: xenditResponse.status,
              }
            }
          });
        } catch (updateError) {
          console.error('❌ Error updating payment:', {
            error: updateError.message,
            stack: updateError.stack,
            payment_id: payment.id,
          });
          throw new Error(`Failed to update payment: ${updateError.message}`);
        }

      case 'ewallet':
        if (!ewallet_type) {
          return res.status(400).json({
            success: false,
            message: 'E-wallet type is required'
          });
        }

        const callbackUrl = `${config.corsOrigin}/api/payments/xendit/webhook`;
        const redirectUrl = `${config.corsOrigin}/payment-success`;

        // Phone only required for OVO, optional for others
        // If no phone provided and it's OVO, we'll skip phone (might fail, but let Xendit handle validation)
        xenditResponse = await xenditService.createEwalletPayment({
          externalId,
          amount: parseFloat(payment.amount), // Ensure it's a number
          phone: customer_phone || null, // Only send if provided, don't use dummy number
          ewalletType: ewallet_type,
          callbackUrl,
          redirectUrl,
        });

        // Update payment with Xendit info
        await Payment.updateStatus(payment.id, 'pending', xenditResponse.id);
        
        // Update payment provider and Xendit details
        await require('../config/database').query(
          'UPDATE payments SET payment_provider = ?, payment_method = ? WHERE id = ?',
          ['xendit', 'e_wallet', payment.id]
        );
        
        // Save Xendit-specific data
        await Payment.updateXenditDetails(payment.id, {
          checkoutUrl: xenditResponse.checkoutUrl,
        });

        return res.json({
          success: true,
          message: 'E-Wallet payment created successfully',
          data: {
            payment: await Payment.findById(payment.id),
            xendit: {
              id: xenditResponse.id,
              checkout_url: xenditResponse.checkoutUrl,
              ewallet_type: xenditResponse.ewalletType,
              status: xenditResponse.status,
            }
          }
        });

      case 'qris':
        const qrisCallbackUrl = `${config.corsOrigin}/api/payments/xendit/webhook`;

        xenditResponse = await xenditService.createQrisPayment({
          externalId,
          amount: parseFloat(payment.amount), // Ensure it's a number
          callbackUrl: qrisCallbackUrl,
        });

        // Update payment with Xendit info
        await Payment.updateStatus(payment.id, 'pending', xenditResponse.id);
        
        // Update payment provider and Xendit details
        await require('../config/database').query(
          'UPDATE payments SET payment_provider = ?, payment_method = ? WHERE id = ?',
          ['xendit', 'bank_transfer', payment.id]
        );
        
        // Save Xendit-specific data
        await Payment.updateXenditDetails(payment.id, {
          qrString: xenditResponse.qrString,
          expiresAt: xenditResponse.expiresAt,
        });

        return res.json({
          success: true,
          message: 'QRIS payment created successfully',
          data: {
            payment: await Payment.findById(payment.id),
            xendit: {
              id: xenditResponse.id,
              qr_string: xenditResponse.qrString,
              expires_at: xenditResponse.expiresAt,
              status: xenditResponse.status,
            }
          }
        });

      default:
        return res.status(400).json({
          success: false,
          message: 'Invalid payment method'
        });
    }
  } catch (error) {
    next(error);
  }
};

// Get Xendit payment status
const getXenditPaymentStatus = async (req, res, next) => {
  try {
    const { xenditId } = req.params;

    console.log('🔍 Getting Xendit payment status:', {
      xendit_id: xenditId,
      user_id: req.userId,
    });

    // Find payment by transaction_id (Xendit ID)
    const payment = await Payment.findByTransactionId(xenditId);
    
    console.log('📋 Payment found:', {
      payment_id: payment?.id,
      user_id: payment?.user_id,
      transaction_id: payment?.transaction_id,
      request_user_id: req.userId,
    });
    
    if (!payment) {
      console.error('❌ Payment not found by transaction_id:', xenditId);
      return res.status(404).json({
        success: false,
        message: 'Payment not found'
      });
    }
    
    // Check user ownership - need to get user_id from subscription
    if (payment.user_id !== req.userId) {
      console.error('❌ Payment user mismatch:', {
        payment_user_id: payment.user_id,
        request_user_id: req.userId,
      });
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    // Get status from Xendit API
    // For Virtual Account, we can also use data from database if API fails
    let xenditStatus;
    try {
      xenditStatus = await xenditService.getPaymentStatus(
        xenditId,
        payment.payment_method === 'e_wallet' ? 'ewallet' : 
        payment.payment_method === 'bank_transfer' ? 'virtual_account' : 'qris'
      );
    } catch (error) {
      console.warn('⚠️ Failed to get status from Xendit API, using database data:', error.message);
      // Fallback to database data if API fails
      // For Virtual Account, we have the data in database
      if (payment.payment_method === 'bank_transfer') {
        xenditStatus = {
          id: payment.transaction_id,
          status: payment.status === 'paid' ? 'PAID' : payment.status === 'pending' ? 'PENDING' : payment.status.toUpperCase(),
          amount: payment.amount,
          accountNumber: payment.xendit_account_number,
          bankCode: payment.xendit_bank_code,
          paidAt: payment.paid_at,
        };
      } else {
        // For other payment methods, re-throw error
        throw error;
      }
    }

    res.json({
      success: true,
      data: {
        payment: {
          id: xenditStatus.id,
          status: xenditStatus.status,
          amount: xenditStatus.amount,
          paid_at: xenditStatus.paidAt,
          account_number: xenditStatus.accountNumber,
          bank_code: xenditStatus.bankCode,
        }
      }
    });
  } catch (error) {
    next(error);
  }
};

// Verify Xendit payment
const verifyXenditPayment = async (req, res, next) => {
  try {
    const { id } = req.params;

    const payment = await Payment.findById(id);
    if (!payment || payment.user_id !== req.userId) {
      return res.status(404).json({
        success: false,
        message: 'Payment not found'
      });
    }

    if (!payment.transaction_id) {
      return res.json({
        success: true,
        data: {
          is_paid: false
        }
      });
    }

    // Get status from Xendit
    try {
      const xenditStatus = await xenditService.getPaymentStatus(
        payment.transaction_id,
        payment.payment_method === 'e_wallet' ? 'ewallet' : 
        payment.payment_method === 'bank_transfer' ? 'virtual_account' : 'qris'
      );

      const isPaid = xenditStatus.status === 'PAID' || xenditStatus.status === 'paid';

      // Update payment if paid
      if (isPaid && payment.status === 'pending') {
        const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
        await Payment.updateStatus(payment.id, 'paid', payment.transaction_id, now);
        
        // Activate subscription
        await Subscription.updateStatus(payment.subscription_id, 'active');
        
        const subscription = await Subscription.findById(payment.subscription_id);
        if (subscription.status === 'active') {
          const startDate = new Date();
          const endDate = new Date(startDate);
          
          if (subscription.billing_period === 'monthly') {
            endDate.setMonth(endDate.getMonth() + 1);
          } else {
            endDate.setFullYear(endDate.getFullYear() + 1);
          }
          
          await Subscription.updateEndDate(payment.subscription_id, endDate.toISOString().split('T')[0]);
        }
      }

      return res.json({
        success: true,
        data: {
          is_paid: isPaid,
          xendit_data: xenditStatus
        }
      });
    } catch (error) {
      // If Xendit API error, return not paid
      return res.json({
        success: true,
        data: {
          is_paid: false
        }
      });
    }
  } catch (error) {
    next(error);
  }
};

// Xendit webhook handler
const xenditWebhook = async (req, res, next) => {
  try {
    // Verify webhook token
    const token = req.headers['x-callback-token'];
    if (!xenditService.verifyWebhookSignature(token, req.body)) {
      return res.status(401).json({
        success: false,
        message: 'Invalid webhook token'
      });
    }

    const { id, status, amount, external_id } = req.body;

    // Find payment by external_id or transaction_id
    let payment;
    if (external_id) {
      // Extract payment ID from external_id (format: PAYMENT_{id}_{timestamp})
      const match = external_id.match(/PAYMENT_(\d+)_/);
      if (match) {
        payment = await Payment.findById(match[1]);
      }
    }
    
    if (!payment && id) {
      payment = await Payment.findByTransactionId(id);
    }

    if (!payment) {
      console.error('Payment not found for webhook:', { id, external_id });
      return res.status(404).json({
        success: false,
        message: 'Payment not found'
      });
    }

    // Update payment status
    if (status === 'PAID' || status === 'paid') {
      if (payment.status === 'pending') {
        const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
        await Payment.updateStatus(payment.id, 'paid', id, now);
        
        // Activate subscription
        await Subscription.updateStatus(payment.subscription_id, 'active');
        
        const subscription = await Subscription.findById(payment.subscription_id);
        if (subscription.status === 'active') {
          const startDate = new Date();
          const endDate = new Date(startDate);
          
          if (subscription.billing_period === 'monthly') {
            endDate.setMonth(endDate.getMonth() + 1);
          } else {
            endDate.setFullYear(endDate.getFullYear() + 1);
          }
          
          await Subscription.updateEndDate(payment.subscription_id, endDate.toISOString().split('T')[0]);
        }
      }
    } else if (status === 'FAILED' || status === 'failed' || status === 'EXPIRED' || status === 'expired') {
      await Payment.updateStatus(payment.id, 'failed', id);
    }

    res.json({
      success: true,
      message: 'Webhook processed successfully'
    });
  } catch (error) {
    console.error('Webhook error:', error);
    next(error);
  }
};

// Simulate Xendit payment (for testing/development only)
// This simulates a webhook from Xendit indicating payment is paid
const simulateXenditPayment = async (req, res, next) => {
  try {
    const { paymentId } = req.params;
    
    // Only allow in development/test mode
    if (process.env.NODE_ENV === 'production') {
      return res.status(403).json({
        success: false,
        message: 'Simulation not allowed in production'
      });
    }
    
    const payment = await Payment.findById(paymentId);
    
    if (!payment) {
      return res.status(404).json({
        success: false,
        message: 'Payment not found'
      });
    }
    
    // Check ownership
    if (payment.user_id !== req.userId) {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }
    
    // Only allow simulation for pending Xendit payments
    if (payment.status !== 'pending') {
      return res.status(400).json({
        success: false,
        message: 'Payment is not pending'
      });
    }
    
    if (payment.payment_provider !== 'xendit' || !payment.transaction_id) {
      return res.status(400).json({
        success: false,
        message: 'Payment is not a Xendit payment'
      });
    }
    
    // Simulate webhook from Xendit
    // Create a mock webhook payload
    const webhookPayload = {
      id: payment.transaction_id,
      status: 'PAID',
      amount: payment.amount,
      external_id: `PAYMENT_${payment.id}_${Date.now()}`,
    };
    
    // Process webhook internally (same logic as xenditWebhook)
    const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
    await Payment.updateStatus(payment.id, 'paid', payment.transaction_id, now);
    
    // Activate subscription
    await Subscription.updateStatus(payment.subscription_id, 'active');
    
    const subscription = await Subscription.findById(payment.subscription_id);
    if (subscription && subscription.status === 'active') {
      const startDate = new Date();
      const endDate = new Date(startDate);
      
      if (subscription.billing_period === 'monthly') {
        endDate.setMonth(endDate.getMonth() + 1);
      } else {
        endDate.setFullYear(endDate.getFullYear() + 1);
      }
      
      await Subscription.updateEndDate(payment.subscription_id, endDate.toISOString().split('T')[0]);
    }
    
    // Reload payment
    const updatedPayment = await Payment.findById(payment.id);
    
    console.log('✅ Payment simulated successfully:', {
      payment_id: payment.id,
      transaction_id: payment.transaction_id,
      status: 'paid'
    });
    
    res.json({
      success: true,
      message: 'Payment simulated successfully through Xendit flow',
      data: { payment: updatedPayment }
    });
  } catch (error) {
    console.error('❌ Error simulating payment:', error);
    next(error);
  }
};

// Create Midtrans payment
const createMidtransPayment = async (req, res, next) => {
  try {
    const { id } = req.params;
    
    // Get payment
    const payment = await Payment.findById(id);
    
    let targetUserId = req.userId;
    if (req.user.role === 'co-owner' && req.user.created_by) {
      targetUserId = req.user.created_by;
    }
    
    if (!payment || payment.user_id !== targetUserId) {
      return res.status(404).json({
        success: false,
        message: 'Payment not found'
      });
    }
    
    // Check if payment already has Midtrans transaction
    if (payment.payment_provider === 'midtrans' && payment.midtrans_token) {
      return res.json({
        success: true,
        message: 'Midtrans transaction already exists',
        data: {
          payment,
          midtrans: {
            token: payment.midtrans_token,
            redirect_url: payment.midtrans_redirect_url
          }
        }
      });
    }
    
    // Create Midtrans transaction
    const midtransService = require('../services/midtransService');
    const orderId = `PAYMENT-${payment.id}-${Date.now()}`;
    
    const midtransRes = await midtransService.createSnapTransaction({
      orderId,
      grossAmount: payment.amount,
      customerDetails: {
        name: req.user.name,
        email: req.user.email,
        phone: req.user.phone || ''
      }
    });
    
    // Update payment record in database
    await require('../config/database').query(
      `UPDATE payments 
       SET payment_provider = 'midtrans', 
           transaction_id = ?, 
           midtrans_token = ?, 
           midtrans_redirect_url = ? 
       WHERE id = ?`,
      [orderId, midtransRes.token, midtransRes.redirect_url, payment.id]
    );
    
    // Reload payment
    const updatedPayment = await Payment.findById(payment.id);
    
    res.json({
      success: true,
      message: 'Midtrans transaction created successfully',
      data: {
        payment: updatedPayment,
        midtrans: {
          token: midtransRes.token,
          redirect_url: midtransRes.redirect_url
        }
      }
    });
  } catch (error) {
    next(error);
  }
};

// Midtrans webhook handler
const midtransWebhook = async (req, res, next) => {
  try {
    const midtransService = require('../services/midtransService');
    const payload = req.body;
    
    // Verify signature key
    if (!midtransService.verifyWebhookSignature(payload)) {
      return res.status(401).json({
        success: false,
        message: 'Invalid signature key'
      });
    }
    
    const { order_id, transaction_status } = payload;
    
    // Parse paymentId from order_id (format: PAYMENT-{id}-{timestamp})
    const match = order_id.match(/PAYMENT-(\d+)-/);
    if (!match) {
      return res.status(400).json({
        success: false,
        message: 'Invalid order ID format'
      });
    }
    
    const paymentId = parseInt(match[1]);
    const payment = await Payment.findById(paymentId);
    if (!payment) {
      return res.status(404).json({
        success: false,
        message: 'Payment not found'
      });
    }
    
    // Update status based on transaction_status
    if (transaction_status === 'settlement' || transaction_status === 'capture') {
      if (payment.status === 'pending') {
        const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
        await Payment.updateStatus(payment.id, 'paid', order_id, now);
        
        // Activate subscription
        await Subscription.updateStatus(payment.subscription_id, 'active');
        
        const subscription = await Subscription.findById(payment.subscription_id);
        if (subscription && subscription.status === 'active') {
          const startDate = new Date();
          const endDate = new Date(startDate);
          
          if (subscription.billing_period === 'monthly') {
            endDate.setMonth(endDate.getMonth() + 1);
          } else {
            endDate.setFullYear(endDate.getFullYear() + 1);
          }
          
          await Subscription.updateEndDate(payment.subscription_id, endDate.toISOString().split('T')[0]);
        }
        
        // Push notification
        setImmediate(async () => {
          try {
            const notificationQueue = require('../services/notificationQueue');
            const SubscriptionPlan = require('../models/SubscriptionPlan');
            const plan = await SubscriptionPlan.findById(subscription.plan_id);
            
            const amountStr = new Intl.NumberFormat('id-ID', {
              style: 'currency',
              currency: 'IDR',
              minimumFractionDigits: 0
            }).format(payment.amount);
            
            notificationQueue.enqueue({
              userId: subscription.user_id,
              title: 'Pembayaran Berhasil',
              body: `Pembayaran subscription ${plan?.name || 'Plan'} sebesar ${amountStr} telah berhasil via Midtrans`,
              data: {
                screen: 'subscription',
                paymentId: payment.id,
                subscriptionId: subscription.id,
                type: 'payment_success',
              },
            });
          } catch (notifError) {
            console.error('Error queuing notification:', notifError);
          }
        });
      }
    } else if (['deny', 'cancel', 'expire', 'failure'].includes(transaction_status)) {
      if (payment.status === 'pending') {
        await Payment.updateStatus(payment.id, 'failed', order_id);
        
        // Push notification
        setImmediate(async () => {
          try {
            const notificationQueue = require('../services/notificationQueue');
            const subscription = await Subscription.findById(payment.subscription_id);
            
            const amountStr = new Intl.NumberFormat('id-ID', {
              style: 'currency',
              currency: 'IDR',
              minimumFractionDigits: 0
            }).format(payment.amount);
            
            notificationQueue.enqueue({
              userId: subscription.user_id,
              title: 'Pembayaran Gagal',
              body: `Pembayaran sebesar ${amountStr} gagal/kedaluwarsa. Silakan coba lagi.`,
              data: {
                screen: 'payment',
                paymentId: payment.id,
                type: 'payment_failed',
              },
            });
          } catch (notifError) {
            console.error('Error queuing notification:', notifError);
          }
        });
      }
    }
    
    res.json({
      success: true,
      message: 'Webhook processed successfully'
    });
  } catch (error) {
    console.error('❌ Midtrans Webhook Error:', error.message);
    next(error);
  }
};

// Cancel payment and subscription
const cancelPayment = async (req, res, next) => {
  try {
    const { id } = req.params;
    
    // Find payment
    const payment = await Payment.findById(id);
    
    let targetUserId = req.userId;
    if (req.user.role === 'co-owner' && req.user.created_by) {
      targetUserId = req.user.created_by;
    }
    
    if (!payment || payment.user_id !== targetUserId) {
      return res.status(404).json({
        success: false,
        message: 'Payment not found'
      });
    }
    
    if (payment.status !== 'pending') {
      return res.status(400).json({
        success: false,
        message: 'Only pending payments can be cancelled'
      });
    }
    
    // If it has a Midtrans transaction, cancel it in Midtrans
    if (payment.payment_provider === 'midtrans' && payment.transaction_id) {
      const midtransService = require('../services/midtransService');
      try {
        await midtransService.cancelTransaction(payment.transaction_id);
        console.log(`✅ Cancelled transaction ${payment.transaction_id} in Midtrans`);
      } catch (midtransError) {
        console.warn(`⚠️ Failed to cancel transaction in Midtrans:`, midtransError.message);
      }
    }
    
    // Update local payment status to failed (cancelled/failed)
    await Payment.updateStatus(payment.id, 'failed', payment.transaction_id);
    
    // Cancel subscription status to cancelled
    await Subscription.updateStatus(payment.subscription_id, 'cancelled');
    
    // Reload payment
    const updatedPayment = await Payment.findById(payment.id);
    
    res.json({
      success: true,
      message: 'Transaksi berhasil dibatalkan',
      data: { payment: updatedPayment }
    });
  } catch (error) {
    next(error);
  }
};

// Verify/sync status directly from Midtrans API (fallback if webhook fails or on localhost)
const verifyMidtransPayment = async (req, res, next) => {
  try {
    const { id } = req.params;
    const payment = await Payment.findById(id);
    
    let targetUserId = req.userId;
    if (req.user.role === 'co-owner' && req.user.created_by) {
      targetUserId = req.user.created_by;
    }
    
    if (!payment || payment.user_id !== targetUserId) {
      return res.status(404).json({
        success: false,
        message: 'Payment not found'
      });
    }

    if (payment.status === 'paid') {
      return res.json({
        success: true,
        message: 'Payment is already paid',
        data: { payment }
      });
    }

    if (!payment.transaction_id || payment.payment_provider !== 'midtrans') {
      return res.status(400).json({
        success: false,
        message: 'Payment is not a Midtrans transaction or has no transaction ID'
      });
    }

    const midtransClient = require('midtrans-client');
    const config = require('../config/config');
    const snap = new midtransClient.Snap({
      isProduction: config.midtrans.isProduction,
      serverKey: config.midtrans.serverKey,
      clientKey: config.midtrans.clientKey
    });

    let statusResponse;
    try {
      statusResponse = await snap.transaction.status(payment.transaction_id);
    } catch (err) {
      console.error('Error fetching Midtrans status:', err.message);
      return res.status(500).json({
        success: false,
        message: `Failed to fetch Midtrans status: ${err.message}`
      });
    }

    const { transaction_status } = statusResponse;
    const now = new Date().toISOString().slice(0, 19).replace('T', ' ');

    if (transaction_status === 'settlement' || transaction_status === 'capture') {
      await Payment.updateStatus(payment.id, 'paid', payment.transaction_id, now);
      await Subscription.updateStatus(payment.subscription_id, 'active');
      
      const subscription = await Subscription.findById(payment.subscription_id);
      if (subscription) {
        const startDate = new Date();
        const endDate = new Date(startDate);
        if (subscription.billing_period === 'monthly') {
          endDate.setMonth(endDate.getMonth() + 1);
        } else {
          endDate.setFullYear(endDate.getFullYear() + 1);
        }
        await Subscription.updateEndDate(payment.subscription_id, endDate.toISOString().split('T')[0]);
      }
      
      const updatedPayment = await Payment.findById(payment.id);
      return res.json({
        success: true,
        message: 'Payment verified successfully as PAID',
        data: { payment: updatedPayment }
      });
    } else if (['deny', 'cancel', 'expire', 'failure'].includes(transaction_status)) {
      await Payment.updateStatus(payment.id, 'failed', payment.transaction_id);
      await Subscription.updateStatus(payment.subscription_id, 'cancelled');
      
      const updatedPayment = await Payment.findById(payment.id);
      return res.json({
        success: true,
        message: 'Payment verified as FAILED/CANCELLED',
        data: { payment: updatedPayment }
      });
    }

    res.json({
      success: true,
      message: `Payment status is ${transaction_status}`,
      data: { payment }
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getPending,
  getAll,
  getById,
  verify,
  updateStatus,
  createXenditPayment,
  getXenditPaymentStatus,
  verifyXenditPayment,
  xenditWebhook,
  simulateXenditPayment,
  createMidtransPayment,
  midtransWebhook,
  cancelPayment,
  verifyMidtransPayment
};

