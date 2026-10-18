const SalesChannel = require('../models/SalesChannel');
const { query } = require('../config/database');

// Get Sales Channel Category Report
const getSalesChannelCategoryReport = async (req, res, next) => {
  try {
    const { categoryId } = req.params;
    const branchId = req.branchId || req.headers['x-branch-id'] || req.query.branch_id;
    if (!branchId) {
      return res.status(400).json({
        success: false,
        message: 'Branch ID wajib disertakan'
      });
    }

    const parsedBranchId = parseInt(branchId);
    const { month, year, start_date, end_date, sort = 'terlama' } = req.query;

    const currentYear = year ? parseInt(year) : new Date().getFullYear();
    const currentMonth = month !== undefined ? parseInt(month) : (new Date().getMonth() + 1);

    // Compute date range
    let startStr, endStr;
    if (start_date && end_date) {
      startStr = start_date;
      endStr = end_date;
    } else {
      const startDate = new Date(currentYear, currentMonth - 1, 1);
      const endDate = new Date(currentYear, currentMonth, 0); // last day of month
      startStr = `${startDate.getFullYear()}-${String(startDate.getMonth() + 1).padStart(2, '0')}-${String(startDate.getDate()).padStart(2, '0')}`;
      endStr = `${endDate.getFullYear()}-${String(endDate.getMonth() + 1).padStart(2, '0')}-${String(endDate.getDate()).padStart(2, '0')}`;
    }

    // Resolve Category
    let categoryInfo = {
      id: categoryId === 'null' || categoryId === 'uncategorized' ? null : (categoryId === 'all' ? 'all' : parseInt(categoryId)),
      name: 'Semua Kategori',
      code: null
    };

    if (categoryInfo.id !== 'all' && categoryInfo.id !== null) {
      const catRows = await query(
        `SELECT id, name, code, parent_id FROM categories WHERE id = ? LIMIT 1`,
        [categoryInfo.id]
      );
      if (catRows.length > 0) {
        categoryInfo.name = catRows[0].name;
        categoryInfo.code = catRows[0].code;
      } else {
        categoryInfo.name = `Kategori #${categoryInfo.id}`;
      }
    } else if (categoryInfo.id === null) {
      categoryInfo.name = 'Tanpa Kategori';
    }

    // Query Sales Channels for this category
    let channelQuery = `
      SELECT sc.*, c.name as category_name
      FROM sales_channels sc
      LEFT JOIN categories c ON sc.category_id = c.id
      WHERE sc.branch_id = ? AND sc.status_deleted = 0
    `;
    const channelParams = [parsedBranchId];

    if (categoryInfo.id !== 'all') {
      if (categoryInfo.id === null) {
        channelQuery += ` AND sc.category_id IS NULL`;
      } else {
        const isOmzet = /omzet|omset/i.test(categoryInfo.name || '');
        if (isOmzet) {
          channelQuery += ` AND (sc.category_id = ? OR sc.category_id IS NULL)`;
          channelParams.push(categoryInfo.id);
        } else {
          channelQuery += ` AND sc.category_id = ?`;
          channelParams.push(categoryInfo.id);
        }
      }
    }
    channelQuery += ` ORDER BY sc.name ASC`;
    const channels = await query(channelQuery, channelParams);

    // Natural sort channels (1. Dine In, 2. Take Away, etc.)
    channels.sort((a, b) => {
      const matchA = (a.name || '').match(/^(\d+)/);
      const matchB = (b.name || '').match(/^(\d+)/);
      if (matchA && matchB) {
        return parseInt(matchA[1], 10) - parseInt(matchB[1], 10);
      }
      return (a.name || '').localeCompare(b.name || '');
    });

    const channelIds = channels.map(c => c.id);

    // Query transactions in date range
    let trxQuery = `
      SELECT t.id, t.transaction_date, t.amount, t.pb1, t.note, t.lampiran, t.type, t.category_id,
             c.name as category_name, c.code as category_code, u.name as user_name
      FROM transactions t
      LEFT JOIN categories c ON t.category_id = c.id
      LEFT JOIN users u ON t.user_id = u.id
      WHERE t.branch_id = ? 
        AND t.status_deleted = 0
        AND t.type = 'income'
        AND t.transaction_date >= ?
        AND t.transaction_date <= ?
    `;
    const trxParams = [parsedBranchId, `${startStr} 00:00:00`, `${endStr} 23:59:59`];

    if (categoryInfo.id !== 'all') {
      if (categoryInfo.id === null) {
        trxQuery += ` AND t.category_id IS NULL`;
      } else {
        trxQuery += ` AND (
          t.category_id = ? 
          OR c.parent_id = ?
          OR EXISTS (
            SELECT 1 FROM transaction_sales_channels tsc_sub 
            WHERE tsc_sub.transaction_id = t.id 
              AND tsc_sub.sales_channel_id IN (${channelIds.length > 0 ? channelIds.map(() => '?').join(',') : 'NULL'})
          )
        )`;
        trxParams.push(categoryInfo.id, categoryInfo.id);
        if (channelIds.length > 0) {
          trxParams.push(...channelIds);
        }
      }
    }

    if (sort === 'terbaru') {
      trxQuery += ` ORDER BY t.transaction_date DESC, t.created_at DESC`;
    } else {
      trxQuery += ` ORDER BY t.transaction_date ASC, t.created_at ASC`;
    }

    const transactions = await query(trxQuery, trxParams);

    // Query transaction_sales_channels details
    let tscMap = new Map();
    let incomeDetailsMap = new Map();

    if (transactions.length > 0) {
      const trxIds = transactions.map(t => t.id);
      const placeholders = trxIds.map(() => '?').join(',');

      // 1. Transaction sales channels
      const tscRows = await query(
        `SELECT 
            tsc.id,
            tsc.transaction_id, 
            tsc.sales_channel_id, 
            tsc.payment_method_id,
            tsc.amount AS gross_amount,
            CASE 
                WHEN pm.is_taxable = 1 THEN tsc.amount - ROUND((tsc.amount * 10) / 110)
                ELSE tsc.amount
            END AS net_amount,
            CASE 
                WHEN pm.is_taxable = 1 THEN ROUND((tsc.amount * 10) / 110)
                ELSE 0
            END AS pb1_amount,
            COALESCE(pm.is_taxable, 0) AS is_taxable,
            sc.name AS sales_channel_name,
            sc.category_id AS sales_channel_category_id,
            pm.name AS payment_method_name
         FROM transaction_sales_channels tsc
         JOIN sales_channels sc ON tsc.sales_channel_id = sc.id
         JOIN transactions t ON tsc.transaction_id = t.id
         LEFT JOIN transaction_income_details tid_direct ON tsc.transaction_income_detail_id = tid_direct.id
         LEFT JOIN payment_methods pm ON COALESCE(
             tsc.payment_method_id,
             tid_direct.payment_method_id,
             (SELECT tid.payment_method_id FROM transaction_income_details tid WHERE tid.transaction_id = t.id LIMIT 1)
         ) = pm.id
         WHERE tsc.transaction_id IN (${placeholders})`,
        trxIds
      );

      for (const row of tscRows) {
        if (!tscMap.has(row.transaction_id)) {
          tscMap.set(row.transaction_id, []);
        }
        tscMap.get(row.transaction_id).push(row);
      }

      // 2. Transaction income details (payment methods & lampiran)
      const incomeRows = await query(
        `SELECT tid.*, pm.name as payment_method_name, pm.is_taxable
         FROM transaction_income_details tid
         LEFT JOIN payment_methods pm ON tid.payment_method_id = pm.id
         WHERE tid.transaction_id IN (${placeholders})`,
        trxIds
      );

      for (const row of incomeRows) {
        if (!incomeDetailsMap.has(row.transaction_id)) {
          incomeDetailsMap.set(row.transaction_id, []);
        }
        incomeDetailsMap.get(row.transaction_id).push(row);
      }
    }

    // Attach details & calculate per-transaction totals
    const channelStatsMap = new Map();
    channels.forEach(c => {
      channelStatsMap.set(c.id, {
        id: c.id,
        name: c.name,
        description: c.description,
        category_id: c.category_id,
        category_name: c.category_name,
        is_active: c.is_active,
        total_gross: 0,
        total_pb1: 0,
        total_net: 0,
        transaction_ids: new Set()
      });
    });

    let overallGross = 0;
    let overallPb1 = 0;
    let overallNet = 0;
    const overallTrxIds = new Set();

    transactions.forEach(t => {
      const scDetails = tscMap.get(t.id) || [];
      t.sales_channel_details = scDetails;
      t.income_details = incomeDetailsMap.get(t.id) || [];

      let trxGross = 0;
      let trxPb1 = 0;
      let trxNet = 0;

      if (scDetails.length > 0) {
        overallTrxIds.add(t.id);
        scDetails.forEach(scd => {
          const gross = parseFloat(scd.gross_amount || 0);
          const pb1 = parseFloat(scd.pb1_amount || 0);
          const net = parseFloat(scd.net_amount || 0);

          trxGross += gross;
          trxPb1 += pb1;
          trxNet += net;

          const stat = channelStatsMap.get(scd.sales_channel_id);
          if (stat) {
            stat.total_gross += gross;
            stat.total_pb1 += pb1;
            stat.total_net += net;
            stat.transaction_ids.add(t.id);
          }
        });
      } else {
        // Fallback if transaction in this category has no sales channel details yet
        const tAmount = parseFloat(t.amount || 0);
        const tPb1 = parseFloat(t.pb1 || 0);
        trxGross = tAmount;
        trxPb1 = tPb1;
        trxNet = Math.max(0, tAmount - tPb1);
      }

      t.channel_total_gross = trxGross;
      t.channel_total_pb1 = trxPb1;
      t.channel_total_net = trxNet;

      overallGross += trxGross;
      overallPb1 += trxPb1;
      overallNet += trxNet;
    });

    const channelsReport = channels.map(c => {
      const stat = channelStatsMap.get(c.id);
      const total_gross = stat ? stat.total_gross : 0;
      const total_pb1 = stat ? stat.total_pb1 : 0;
      const total_net = stat ? stat.total_net : 0;
      const transaction_count = stat ? stat.transaction_ids.size : 0;
      const contribution_pct = overallGross > 0 ? ((total_gross / overallGross) * 100) : 0;

      return {
        id: c.id,
        name: c.name,
        description: c.description,
        category_id: c.category_id,
        category_name: c.category_name,
        is_active: c.is_active,
        total_gross,
        total_pb1,
        total_net,
        transaction_count,
        contribution_pct: Math.round(contribution_pct * 10) / 10
      };
    });

    res.json({
      success: true,
      data: {
        category: categoryInfo,
        period: {
          month: currentMonth,
          year: currentYear,
          startDate: startStr,
          endDate: endStr
        },
        summary: {
          total_gross: overallGross,
          total_pb1: overallPb1,
          total_net: overallNet,
          transaction_count: transactions.length,
          allocated_transaction_count: overallTrxIds.size,
          channel_count: channels.length
        },
        sales_channels: channelsReport,
        transactions
      }
    });
  } catch (error) {
    next(error);
  }
};

