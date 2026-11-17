const express = require('express');
const router = express.Router();
const {
  getAll,
  getById,
  create,
  update,
  deletePettyCash,
  createExpense,
  updateExpense,
  deleteExpense
} = require('../controllers/pettyCashController');
const { authenticate } = require('../middleware/auth');
const { getCurrentBranch } = require('../middleware/branch');

router.use(authenticate);
router.use(getCurrentBranch);

router.get('/', getAll);
router.get('/:id', getById);
router.post('/', create);
router.put('/:id', update);
router.delete('/:id', deletePettyCash);

router.post('/:id/expenses', createExpense);
router.put('/:id/expenses/:txId', updateExpense);
router.delete('/:id/expenses/:txId', deleteExpense);

module.exports = router;

