const express = require('express');
const router = express.Router();
const paymentMethodController = require('../controllers/paymentMethodController');
const { authenticate } = require('../middleware/auth');

router.use(authenticate);

router.get('/', paymentMethodController.getAll);
router.post('/', paymentMethodController.create);
router.put('/:id', paymentMethodController.update);
router.delete('/:id', paymentMethodController.delete);

module.exports = router;