// Get all sales channels
const getSalesChannels = async (req, res, next) => {
  try {
    const branchId = req.branchId || req.headers['x-branch-id'] || req.query.branch_id;
    if (!branchId) {
      return res.status(400).json({
        success: false,
        message: 'Branch ID wajib disertakan'
      });
    }

    const { include_inactive, only_deleted, category_id } = req.query;

    const channels = await SalesChannel.findAll({
      branchId: parseInt(branchId),
      categoryId: category_id,
      includeInactive: include_inactive === 'true' || include_inactive === '1' || req.user.role === 'owner' || req.user.role === 'master',
      onlyDeleted: only_deleted === 'true' || only_deleted === '1'
    });

    res.json({
      success: true,
      data: channels
    });
  } catch (error) {
    next(error);
  }
};

// Get single sales channel
const getSalesChannelById = async (req, res, next) => {
  try {
    const { id } = req.params;
    const channel = await SalesChannel.findById(parseInt(id));

    if (!channel) {
      return res.status(404).json({
        success: false,
        message: 'Sales Channel tidak ditemukan'
      });
    }

    res.json({
      success: true,
      data: channel
    });
  } catch (error) {
    next(error);
  }
};

// Create sales channel
const createSalesChannel = async (req, res, next) => {
  try {
    const branchId = req.branchId || req.headers['x-branch-id'] || req.body.branch_id;
    if (!branchId) {
      return res.status(400).json({
        success: false,
        message: 'Branch ID wajib disertakan'
      });
    }

    const { category_id, name, description, is_active = true } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({
        success: false,
        message: 'Nama Sales Channel wajib diisi'
      });
    }

    const channel = await SalesChannel.create({
      branchId: parseInt(branchId),
      categoryId: category_id ? parseInt(category_id) : null,
      name: name.trim(),
      description: description ? description.trim() : null,
      isActive: is_active !== false && is_active !== 0 && is_active !== '0'
    });

    res.status(201).json({
      success: true,
      message: 'Sales Channel berhasil dibuat',
      data: channel
    });
  } catch (error) {
    next(error);
  }
};

