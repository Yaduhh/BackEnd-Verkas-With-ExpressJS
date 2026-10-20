const core = require('./branchReportCoreController');
const exportCtrl = require('./branchReportExportController');
const template = require('./branchReportTemplateController');
const group = require('./branchReportGroupController');

module.exports = {
    ...core,
    ...exportCtrl,
    ...template,
    ...group
};
