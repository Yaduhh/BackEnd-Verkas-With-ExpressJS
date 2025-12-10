const Branch = require('../models/Branch');

// Check if user can create more branches
const checkBranchLimit = async (req, res, next) => {
  try {
    if (req.user.role !== 'owner') {
      return res.status(403).json({
        success: false,
        message: 'Only owners can create branches'
      });
    }
    
    const canCreate = await Branch.canCreateBranch(req.userId, req.user.role);
    
    if (!canCreate) {
      const count = await Branch.countUserBranches(req.userId, req.user.role);
      const Subscription = require('../models/Subscription');
      const subscription = await Subscription.getActiveSubscription(req.userId);
      
      let maxBranches = 1; // Free plan default
      if (subscription) {
        const SubscriptionPlan = require('../models/SubscriptionPlan');
        const plan = await SubscriptionPlan.findById(subscription.plan_id);
        maxBranches = plan?.max_branches || 1;
      }
      
      return res.status(403).json({
        success: false,
        message: 'Branch limit reached. Please upgrade your subscription.',
        code: 'BRANCH_LIMIT_EXCEEDED',
        data: {
          current_branches: count,
          max_branches: maxBranches,
          is_unlimited: maxBranches === null
        }
      });
    }
    
    next();
  } catch (error) {
    next(error);
  }
};

module.exports = {
  checkBranchLimit
};

