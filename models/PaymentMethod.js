const { query, transaction } = require('../config/database');

class PaymentMethod {
    static async findAll(branchId = null) {
        let sql = `
            SELECT pm.*, c.name as category_name, ba.name as default_bank_account_name
            FROM payment_methods pm
            LEFT JOIN categories c ON pm.category_id = c.id
            LEFT JOIN bank_accounts ba ON pm.default_bank_account_id = ba.id
        `;
        const params = [];
        
        if (branchId) {
            sql += ' WHERE pm.branch_id = ? OR pm.branch_id IS NULL';
            params.push(branchId);
        }
        
        sql += ' ORDER BY pm.sort_order ASC, pm.name ASC, pm.id ASC';
        return await query(sql, params);
    }

    static async findById(id) {
        const results = await query(`
            SELECT pm.*, c.name as category_name, ba.name as default_bank_account_name
            FROM payment_methods pm
            LEFT JOIN categories c ON pm.category_id = c.id
            LEFT JOIN bank_accounts ba ON pm.default_bank_account_id = ba.id
            WHERE pm.id = ?
        `, [id]);
        return results[0] || null;
    }

    static async create(data) {
        const { name, branch_id, category_id, parent_id, is_taxable, is_active, default_bank_account_id, sort_order } = data;
        let nextOrder = sort_order !== undefined && sort_order !== null ? parseInt(sort_order, 10) : null;
        if (nextOrder === null || Number.isNaN(nextOrder)) {
            const maxRows = await query('SELECT COALESCE(MAX(sort_order), 0) as max_order FROM payment_methods');
            nextOrder = parseInt(maxRows[0]?.max_order || 0, 10) + 1;
        }
        const result = await query(
            'INSERT INTO payment_methods (name, branch_id, category_id, parent_id, is_taxable, is_active, default_bank_account_id, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
            [name, branch_id, category_id || null, parent_id || null, is_taxable !== undefined ? is_taxable : 1, is_active !== undefined ? is_active : 1, default_bank_account_id || null, nextOrder]
        );
        return await this.findById(result.insertId);
    }

    static async reorder(orderedIds) {
        const cleanIds = Array.from(
            new Set((Array.isArray(orderedIds) ? orderedIds : []).map((id) => parseInt(id, 10)).filter((id) => Number.isFinite(id) && id > 0))
        );
        if (cleanIds.length === 0) return;

        await transaction(async (conn) => {
            for (let i = 0; i < cleanIds.length; i += 1) {
                await conn.execute('UPDATE payment_methods SET sort_order = ? WHERE id = ?', [i + 1, cleanIds[i]]);
            }
        });
    }

    static async update(id, data) {
        const existing = await this.findById(id);
        const { name, category_id, parent_id, is_taxable, is_active, default_bank_account_id } = data;
        const resolvedBankId = default_bank_account_id !== undefined
            ? (default_bank_account_id || null)
            : (existing ? existing.default_bank_account_id : null);
        await query(
            'UPDATE payment_methods SET name = ?, category_id = ?, parent_id = ?, is_taxable = ?, is_active = ?, default_bank_account_id = ? WHERE id = ?',
            [name, category_id || null, parent_id || null, is_taxable !== undefined ? is_taxable : 1, is_active, resolvedBankId, id]
        );
        return await this.findById(id);
    }

    static async delete(id) {
        return await query('DELETE FROM payment_methods WHERE id = ?', [id]);
    }
}

module.exports = PaymentMethod;
