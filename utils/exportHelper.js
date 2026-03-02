const common = require('./export/commonHelper');
const excel = require('./export/excelHelper');
const csv = require('./export/csvHelper');
const pdf = require('./export/pdfHelper');

/**
 * Centered Export Helper - Acts as an entry point for all export formats.
 * Refactored into specialized modules for better maintainability.
 */
module.exports = {
  // Common Utilities
  EXPORTS_DIR: common.EXPORTS_DIR,
  generateFilename: common.generateFilename,
  getMimeType: common.getMimeType,
  formatCurrency: common.formatCurrency,
  getMonthName: common.getMonthName,

  // Format Specific Functions
  exportToExcel: excel.exportToExcel,
  exportToCSV: csv.exportToCSV,
  exportToPDF: pdf.exportToPDF,
  exportBukuKasToPDF: pdf.exportBukuKasToPDF,
  exportCategoryToPDF: pdf.exportCategoryToPDF,
  exportFinancialReportToPDF: pdf.exportFinancialReportToPDF
};
