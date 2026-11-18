const { query, transaction } = require('../config/database');

class PaymentMethod {
    static async findAll(branchId = null, options = {}) {
        const { activeOnly = false } = options;
        let sql = `
            SELECT pm.*, c.name as category_name, ba.name as default_bank_account_name
            FROM payment_methods pm
            LEFT JOIN categories c ON pm.category_id = c.id
            LEFT JOIN bank_accounts ba ON pm.default_bank_account_id = ba.id
        `;
        const conditions = [];
        const params = [];

        if (branchId) {
            conditions.push('(pm.branch_id = ? OR pm.branch_id IS NULL)');
            params.push(branchId);
        }

        if (activeOnly) {
            conditions.push('pm.is_active = 1');
        }

        if (conditions.length > 0) {
            sql += ` WHERE ${conditions.join(' AND ')}`;
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
        if (!existing) return null;

        const { name, category_id, parent_id, is_taxable, is_active, default_bank_account_id } = data;
        const resolvedName = name !== undefined ? name : existing.name;
        const resolvedCategoryId = category_id !== undefined ? (category_id || null) : existing.category_id;
        const resolvedParentId = parent_id !== undefined ? (parent_id || null) : existing.parent_id;
        const resolvedIsTaxable = is_taxable !== undefined ? (is_taxable ? 1 : 0) : existing.is_taxable;
        const resolvedIsActive = is_active !== undefined ? (Number(is_active) ? 1 : 0) : existing.is_active;
        const resolvedBankId = default_bank_account_id !== undefined
            ? (default_bank_account_id || null)
            : existing.default_bank_account_id;

        await query(
            'UPDATE payment_methods SET name = ?, category_id = ?, parent_id = ?, is_taxable = ?, is_active = ?, default_bank_account_id = ? WHERE id = ?',
            [resolvedName, resolvedCategoryId, resolvedParentId, resolvedIsTaxable, resolvedIsActive, resolvedBankId, id]
        );
        return await this.findById(id);
    }

    static async toggleActive(id, explicitStatus = undefined) {
        const existing = await this.findById(id);
        if (!existing) return null;

        const nextStatus =
            explicitStatus !== undefined && explicitStatus !== null
                ? (Number(explicitStatus) ? 1 : 0)
                : (Number(existing.is_active) ? 0 : 1);

        await query('UPDATE payment_methods SET is_active = ? WHERE id = ?', [nextStatus, id]);
        return await this.findById(id);
    }

    static async countUsage(id) {
        const [tidRows, croiRows, crscRows, tscRows, childRows] = await Promise.all([
            query('SELECT COUNT(*) as cnt FROM transaction_income_details WHERE payment_method_id = ?', [id]),
            query('SELECT COUNT(*) as cnt FROM cashier_report_omzet_items WHERE payment_method_id = ?', [id]),
            query('SELECT COUNT(*) as cnt FROM cashier_report_sales_channels WHERE payment_method_id = ?', [id]),
            query('SELECT COUNT(*) as cnt FROM transaction_sales_channels WHERE payment_method_id = ?', [id]),
            query('SELECT COUNT(*) as cnt FROM payment_methods WHERE parent_id = ?', [id]),
        ]);

        return (
            Number(tidRows[0]?.cnt || 0) +
            Number(croiRows[0]?.cnt || 0) +
            Number(crscRows[0]?.cnt || 0) +
            Number(tscRows[0]?.cnt || 0) +
            Number(childRows[0]?.cnt || 0)
        );
    }

    static async delete(id) {
        const existing = await this.findById(id);
        if (!existing) return { deleted: false, soft_deactivated: false, not_found: true };

        // Proteksi: jangan hard delete jika sudah dipakai transaksi/laporan atau punya sub-metode
        // karena FK transaction_income_details memakai ON DELETE CASCADE.
        const usageCount = await this.countUsage(id);
        if (usageCount > 0) {
            await query('UPDATE payment_methods SET is_active = 0 WHERE id = ?', [id]);
            const updated = await this.findById(id);
            return {
                deleted: false,
                soft_deactivated: true,
                usage_count: usageCount,
                method: updated,
            };
        }

        await query('DELETE FROM payment_methods WHERE id = ?', [id]);
        return { deleted: true, soft_deactivated: false, usage_count: 0 };
    }
}

module.exports = PaymentMethod;
