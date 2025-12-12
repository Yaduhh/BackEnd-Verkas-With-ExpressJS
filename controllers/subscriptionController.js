const Subscription = require('../models/Subscription');
const SubscriptionPlan = require('../models/SubscriptionPlan');
const Payment = require('../models/Payment');

// Get all available plans
const getPlans = async (req, res, next) => {
  try {
    const plans = await SubscriptionPlan.findAll({ isActive: true });
    
    res.json({
      success: true,
      data: { plans }
    });
  } catch (error) {
    next(error);
  }
};

// Get current subscription (owner and co-owner)
const getCurrent = async (req, res, next) => {
  try {
    if (req.user.role !== 'owner' && req.user.role !== 'co-owner') {
      return res.status(403).json({
        success: false,
        message: 'Only owners and co-owners can view subscriptions'
      });
    }
    
    // For co-owner, get subscription from the owner who created them
    let targetUserId = req.userId;
    if (req.user.role === 'co-owner' && req.user.created_by) {
      targetUserId = req.user.created_by;
    }
    
    const subscription = await Subscription.getActiveSubscription(targetUserId);
    
    if (!subscription) {
      // Return free plan info
      const freePlan = await SubscriptionPlan.getDefaultPlan();
      return res.json({
        success: true,
        data: {
          subscription: null,
          plan: freePlan,
          is_free: true
        }
      });
    }
    
    res.json({
      success: true,
      data: {
        subscription,
        is_free: false
      }
    });
  } catch (error) {
    next(error);
  }
};

// Get subscription history
const getHistory = async (req, res, next) => {
  try {
    if (req.user.role !== 'owner' && req.user.role !== 'co-owner') {
      return res.status(403).json({
        success: false,
        message: 'Only owners and co-owners can view subscription history'
      });
    }
    
    // For co-owner, get subscriptions from the owner who created them
    let targetUserId = req.userId;
    if (req.user.role === 'co-owner' && req.user.created_by) {
      targetUserId = req.user.created_by;
    }
    
    const subscriptions = await Subscription.findByUserId(targetUserId);
    
    res.json({
      success: true,
      data: { subscriptions }
    });
  } catch (error) {
    next(error);
  }
};

// Create subscription (owner and co-owner)
const create = async (req, res, next) => {
  try {
    if (req.user.role !== 'owner' && req.user.role !== 'co-owner') {
      return res.status(403).json({
        success: false,
        message: 'Only owners and co-owners can create subscriptions'
      });
    }
    
    // For co-owner, create subscription for the owner who created them
    let targetUserId = req.userId;
    if (req.user.role === 'co-owner' && req.user.created_by) {
      targetUserId = req.user.created_by;
    }
    
    const { plan_id, billing_period } = req.body;
    
    if (!plan_id || !billing_period) {
      return res.status(400).json({
        success: false,
        message: 'Plan ID and billing period are required'
      });
    }
    
    if (!['monthly', 'yearly'].includes(billing_period)) {
      return res.status(400).json({
        success: false,
        message: 'Billing period must be monthly or yearly'
      });
    }
    
    // Get plan
    const plan = await SubscriptionPlan.findById(plan_id);
    if (!plan) {
      return res.status(404).json({
        success: false,
        message: 'Plan not found'
      });
    }
    
    // Check if user already has active subscription
    const existing = await Subscription.getActiveSubscription(targetUserId);
    if (existing) {
      return res.status(400).json({
        success: false,
        message: 'You already have an active subscription'
      });
    }
    
    // Calculate dates
    const startDate = new Date();
    const endDate = new Date(startDate);
    
    if (billing_period === 'monthly') {
      endDate.setMonth(endDate.getMonth() + 1);
    } else {
      endDate.setFullYear(endDate.getFullYear() + 1);
    }
    
    // Create subscription (status: pending)
    const subscription = await Subscription.create({
      userId: targetUserId,
      planId: plan_id,
      billingPeriod: billing_period,
      startDate: startDate.toISOString().split('T')[0],
      endDate: endDate.toISOString().split('T')[0],
      autoRenew: req.body.auto_renew !== false
    });
    
    // Calculate amount
    const amount = billing_period === 'monthly' ? plan.price_monthly : plan.price_yearly;
    
    // Create payment record
    const payment = await Payment.create({
      subscriptionId: subscription.id,
      amount: amount,
      paymentMethod: 'manual', // Will be updated when payment gateway is integrated
      dueDate: endDate.toISOString().split('T')[0]
    });
    
    res.status(201).json({
      success: true,
      message: 'Subscription created successfully. Please complete the payment.',
      data: {
        subscription,
        payment
      }
    });
  } catch (error) {
    next(error);
  }
};

// Cancel subscription (owner and co-owner)
const cancel = async (req, res, next) => {
  try {
    if (req.user.role !== 'owner' && req.user.role !== 'co-owner') {
      return res.status(403).json({
        success: false,
        message: 'Only owners and co-owners can cancel subscriptions'
      });
    }
    
    const { id } = req.params;
    const subscription = await Subscription.findById(id);
    
    // For co-owner, check subscription belongs to the owner who created them
    let targetUserId = req.userId;
    if (req.user.role === 'co-owner' && req.user.created_by) {
      targetUserId = req.user.created_by;
    }
    
    if (!subscription || subscription.user_id !== targetUserId) {
      return res.status(404).json({
        success: false,
        message: 'Subscription not found'
      });
    }
    
    const cancelled = await Subscription.cancel(id);
    
    res.json({
      success: true,
      message: 'Subscription cancelled successfully',
      data: { subscription: cancelled }
    });
  } catch (error) {
    next(error);
  }
};

// Get payments for subscription
const getPayments = async (req, res, next) => {
  try {
    if (req.user.role !== 'owner' && req.user.role !== 'co-owner') {
      return res.status(403).json({
        success: false,
        message: 'Only owners and co-owners can view payments'
      });
    }
    
    const { id } = req.params;
    const subscription = await Subscription.findById(id);
    
    // For co-owner, check subscription belongs to the owner who created them
    let targetUserId = req.userId;
    if (req.user.role === 'co-owner' && req.user.created_by) {
      targetUserId = req.user.created_by;
    }
    
    if (!subscription || subscription.user_id !== targetUserId) {
      return res.status(404).json({
        success: false,
        message: 'Subscription not found'
      });
    }
    
    const payments = await Payment.findBySubscriptionId(id);
    
    res.json({
      success: true,
      data: { payments }
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getPlans,
  getCurrent,
  getHistory,
  create,
  cancel,
  getPayments
};

