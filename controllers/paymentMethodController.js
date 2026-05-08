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
            const { name, branch_id, category_id, parent_id, is_taxable } = req.body;
            if (!name) {
                return res.status(400).json({ success: false, message: 'Name is required' });
            }
            const method = await PaymentMethod.create({ name, branch_id, category_id, parent_id, is_taxable });
            res.status(201).json({ success: true, data: method });
        } catch (error) {
            console.error('Error creating payment method:', error);
            res.status(500).json({ success: false, message: error.message });
        }
    },

    update: async (req, res) => {
        try {
            const { id } = req.params;
            const { name, category_id, parent_id, is_taxable, is_active } = req.body;
            const method = await PaymentMethod.update(id, { name, category_id, parent_id, is_taxable, is_active });
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
    }
};

module.exports = paymentMethodController;
