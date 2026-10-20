/**
 * Branch Report Controller
 * 
 * Modularized into separate sub-controllers under ./branchReport/:
 * - branchReportCoreController.js     : getReport, updateReport, getSingleBranchReportExportData
 * - branchReportExportController.js   : exportPdf, exportExcel, exportImage, exportBagiHasilPdf, exportSavingsPdf
 * - branchReportTemplateController.js : Bagi Hasil & Expense Order templates CRUD
 * - branchReportGroupController.js    : Consolidated & group report calculation & exports
 */

module.exports = require('./branchReport');
