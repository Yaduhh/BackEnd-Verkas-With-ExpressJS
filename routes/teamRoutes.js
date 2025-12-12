const express = require('express');
const router = express.Router();
const {
  getAll,
  getById,
  create,
  addMember,
  removeMember,
  getBranches,
  update,
  deleteTeam
} = require('../controllers/teamController');
const { authenticate, authorize } = require('../middleware/auth');

// All routes require authentication
router.use(authenticate);

// Get all teams user is member of (owner and co-owner)
router.get('/', authorize('owner', 'co-owner'), getAll);

// Get team by ID
router.get('/:id', getById);

// Create team (owner only)
router.post('/', authorize('owner'), create);

// Update team (owner only)
router.put('/:id', authorize('owner'), update);

// Delete team (owner only)
router.delete('/:id', authorize('owner'), deleteTeam);

// Add member to team (owner and co-owner)
router.post('/:id/members', authorize('owner', 'co-owner'), addMember);

// Remove member from team (owner and co-owner)
router.delete('/:id/members/:userId', authorize('owner', 'co-owner'), removeMember);

// Get team branches
router.get('/:id/branches', getBranches);

module.exports = router;

