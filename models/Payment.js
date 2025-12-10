const { query } = require('../config/database');

class Payment {
  // Find by ID
  static async findById(id) {
    const results = await query(
      `SELECT p.*, s.user_id, s.plan_id, s.billing_period
       FROM payments p
       JOIN subscriptions s ON p.subscription_id = s.id
       WHERE p.id = ?`,
      [id]
    );
    return results[0] || null;
  }
  
  // Find by subscription ID
  static async findBySubscriptionId(subscriptionId) {
    return await query(
      'SELECT * FROM payments WHERE subscription_id = ? ORDER BY created_at DESC',
      [subscriptionId]
    );
  }
  
  // Find by transaction ID (from payment gateway)
  static async findByTransactionId(transactionId) {
    const results = await query(
      `SELECT p.*, s.user_id, s.plan_id, s.billing_period
       FROM payments p
       JOIN subscriptions s ON p.subscription_id = s.id
       WHERE p.transaction_id = ?`,
      [transactionId]
    );
    return results[0] || null;
  }
  
  // Get pending payments for user
  static async getPendingPayments(userId) {
    return await query(
      `SELECT p.*, s.plan_id, s.billing_period
       FROM payments p
       JOIN subscriptions s ON p.subscription_id = s.id
       WHERE s.user_id = ? AND p.status = 'pending'
       ORDER BY p.due_date ASC`,
      [userId]
    );
  }

  // Get all payments for user
  static async getAllPayments(userId) {
    return await query(
      `SELECT p.*, s.plan_id, s.billing_period
       FROM payments p
       JOIN subscriptions s ON p.subscription_id = s.id
       WHERE s.user_id = ?
       ORDER BY p.created_at DESC`,
      [userId]
    );
  }
  
  // Create payment
  static async create({ subscriptionId, amount, paymentMethod, dueDate, paymentProvider = null, invoiceUrl = null }) {
    const result = await query(
      `INSERT INTO payments (subscription_id, amount, payment_method, payment_provider, due_date, invoice_url, status)
       VALUES (?, ?, ?, ?, ?, ?, 'pending')`,
      [subscriptionId, amount, paymentMethod, paymentProvider, dueDate, invoiceUrl]
    );
    return await this.findById(result.insertId);
  }
  
  // Update payment status
  static async updateStatus(id, status, transactionId = null, paidAt = null) {
    const updates = ['status = ?'];
    const params = [status];
    
    if (transactionId) {
      updates.push('transaction_id = ?');
      params.push(transactionId);
    }
    
    if (status === 'paid' && paidAt) {
      updates.push('paid_at = ?');
      params.push(paidAt);
    } else if (status === 'paid' && !paidAt) {
      updates.push('paid_at = NOW()');
    }
    
    params.push(id);
    
    await query(
      `UPDATE payments SET ${updates.join(', ')} WHERE id = ?`,
      params
    );
    return await this.findById(id);
  }
  
  // Update invoice URL
  static async updateInvoiceUrl(id, invoiceUrl) {
    await query(
      'UPDATE payments SET invoice_url = ? WHERE id = ?',
      [invoiceUrl, id]
    );
    return await this.findById(id);
  }

  // Update Xendit payment details
  static async updateXenditDetails(id, xenditData) {
    const updates = [];
    const params = [];

    if (xenditData.accountNumber !== undefined) {
      updates.push('xendit_account_number = ?');
      params.push(xenditData.accountNumber);
    }
    if (xenditData.bankCode !== undefined) {
      updates.push('xendit_bank_code = ?');
      params.push(xenditData.bankCode);
    }
    if (xenditData.checkoutUrl !== undefined) {
      updates.push('xendit_checkout_url = ?');
      params.push(xenditData.checkoutUrl);
    }
    if (xenditData.qrString !== undefined) {
      updates.push('xendit_qr_string = ?');
      params.push(xenditData.qrString);
    }
    if (xenditData.expiresAt !== undefined) {
      updates.push('xendit_expires_at = ?');
      params.push(xenditData.expiresAt);
    }

    if (updates.length > 0) {
      params.push(id);
      await query(
        `UPDATE payments SET ${updates.join(', ')} WHERE id = ?`,
        params
      );
    }
    return await this.findById(id);
  }
}

module.exports = Payment;

