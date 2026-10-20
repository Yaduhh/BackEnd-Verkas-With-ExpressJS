const Branch = require('../../models/Branch');
const BagiHasilTemplate = require('../../models/BagiHasilTemplate');
const ExpenseOrderTemplate = require('../../models/ExpenseOrderTemplate');

// ==========================================
// BAGI HASIL TEMPLATES
// ==========================================

const getBagiHasilTemplates = async (req, res, next) => {
    try {
        const { branchId } = req.params;
        const hasAccess = await Branch.userHasAccess(req.userId, parseInt(branchId), req.user.role);
        if (!hasAccess) {
            return res.status(403).json({ success: false, message: 'Akses ditolak' });
        }

        const templates = await BagiHasilTemplate.findByBranchId(parseInt(branchId));
        return res.json({ success: true, data: templates });
    } catch (error) {
        next(error);
    }
};

const createBagiHasilTemplate = async (req, res, next) => {
    try {
        const { branchId } = req.params;
        const { name, templateData, isDefault } = req.body;

        const hasAccess = await Branch.userHasAccess(req.userId, parseInt(branchId), req.user.role);
        if (!hasAccess) {
            return res.status(403).json({ success: false, message: 'Akses ditolak' });
        }

        if (!name || !name.trim()) {
            return res.status(400).json({ success: false, message: 'Nama template wajib diisi' });
        }

        if (!templateData || !Array.isArray(templateData) || templateData.length === 0) {
            return res.status(400).json({ success: false, message: 'Data template tidak boleh kosong' });
        }

        const template = await BagiHasilTemplate.create({
            branchId: parseInt(branchId),
            name: name.trim(),
            templateData,
            isDefault: Boolean(isDefault)
        });

        return res.status(201).json({
            success: true,
            message: 'Template bagi hasil berhasil disimpan',
            data: template
        });
    } catch (error) {
        next(error);
    }
};

const updateBagiHasilTemplate = async (req, res, next) => {
    try {
        const { branchId, templateId } = req.params;
        const { name, templateData, isDefault } = req.body;

        const hasAccess = await Branch.userHasAccess(req.userId, parseInt(branchId), req.user.role);
        if (!hasAccess) {
            return res.status(403).json({ success: false, message: 'Akses ditolak' });
        }

        const template = await BagiHasilTemplate.findById(parseInt(templateId));
        if (!template || template.branch_id !== parseInt(branchId)) {
            return res.status(404).json({ success: false, message: 'Template tidak ditemukan' });
        }

        const updated = await BagiHasilTemplate.update(parseInt(templateId), {
            name: name ? name.trim() : undefined,
            templateData,
            isDefault: isDefault !== undefined ? Boolean(isDefault) : undefined
        });

        return res.json({
            success: true,
            message: 'Template berhasil diperbarui',
            data: updated
        });
    } catch (error) {
        next(error);
    }
};

const deleteBagiHasilTemplate = async (req, res, next) => {
    try {
        const { branchId, templateId } = req.params;

        const hasAccess = await Branch.userHasAccess(req.userId, parseInt(branchId), req.user.role);
        if (!hasAccess) {
            return res.status(403).json({ success: false, message: 'Akses ditolak' });
        }

        const template = await BagiHasilTemplate.findById(parseInt(templateId));
        if (!template || template.branch_id !== parseInt(branchId)) {
            return res.status(404).json({ success: false, message: 'Template tidak ditemukan' });
        }

        await BagiHasilTemplate.delete(parseInt(templateId));

        return res.json({
            success: true,
            message: 'Template berhasil dihapus'
        });
    } catch (error) {
        next(error);
    }
};

// ==========================================
// EXPENSE ORDER TEMPLATES
// ==========================================

const getExpenseOrderTemplates = async (req, res, next) => {
    try {
        const { branchId } = req.params;
        const hasAccess = await Branch.userHasAccess(req.userId, parseInt(branchId), req.user.role);
        if (!hasAccess) {
            return res.status(403).json({ success: false, message: 'Akses ditolak' });
        }

        const templates = await ExpenseOrderTemplate.findByBranchId(parseInt(branchId));
        return res.json({ success: true, data: templates });
    } catch (error) {
        next(error);
    }
};

const createExpenseOrderTemplate = async (req, res, next) => {
    try {
        const { branchId } = req.params;
        const { name, templateData, isDefault } = req.body;

        const hasAccess = await Branch.userHasAccess(req.userId, parseInt(branchId), req.user.role);
        if (!hasAccess) {
            return res.status(403).json({ success: false, message: 'Akses ditolak' });
        }

        if (!name || !name.trim()) {
            return res.status(400).json({ success: false, message: 'Nama template wajib diisi' });
        }

        if (!templateData || !Array.isArray(templateData) || templateData.length === 0) {
            return res.status(400).json({ success: false, message: 'Data template tidak boleh kosong' });
        }

        const template = await ExpenseOrderTemplate.create({
            branchId: parseInt(branchId),
            name: name.trim(),
            templateData,
            isDefault: Boolean(isDefault)
        });

        return res.status(201).json({
            success: true,
            message: 'Template urutan pengeluaran berhasil disimpan',
            data: template
        });
    } catch (error) {
        next(error);
    }
};

const updateExpenseOrderTemplate = async (req, res, next) => {
    try {
        const { branchId, templateId } = req.params;
        const { name, templateData, isDefault } = req.body;

        const hasAccess = await Branch.userHasAccess(req.userId, parseInt(branchId), req.user.role);
        if (!hasAccess) {
            return res.status(403).json({ success: false, message: 'Akses ditolak' });
        }

        const template = await ExpenseOrderTemplate.findById(parseInt(templateId));
        if (!template || template.branch_id !== parseInt(branchId)) {
            return res.status(404).json({ success: false, message: 'Template tidak ditemukan' });
        }

        const updated = await ExpenseOrderTemplate.update(parseInt(templateId), {
            name: name ? name.trim() : undefined,
            templateData,
            isDefault: isDefault !== undefined ? Boolean(isDefault) : undefined
        });

        return res.json({
            success: true,
            message: 'Template berhasil diperbarui',
            data: updated
        });
    } catch (error) {
        next(error);
    }
};

const deleteExpenseOrderTemplate = async (req, res, next) => {
    try {
        const { branchId, templateId } = req.params;

        const hasAccess = await Branch.userHasAccess(req.userId, parseInt(branchId), req.user.role);
        if (!hasAccess) {
            return res.status(403).json({ success: false, message: 'Akses ditolak' });
        }

        const template = await ExpenseOrderTemplate.findById(parseInt(templateId));
        if (!template || template.branch_id !== parseInt(branchId)) {
            return res.status(404).json({ success: false, message: 'Template tidak ditemukan' });
        }

        await ExpenseOrderTemplate.delete(parseInt(templateId));

        return res.json({
            success: true,
            message: 'Template berhasil dihapus'
        });
    } catch (error) {
        next(error);
    }
};

module.exports = {
    getBagiHasilTemplates,
    createBagiHasilTemplate,
    updateBagiHasilTemplate,
    deleteBagiHasilTemplate,
    getExpenseOrderTemplates,
    createExpenseOrderTemplate,
    updateExpenseOrderTemplate,
    deleteExpenseOrderTemplate
};
