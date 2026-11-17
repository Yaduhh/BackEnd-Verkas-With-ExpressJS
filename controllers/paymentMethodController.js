const PaymentMethod = require('../models/PaymentMethod');

const paymentMethodController = {
    getAll: async (req, res) => {
        try {
            const branchId = req.query.branch_id;
            const methods = await PaymentMethod.findAll(branchId);
            res.json({ success: true, data: methods });
        } catch (error) {
            console.error('Error fetching payment methods:', error);
            res.status(500).json({ success: false, message: error.message });
        }
    },

    create: async (req, res) => {
        try {
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
            const { id } = req.params;
            const { name, category_id, parent_id, is_taxable, is_active, default_bank_account_id } = req.body;
            const method = await PaymentMethod.update(id, { name, category_id, parent_id, is_taxable, is_active, default_bank_account_id });
            res.json({ success: true, data: method });
        } catch (error) {
            console.error('Error updating payment method:', error);
            res.status(500).json({ success: false, message: error.message });
        }
    },

    delete: async (req, res) => {
        try {
            const { id } = req.params;
            await PaymentMethod.delete(id);
            res.json({ success: true, message: 'Payment method deleted' });
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
