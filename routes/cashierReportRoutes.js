const express = require('express');
const router = express.Router();
const cashierReportController = require('../controllers/cashierReportController');
const { authenticate } = require('../middleware/auth');
const { optionalBranchContext } = require('../middleware/branchContext');

router.use(authenticate);
router.use(optionalBranchContext);

router.get('/daily', cashierReportController.getDaily);
router.put('/daily', cashierReportController.saveDaily);
router.get('/monthly', cashierReportController.listMonthly);
router.put('/targets', cashierReportController.upsertTarget);
router.put('/:reportId/sales-channels', cashierReportController.updateSalesChannels);

router.get('/sold-items', cashierReportController.getSoldItemMasters);
router.post('/sold-items', cashierReportController.createSoldItemMaster);
router.put('/sold-items/reorder', cashierReportController.reorderSoldItemMasters);
router.put('/sold-items/:itemId', cashierReportController.updateSoldItemMaster);
router.delete('/sold-items/:itemId', cashierReportController.deleteSoldItemMaster);

router.post('/:reportId/notes', cashierReportController.addNote);
router.put('/notes/:noteId/resolve', cashierReportController.toggleNoteResolved);
router.delete('/notes/:noteId', cashierReportController.deleteNote);

module.exports = router;