// Update sales channel
const updateSalesChannel = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { category_id, name, description, is_active } = req.body;

    const existing = await SalesChannel.findById(parseInt(id));
    if (!existing) {
      return res.status(404).json({
        success: false,
        message: 'Sales Channel tidak ditemukan'
      });
    }

    const updated = await SalesChannel.update(parseInt(id), {
      categoryId: category_id !== undefined ? (category_id ? parseInt(category_id) : null) : undefined,
      name: name !== undefined ? name.trim() : undefined,
      description: description !== undefined ? description.trim() : undefined,
      isActive: is_active !== undefined ? (is_active !== false && is_active !== 0 && is_active !== '0') : undefined
    });

    res.json({
      success: true,
      message: 'Sales Channel berhasil diperbarui',
      data: updated
    });
  } catch (error) {
    next(error);
  }
};

// Soft delete sales channel
const deleteSalesChannel = async (req, res, next) => {
  try {
    const { id } = req.params;
    const existing = await SalesChannel.findById(parseInt(id));

    if (!existing) {
      return res.status(404).json({
        success: false,
        message: 'Sales Channel tidak ditemukan'
      });
    }

    await SalesChannel.softDelete(parseInt(id));

    res.json({
      success: true,
      message: 'Sales Channel berhasil dihapus'
    });
  } catch (error) {
    next(error);
  }
};

// Restore soft deleted sales channel
const restoreSalesChannel = async (req, res, next) => {
  try {
    const { id } = req.params;
    const restored = await SalesChannel.restore(parseInt(id));

    if (!restored) {
      return res.status(404).json({
        success: false,
        message: 'Sales Channel tidak ditemukan'
      });
    }

    res.json({
      success: true,
      message: 'Sales Channel berhasil dipulihkan',
      data: restored
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getSalesChannels,
  getSalesChannelById,
  getSalesChannelCategoryReport,
  createSalesChannel,
  updateSalesChannel,
  deleteSalesChannel,
  restoreSalesChannel
};
