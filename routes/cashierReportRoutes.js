const express = require('express');
const router = express.Router();
const multer = require('multer');
const cashierReportController = require('../controllers/cashierReportController');
const { authenticate } = require('../middleware/auth');
const { optionalBranchContext } = require('../middleware/branchContext');

const uploadMemory = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 }
});

router.use(authenticate);
router.use(optionalBranchContext);

router.get('/daily', cashierReportController.getDaily);
router.put('/daily', cashierReportController.saveDaily);
router.post('/pull-pesan-bosgil', cashierReportController.pullPesanBosgilOrders);
router.get('/monthly', cashierReportController.listMonthly);
router.put('/targets', cashierReportController.upsertTarget);
router.put('/branch-config', cashierReportController.updateBranchConfig);
router.get('/orders/template-excel', cashierReportController.downloadOrderExcelTemplate);
router.post('/orders/preview-excel', uploadMemory.single('file'), cashierReportController.previewOrderExcel);
router.put('/:reportId/sales-channels', cashierReportController.updateSalesChannels);
router.put('/orders/:orderId/verify', cashierReportController.toggleOrderVerification);
router.post('/:reportId/piutang', cashierReportController.createPiutangItem);
router.put('/piutang/:itemId', cashierReportController.updatePiutangItem);
router.delete('/piutang/:itemId', cashierReportController.deletePiutangItem);
router.put('/piutang/:itemId/verify', cashierReportController.togglePiutangVerification);

router.get('/sold-items', cashierReportController.getSoldItemMasters);
router.post('/sold-items', cashierReportController.createSoldItemMaster);
router.put('/sold-items/reorder', cashierReportController.reorderSoldItemMasters);
router.put('/sold-items/:itemId', cashierReportController.updateSoldItemMaster);
router.delete('/sold-items/:itemId', cashierReportController.deleteSoldItemMaster);

router.post('/:reportId/notes', cashierReportController.addNote);
router.put('/notes/:noteId/resolve', cashierReportController.toggleNoteResolved);
router.delete('/notes/:noteId', cashierReportController.deleteNote);

module.exports = router;
