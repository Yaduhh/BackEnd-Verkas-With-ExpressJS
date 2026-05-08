const { query } = require('../config/database');

class PaymentMethod {
    static async findAll(branchId = null) {
        let sql = `
            SELECT pm.*, c.name as category_name 
            FROM payment_methods pm
            LEFT JOIN categories c ON pm.category_id = c.id
        `;
        const params = [];
        
        if (branchId) {
            sql += ' WHERE pm.branch_id = ? OR pm.branch_id IS NULL';
            params.push(branchId);
        }
        
        sql += ' ORDER BY pm.name ASC';
        return await query(sql, params);
    }

    static async findById(id) {
        const results = await query(`
            SELECT pm.*, c.name as category_name 
            FROM payment_methods pm
            LEFT JOIN categories c ON pm.category_id = c.id
            WHERE pm.id = ?
        `, [id]);
        return results[0] || null;
    }

    static async create(data) {
        const { name, branch_id, category_id, parent_id, is_taxable, is_active } = data;
        const result = await query(
            'INSERT INTO payment_methods (name, branch_id, category_id, parent_id, is_taxable, is_active) VALUES (?, ?, ?, ?, ?, ?)',
            [name, branch_id, category_id || null, parent_id || null, is_taxable !== undefined ? is_taxable : 1, is_active !== undefined ? is_active : 1]
        );
        return await this.findById(result.insertId);
    }

    static async update(id, data) {
        const { name, category_id, parent_id, is_taxable, is_active } = data;
        await query(
            'UPDATE payment_methods SET name = ?, category_id = ?, parent_id = ?, is_taxable = ?, is_active = ? WHERE id = ?',
            [name, category_id || null, parent_id || null, is_taxable !== undefined ? is_taxable : 1, is_active, id]
        );
        return await this.findById(id);
    }

    static async delete(id) {
        return await query('DELETE FROM payment_methods WHERE id = ?', [id]);
    }
}

module.exports = PaymentMethod;
