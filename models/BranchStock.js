const { query } = require('../config/database');

let tableEnsured = false;

class BranchStock {
  static async ensureTable() {
    if (tableEnsured) return;
    await query(`
      CREATE TABLE IF NOT EXISTS branch_stocks (
        id INT AUTO_INCREMENT PRIMARY KEY,
        branch_id INT NOT NULL,
        kode VARCHAR(100) NOT NULL DEFAULT '',
        nama_produk VARCHAR(255) NOT NULL,
        satuan VARCHAR(50) NOT NULL DEFAULT 'PCS',
        stok_awal DECIMAL(18, 2) NOT NULL DEFAULT 0.00,
        hpp_awal DECIMAL(18, 2) NOT NULL DEFAULT 0.00,
        beli DECIMAL(18, 2) NOT NULL DEFAULT 0.00,
        retur_jual DECIMAL(18, 2) NOT NULL DEFAULT 0.00,
        transfer_masuk DECIMAL(18, 2) NOT NULL DEFAULT 0.00,
        total_barang DECIMAL(18, 2) NOT NULL DEFAULT 0.00,
        jual DECIMAL(18, 2) NOT NULL DEFAULT 0.00,
        retur_beli DECIMAL(18, 2) NOT NULL DEFAULT 0.00,
        transfer_keluar DECIMAL(18, 2) NOT NULL DEFAULT 0.00,
        penyesuaian_stok DECIMAL(18, 2) NOT NULL DEFAULT 0.00,
        qty_akhir DECIMAL(18, 2) NOT NULL DEFAULT 0.00,
        hpp_akhir DECIMAL(18, 2) NOT NULL DEFAULT 0.00,
        total_hpp DECIMAL(18, 2) NOT NULL DEFAULT 0.00,
        status_deleted TINYINT(1) NOT NULL DEFAULT 0,
        deleted_at DATETIME NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_branch_stocks_branch (branch_id, status_deleted),
        INDEX idx_branch_stocks_kode (branch_id, kode)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);
    tableEnsured = true;
  }

  static round2(val) {
    const n = Number(val);
    if (!Number.isFinite(n)) return 0;
    return Math.round((n + Number.EPSILON) * 100) / 100;
  }

  static normalizePayload(data = {}) {
    const stok_awal = this.round2(data.stok_awal);
    const hpp_awal = this.round2(data.hpp_awal);
    const beli = this.round2(data.beli);
    const retur_jual = this.round2(data.retur_jual);
    const transfer_masuk = this.round2(data.transfer_masuk);

    const calcTotalBarang = this.round2(stok_awal + beli + retur_jual + transfer_masuk);
    const total_barang =
      data.total_barang !== undefined && data.total_barang !== null && data.total_barang !== ''
        ? this.round2(data.total_barang)
        : calcTotalBarang;

    const jual = this.round2(data.jual);
    const retur_beli = this.round2(data.retur_beli);
    const transfer_keluar = this.round2(data.transfer_keluar);
    const penyesuaian_stok = this.round2(data.penyesuaian_stok);

    const calcQtyAkhir = this.round2(
      total_barang - (jual + retur_beli + transfer_keluar) + penyesuaian_stok
    );
    const qty_akhir =
      data.qty_akhir !== undefined && data.qty_akhir !== null && data.qty_akhir !== ''
        ? this.round2(data.qty_akhir)
        : calcQtyAkhir;

    const hpp_akhir =
      data.hpp_akhir !== undefined && data.hpp_akhir !== null && data.hpp_akhir !== ''
        ? this.round2(data.hpp_akhir)
        : qty_akhir > 0
        ? hpp_awal
        : 0;

    const calcTotalHpp = this.round2(qty_akhir * hpp_akhir);
    const total_hpp =
      data.total_hpp !== undefined && data.total_hpp !== null && data.total_hpp !== ''
        ? this.round2(data.total_hpp)
        : calcTotalHpp;

    return {
      kode: String(data.kode || '').trim().toUpperCase(),
      nama_produk: String(data.nama_produk || '').trim(),
      satuan: String(data.satuan || 'PCS').trim().toUpperCase(),
      stok_awal,
      hpp_awal,
      beli,
      retur_jual,
      transfer_masuk,
      total_barang,
      jual,
      retur_beli,
      transfer_keluar,
      penyesuaian_stok,
      qty_akhir,
      hpp_akhir,
      total_hpp
    };
  }

  static async findAll({ branchId, search = '', satuan = '' } = {}) {
    if (!branchId) return [];
    await this.ensureTable();

    let sql = `
      SELECT *
      FROM branch_stocks
      WHERE branch_id = ? AND status_deleted = 0
    `;
    const params = [parseInt(branchId)];

    if (search && search.trim()) {
      const q = `%${search.trim()}%`;
      sql += ` AND (kode LIKE ? OR nama_produk LIKE ? OR satuan LIKE ?)`;
      params.push(q, q, q);
    }

    if (satuan && satuan.trim() && satuan !== 'all') {
      sql += ` AND UPPER(satuan) = UPPER(?)`;
      params.push(satuan.trim());
    }

    sql += ` ORDER BY nama_produk ASC, kode ASC`;
    const rows = await query(sql, params);
    return rows.map((r) => ({
      ...r,
      stok_awal: Number(r.stok_awal) || 0,
      hpp_awal: Number(r.hpp_awal) || 0,
      beli: Number(r.beli) || 0,
      retur_jual: Number(r.retur_jual) || 0,
      transfer_masuk: Number(r.transfer_masuk) || 0,
      total_barang: Number(r.total_barang) || 0,
      jual: Number(r.jual) || 0,
      retur_beli: Number(r.retur_beli) || 0,
      transfer_keluar: Number(r.transfer_keluar) || 0,
      penyesuaian_stok: Number(r.penyesuaian_stok) || 0,
      qty_akhir: Number(r.qty_akhir) || 0,
      hpp_akhir: Number(r.hpp_akhir) || 0,
      total_hpp: Number(r.total_hpp) || 0
    }));
  }

  static async findById(id) {
    await this.ensureTable();
    const rows = await query(
      `SELECT * FROM branch_stocks WHERE id = ? AND status_deleted = 0 LIMIT 1`,
      [parseInt(id)]
    );
    if (!rows[0]) return null;
    const r = rows[0];
    return {
      ...r,
      stok_awal: Number(r.stok_awal) || 0,
      hpp_awal: Number(r.hpp_awal) || 0,
      beli: Number(r.beli) || 0,
      retur_jual: Number(r.retur_jual) || 0,
      transfer_masuk: Number(r.transfer_masuk) || 0,
      total_barang: Number(r.total_barang) || 0,
      jual: Number(r.jual) || 0,
      retur_beli: Number(r.retur_beli) || 0,
      transfer_keluar: Number(r.transfer_keluar) || 0,
      penyesuaian_stok: Number(r.penyesuaian_stok) || 0,
      qty_akhir: Number(r.qty_akhir) || 0,
      hpp_akhir: Number(r.hpp_akhir) || 0,
      total_hpp: Number(r.total_hpp) || 0
    };
  }

  static async create(branchId, payload) {
    await this.ensureTable();
    const normalized = this.normalizePayload(payload);
    if (!normalized.nama_produk) {
      throw new Error('Nama Produk wajib diisi');
    }

    const result = await query(
      `INSERT INTO branch_stocks (
        branch_id, kode, nama_produk, satuan,
        stok_awal, hpp_awal,
        beli, retur_jual, transfer_masuk,
        total_barang,
        jual, retur_beli, transfer_keluar,
        penyesuaian_stok,
        qty_akhir, hpp_akhir, total_hpp,
        status_deleted
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
      [
        parseInt(branchId),
        normalized.kode,
        normalized.nama_produk,
        normalized.satuan,
        normalized.stok_awal,
        normalized.hpp_awal,
        normalized.beli,
        normalized.retur_jual,
        normalized.transfer_masuk,
        normalized.total_barang,
        normalized.jual,
        normalized.retur_beli,
        normalized.transfer_keluar,
        normalized.penyesuaian_stok,
        normalized.qty_akhir,
        normalized.hpp_akhir,
        normalized.total_hpp
      ]
    );

    return await this.findById(result.insertId);
  }

  static async update(id, payload) {
    await this.ensureTable();
    const existing = await this.findById(id);
    if (!existing) throw new Error('Data stok tidak ditemukan');

    const merged = { ...existing, ...payload };
    // Recalculate derived fields if not explicitly overridden
    if (payload.total_barang === undefined) delete merged.total_barang;
    if (payload.qty_akhir === undefined) delete merged.qty_akhir;
    if (payload.total_hpp === undefined) delete merged.total_hpp;

    const normalized = this.normalizePayload(merged);

    await query(
      `UPDATE branch_stocks SET
        kode = ?, nama_produk = ?, satuan = ?,
        stok_awal = ?, hpp_awal = ?,
        beli = ?, retur_jual = ?, transfer_masuk = ?,
        total_barang = ?,
        jual = ?, retur_beli = ?, transfer_keluar = ?,
        penyesuaian_stok = ?,
        qty_akhir = ?, hpp_akhir = ?, total_hpp = ?
       WHERE id = ?`,
      [
        normalized.kode,
        normalized.nama_produk,
        normalized.satuan,
        normalized.stok_awal,
        normalized.hpp_awal,
        normalized.beli,
        normalized.retur_jual,
        normalized.transfer_masuk,
        normalized.total_barang,
        normalized.jual,
        normalized.retur_beli,
        normalized.transfer_keluar,
        normalized.penyesuaian_stok,
        normalized.qty_akhir,
        normalized.hpp_akhir,
        normalized.total_hpp,
        parseInt(id)
      ]
    );

    return await this.findById(id);
  }

  static async softDelete(id, branchId = null) {
    await this.ensureTable();
    if (branchId) {
      await query(
        `UPDATE branch_stocks SET status_deleted = 1, deleted_at = NOW() WHERE id = ? AND branch_id = ?`,
        [parseInt(id), parseInt(branchId)]
      );
    } else {
      await query(
        `UPDATE branch_stocks SET status_deleted = 1, deleted_at = NOW() WHERE id = ?`,
        [parseInt(id)]
      );
    }
    return true;
  }

  static async bulkDelete(branchId, ids = []) {
    await this.ensureTable();
    const validIds = ids.map((i) => parseInt(i)).filter((i) => !isNaN(i) && i > 0);
    if (validIds.length === 0) return 0;
    const placeholders = validIds.map(() => '?').join(',');
    const res = await query(
      `DELETE FROM branch_stocks WHERE branch_id = ? AND id IN (${placeholders})`,
      [parseInt(branchId), ...validIds]
    );
    return res.affectedRows || 0;
  }

  static async deleteAllByBranch(branchId) {
    await this.ensureTable();
    const res = await query(
      `DELETE FROM branch_stocks WHERE branch_id = ?`,
      [parseInt(branchId)]
    );
    return res.affectedRows || 0;
  }
}

module.exports = BranchStock;

