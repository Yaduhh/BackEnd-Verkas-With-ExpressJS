const { query } = require('../config/database');

class GroupReport {
    /**
     * Cari laporan grup berdasarkan ownerId, groupName, month, year.
     */
    static async findByGroupAndPeriod(ownerId, groupName, month, year) {
        const rows = await query(
            `SELECT * FROM group_reports WHERE owner_id = ? AND group_name = ? AND month = ? AND year = ? LIMIT 1`,
            [ownerId, groupName, month, year]
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
            r.disabled_categories = r.disabled_categories
                ? (typeof r.disabled_categories === 'string' ? JSON.parse(r.disabled_categories) : r.disabled_categories)
                : [];
        } catch (e) {
            console.error('JSON Parse Error in GroupReport:', e);
            r.sales_channels = r.sales_channels || [];
            r.bagi_hasil = r.bagi_hasil || [];
            r.expense_adjustments = r.expense_adjustments || [];
            r.expense_order = r.expense_order || [];
            r.disabled_categories = r.disabled_categories || [];
        }
        return r;
    }

    /**
     * Upsert: buat record baru atau update yang sudah ada untuk laporan grup.
     */
    static async upsert(ownerId, groupName, month, year, data = {}) {
        const {
            stokAwal = undefined,
            stokAkhir = undefined,
            bagiHasil = undefined,
            workingDays = undefined,
            salesChannels = undefined,
            expenseAdjustments = undefined,
            expenseOrder = undefined,
            disabledCategories = undefined
        } = data;

        const bagiHasilValue = (bagiHasil !== undefined) ? JSON.stringify(bagiHasil) : null;
        const salesChannelsValue = (salesChannels !== undefined) ? JSON.stringify(salesChannels) : null;
        const expenseAdjustmentsValue = (expenseAdjustments !== undefined) ? JSON.stringify(expenseAdjustments) : null;
        const expenseOrderValue = (expenseOrder !== undefined) ? JSON.stringify(expenseOrder) : null;
        const disabledCategoriesValue = (disabledCategories !== undefined) ? JSON.stringify(disabledCategories) : null;

        const clean = (val) => (val === undefined ? null : val);

        await query(
            `INSERT INTO group_reports 
            (owner_id, group_name, month, year, stok_awal, stok_akhir, working_days, bagi_hasil, sales_channels, expense_adjustments, expense_order, disabled_categories)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE 
            stok_awal = IF(? IS NOT NULL, ?, stok_awal),
            stok_akhir = IF(? IS NOT NULL, ?, stok_akhir),
            working_days = IF(? IS NOT NULL, ?, working_days),
            bagi_hasil = IF(VALUES(bagi_hasil) IS NOT NULL, VALUES(bagi_hasil), bagi_hasil),
            sales_channels = IF(VALUES(sales_channels) IS NOT NULL, VALUES(sales_channels), sales_channels),
            expense_adjustments = IF(VALUES(expense_adjustments) IS NOT NULL, VALUES(expense_adjustments), expense_adjustments),
            expense_order = IF(VALUES(expense_order) IS NOT NULL, VALUES(expense_order), expense_order),
            disabled_categories = IF(VALUES(disabled_categories) IS NOT NULL, VALUES(disabled_categories), disabled_categories),
            updated_at = CURRENT_TIMESTAMP`,
            [
                clean(ownerId), clean(groupName), clean(month), clean(year),
                stokAwal !== undefined ? clean(stokAwal) : 0,
                stokAkhir !== undefined ? clean(stokAkhir) : 0,
                workingDays !== undefined ? clean(workingDays) : 25,
                clean(bagiHasilValue),
                clean(salesChannelsValue),
                clean(expenseAdjustmentsValue),
                clean(expenseOrderValue),
                clean(disabledCategoriesValue),
                stokAwal !== undefined ? 1 : null, clean(stokAwal),
                stokAkhir !== undefined ? 1 : null, clean(stokAkhir),
                workingDays !== undefined ? 1 : null, clean(workingDays)
            ]
        );

        return await this.findByGroupAndPeriod(ownerId, groupName, month, year);
    }
}

module.exports = GroupReport;
