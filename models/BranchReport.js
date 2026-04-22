const { query } = require('../config/database');

class BranchReport {
    /**
     * Cari laporan berdasarkan branch_id, month, year.
     */
    static async findByBranchAndPeriod(branchId, month, year) {
        const rows = await query(
            `SELECT * FROM branch_reports WHERE branch_id = ? AND month = ? AND year = ? LIMIT 1`,
            [branchId, month, year]
        );
        if (!rows[0]) return null;

        const r = rows[0];
        try {
            r.sales_channels = r.sales_channels
                ? (typeof r.sales_channels === 'string' ? JSON.parse(r.sales_channels) : r.sales_channels)
                : [];
            r.bagi_hasil = r.bagi_hasil
                ? (typeof r.bagi_hasil === 'string' ? JSON.parse(r.bagi_hasil) : r.bagi_hasil)
                : [];
            r.expense_adjustments = r.expense_adjustments
                ? (typeof r.expense_adjustments === 'string' ? JSON.parse(r.expense_adjustments) : r.expense_adjustments)
                : [];
            r.expense_order = r.expense_order
                ? (typeof r.expense_order === 'string' ? JSON.parse(r.expense_order) : r.expense_order)
                : [];
        } catch (e) {
            console.error('JSON Parse Error in BranchReport:', e);
            r.sales_channels = r.sales_channels || [];
            r.bagi_hasil = r.bagi_hasil || [];
            r.expense_adjustments = r.expense_adjustments || [];
            r.expense_order = r.expense_order || [];
        }
        return r;
    }

    /**
     * Upsert: buat record baru atau update yang sudah ada.
     */
    static async upsert(branchId, month, year, data = {}) {
        const {
            omzetTotal = 0,
            pengeluaranTotal = 0,
            salesChannels = undefined,
            bagiHasil = undefined,
            expenseAdjustments = undefined,
            stokAwal = undefined,
            stokAkhir = undefined,
            workingDays = undefined,
        } = data;

        const salesChannelsValue = (salesChannels !== undefined) ? JSON.stringify(salesChannels) : null;
        const bagiHasilValue = (bagiHasil !== undefined) ? JSON.stringify(bagiHasil) : null;
        const expenseAdjustmentsValue = (expenseAdjustments !== undefined) ? JSON.stringify(expenseAdjustments) : null;
        const expenseOrder = data.expenseOrder;
        const expenseOrderValue = (expenseOrder !== undefined) ? JSON.stringify(expenseOrder) : null;

        const clean = (val) => (val === undefined ? null : val);

        await query(
            `INSERT INTO branch_reports 
            (branch_id, month, year, omzet_total, pengeluaran_total, sales_channels, bagi_hasil, expense_adjustments, expense_order, stok_awal, stok_akhir, working_days)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE 
            omzet_total = VALUES(omzet_total),
            pengeluaran_total = VALUES(pengeluaran_total),
            sales_channels = IF(VALUES(sales_channels) IS NOT NULL, VALUES(sales_channels), sales_channels),
            bagi_hasil = IF(VALUES(bagi_hasil) IS NOT NULL, VALUES(bagi_hasil), bagi_hasil),
            expense_adjustments = IF(VALUES(expense_adjustments) IS NOT NULL, VALUES(expense_adjustments), expense_adjustments),
            expense_order = IF(VALUES(expense_order) IS NOT NULL, VALUES(expense_order), expense_order),
            stok_awal = IF(? IS NOT NULL, ?, stok_awal),
            stok_akhir = IF(? IS NOT NULL, ?, stok_akhir),
            working_days = IF(? IS NOT NULL, ?, working_days),
            updated_at = CURRENT_TIMESTAMP`,
            [
                clean(branchId), clean(month), clean(year), 
                clean(omzetTotal), clean(pengeluaranTotal), 
                clean(salesChannelsValue), clean(bagiHasilValue), clean(expenseAdjustmentsValue), clean(expenseOrderValue),
                stokAwal !== undefined ? clean(stokAwal) : 0, 
                stokAkhir !== undefined ? clean(stokAkhir) : 0,
                workingDays !== undefined ? clean(workingDays) : 25,
                stokAwal !== undefined ? 1 : null, clean(stokAwal),
                stokAkhir !== undefined ? 1 : null, clean(stokAkhir),
                workingDays !== undefined ? 1 : null, clean(workingDays)
            ]
        );

        return await this.findByBranchAndPeriod(branchId, month, year);
    }

    /**
     * Update manual fields
     */
    static async updateManual(branchId, month, year, data = {}) {
        const {
            salesChannels,
            bagiHasil,
            expenseAdjustments,
            expenseOrder,
            stokAwal,
            stokAkhir,
            workingDays,
        } = data;

        const updates = [];
        const params = [];

        if (salesChannels !== undefined) {
            updates.push('sales_channels = ?');
            params.push(JSON.stringify(salesChannels));
        }
        if (bagiHasil !== undefined) {
            updates.push('bagi_hasil = ?');
            params.push(JSON.stringify(bagiHasil));
        }
        if (expenseAdjustments !== undefined) {
            updates.push('expense_adjustments = ?');
            params.push(JSON.stringify(expenseAdjustments));
        }
        if (expenseOrder !== undefined) {
            updates.push('expense_order = ?');
            params.push(JSON.stringify(expenseOrder));
        }
        if (stokAwal !== undefined) {
            updates.push('stok_awal = ?');
            params.push(stokAwal);
        }
        if (stokAkhir !== undefined) {
            updates.push('stok_akhir = ?');
            params.push(stokAkhir);
        }
        if (workingDays !== undefined) {
            updates.push('working_days = ?');
            params.push(workingDays);
        }

        if (updates.length === 0) {
            return await this.findByBranchAndPeriod(branchId, month, year);
        }

        updates.push('updated_at = CURRENT_TIMESTAMP');
        params.push(branchId, month, year);

        const cleanParams = params.map(p => (p === undefined ? null : p));

        await query(
            `UPDATE branch_reports SET ${updates.join(', ')}
            WHERE branch_id = ? AND month = ? AND year = ?`,
            cleanParams
        );

        return await this.findByBranchAndPeriod(branchId, month, year);
    }
}

module.exports = BranchReport;
