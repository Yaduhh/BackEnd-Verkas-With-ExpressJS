const Subscription = require('../models/Subscription');
const SubscriptionPlan = require('../models/SubscriptionPlan');

// Check subscription status (for owner)
const checkSubscription = async (req, res, next) => {
  try {
    if (req.user.role !== 'owner') {
      return next(); // Admin doesn't need subscription
    }
    
    const subscription = await Subscription.getActiveSubscription(req.userId);
    req.subscription = subscription;
    
    // Attach plan info (free plan if no subscription)
    if (subscription) {
      const plan = await SubscriptionPlan.findById(subscription.plan_id);
      req.plan = plan;
    } else {
      const freePlan = await SubscriptionPlan.getDefaultPlan();
      req.plan = freePlan;
    }
    
    next();
  } catch (error) {
    next(error);
  }
};

module.exports = {
  checkSubscription
};

