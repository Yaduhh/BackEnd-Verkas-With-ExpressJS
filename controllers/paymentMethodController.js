const PaymentMethod = require('../models/PaymentMethod');

const MANAGE_ROLES = ['master', 'owner', 'co-owner'];

const canManagePaymentMethods = (user) => {
    const role = String(user?.role || '').toLowerCase();
    return MANAGE_ROLES.includes(role);
};

const paymentMethodController = {
    getAll: async (req, res) => {
        try {
            const branchId = req.query.branch_id;
            const activeOnly = req.query.active_only === 'true' || req.query.active_only === '1';
            const methods = await PaymentMethod.findAll(branchId, { activeOnly });
            res.json({ success: true, data: methods });
        } catch (error) {
            console.error('Error fetching payment methods:', error);
            res.status(500).json({ success: false, message: error.message });
        }
    },

    create: async (req, res) => {
        try {
            if (!canManagePaymentMethods(req.user)) {
                return res.status(403).json({ success: false, message: 'Tidak memiliki izin menambah metode pembayaran' });
            }
            const { name, branch_id, category_id, parent_id, is_taxable, default_bank_account_id } = req.body;
            if (!name) {
                return res.status(400).json({ success: false, message: 'Name is required' });
            }
            const method = await PaymentMethod.create({ name, branch_id, category_id, parent_id, is_taxable, default_bank_account_id });
            res.status(201).json({ success: true, data: method });
        } catch (error) {
            console.error('Error creating payment method:', error);
            res.status(500).json({ success: false, message: error.message });
        }
    },

    update: async (req, res) => {
        try {
            if (!canManagePaymentMethods(req.user)) {
                return res.status(403).json({ success: false, message: 'Tidak memiliki izin mengubah metode pembayaran' });
            }
            const { id } = req.params;
            const { name, category_id, parent_id, is_taxable, is_active, default_bank_account_id } = req.body;
            const method = await PaymentMethod.update(id, { name, category_id, parent_id, is_taxable, is_active, default_bank_account_id });
            if (!method) {
                return res.status(404).json({ success: false, message: 'Metode pembayaran tidak ditemukan' });
            }
            res.json({ success: true, data: method });
        } catch (error) {
            console.error('Error updating payment method:', error);
            res.status(500).json({ success: false, message: error.message });
        }
    },

    toggleActive: async (req, res) => {
        try {
            if (!canManagePaymentMethods(req.user)) {
                return res.status(403).json({ success: false, message: 'Tidak memiliki izin mengubah status metode pembayaran' });
            }
            const { id } = req.params;
            const method = await PaymentMethod.toggleActive(id, req.body?.is_active);
            if (!method) {
                return res.status(404).json({ success: false, message: 'Metode pembayaran tidak ditemukan' });
            }
            res.json({
                success: true,
                message: Number(method.is_active) === 1
                    ? `Metode "${method.name}" diaktifkan`
                    : `Metode "${method.name}" dinonaktifkan`,
                data: method,
            });
        } catch (error) {
            console.error('Error toggling payment method status:', error);
            res.status(500).json({ success: false, message: error.message });
        }
    },

    delete: async (req, res) => {
        try {
            if (!canManagePaymentMethods(req.user)) {
                return res.status(403).json({ success: false, message: 'Tidak memiliki izin menghapus metode pembayaran' });
            }
            const { id } = req.params;
            const result = await PaymentMethod.delete(id);
            if (result.not_found) {
                return res.status(404).json({ success: false, message: 'Metode pembayaran tidak ditemukan' });
            }
            if (result.soft_deactivated) {
                return res.json({
                    success: true,
                    soft_deactivated: true,
                    message: 'Metode pernah dipakai transaksi/laporan, sehingga statusnya diubah menjadi Nonaktif agar histori tetap aman.',
                    data: result.method,
                });
            }
            res.json({ success: true, soft_deactivated: false, message: 'Metode pembayaran berhasil dihapus' });
        } catch (error) {
            console.error('Error deleting payment method:', error);
            res.status(500).json({ success: false, message: error.message });
        }
    },

    reorder: async (req, res) => {
        try {
            const role = String(req.user?.role || '').toLowerCase();
            if (!['master', 'owner', 'co-owner', 'admin'].includes(role)) {
                return res.status(403).json({ success: false, message: 'Tidak memiliki izin mengubah urutan metode pembayaran' });
            }
            const { ordered_ids } = req.body;
            if (!Array.isArray(ordered_ids) || ordered_ids.length === 0) {
                return res.status(400).json({ success: false, message: 'ordered_ids wajib berupa array ID yang valid' });
            }
            await PaymentMethod.reorder(ordered_ids);
            res.json({ success: true, message: 'Urutan metode pembayaran berhasil disimpan' });
        } catch (error) {
            console.error('Error reordering payment methods:', error);
            res.status(500).json({ success: false, message: error.message });
        }
    }
};

module.exports = paymentMethodController;
