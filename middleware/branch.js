const { getCurrentBranch } = require('./branchContext');

// Alias untuk requireBranch (same as getCurrentBranch)
const requireBranch = getCurrentBranch;

module.exports = {
  requireBranch,
  getCurrentBranch,
};

