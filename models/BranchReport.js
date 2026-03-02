const { query } = require('../config/database');

class BranchReport {
    /**
     * Cari laporan berdasarkan branch_id, month, year.
     * Kalau belum ada, return null.
     */
    static async findByBranchAndPeriod(branchId, month, year) {
        const rows = await query(
            `SELECT * FROM branch_reports WHERE branch_id = ? AND month = ? AND year = ? LIMIT 1`,
            [branchId, month, year]
        );
        if (!rows[0]) return null;

        const r = rows[0];
        // Parse JSON columns
        r.sales_channels = r.sales_channels
            ? (typeof r.sales_channels === 'string' ? JSON.parse(r.sales_channels) : r.sales_channels)
            : [];
        r.bagi_hasil = r.bagi_hasil
            ? (typeof r.bagi_hasil === 'string' ? JSON.parse(r.bagi_hasil) : r.bagi_hasil)
            : [];
        return r;
    }

    /**
     * Upsert: buat record baru atau update yang sudah ada.
     * CRITICAL: stok_awal dan stok_akhir hanya di-update jika disediakan dalam data,
     *           jika tidak, nilai yang sudah ada di database tetap dipertahankan.
     */
    static async upsert(branchId, month, year, data = {}) {
        const {
            omzetTotal = 0,
            pengeluaranTotal = 0,
            salesChannels = null,
            bagiHasil = null,
            stokAwal = undefined,
            stokAkhir = undefined,
        } = data;

        const salesChannelsJson = salesChannels !== null ? JSON.stringify(salesChannels) : null;
        const bagiHasilJson = bagiHasil !== null ? JSON.stringify(bagiHasil) : null;

        // For INSERT, use default 0 if stok values not provided
        const insertStokAwal = stokAwal !== undefined ? stokAwal : 0;
        const insertStokAkhir = stokAkhir !== undefined ? stokAkhir : 0;

        // Build UPDATE clause - only update stok if provided
        let updateClause = `
        omzet_total       = VALUES(omzet_total),
        pengeluaran_total = VALUES(pengeluaran_total),
        sales_channels    = COALESCE(VALUES(sales_channels), sales_channels),
        bagi_hasil        = COALESCE(VALUES(bagi_hasil), bagi_hasil),
        updated_at        = CURRENT_TIMESTAMP`;

        // Only update stok_awal and stok_akhir if they are provided in data
        if (stokAwal !== undefined) {
            updateClause += `,\n        stok_awal         = VALUES(stok_awal)`;
        }
        if (stokAkhir !== undefined) {
            updateClause += `,\n        stok_akhir        = VALUES(stok_akhir)`;
        }

        await query(
            `INSERT INTO branch_reports
        (branch_id, month, year, omzet_total, pengeluaran_total, sales_channels, bagi_hasil, stok_awal, stok_akhir)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
        ${updateClause}`,
            [branchId, month, year, omzetTotal, pengeluaranTotal, salesChannelsJson, bagiHasilJson, insertStokAwal, insertStokAkhir]
        );

        return await this.findByBranchAndPeriod(branchId, month, year);
    }

    /**
     * Update hanya manual fields (sales_channels, bagi_hasil, stok).
     * omzet & pengeluaran tetap dari cache transaksi.
     */
    static async updateManual(branchId, month, year, data = {}) {
        const {
            salesChannels,
            bagiHasil,
            stokAwal,
            stokAkhir,
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
        if (stokAwal !== undefined) {
            updates.push('stok_awal = ?');
            params.push(stokAwal);
        }
        if (stokAkhir !== undefined) {
            updates.push('stok_akhir = ?');
            params.push(stokAkhir);
        }

        if (updates.length === 0) {
            return await this.findByBranchAndPeriod(branchId, month, year);
        }

        updates.push('updated_at = CURRENT_TIMESTAMP');
        params.push(branchId, month, year);

        await query(
            `UPDATE branch_reports SET ${updates.join(', ')}
       WHERE branch_id = ? AND month = ? AND year = ?`,
            params
        );

        return await this.findByBranchAndPeriod(branchId, month, year);
    }
}

module.exports = BranchReport;
