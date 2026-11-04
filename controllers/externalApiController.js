const Branch = require('../models/Branch');
const Category = require('../models/Category');
const BankAccount = require('../models/BankAccount');
const Transaction = require('../models/Transaction');
const TransactionEdit = require('../models/TransactionEdit');
const TransactionRefund = require('../models/TransactionRefund');
const LockedPeriod = require('../models/LockedPeriod');
const User = require('../models/User');
const OwnerTeam = require('../models/OwnerTeam');
const { query } = require('../config/database');
const fs = require('fs');
const path = require('path');
const axios = require('axios');

const isFilename = (str) => typeof str === 'string' && /\.(jpe?g|png|webp|gif|svg|pdf|docx?|xlsx?)$/i.test(str.trim());

/**
 * Ensures attachments from external systems (like Bosgil) are copied or downloaded
 * into VerKas native upload storage (/uploads/<branchId>/pengeluaran/<filename>)
 */
const persistExternalAttachment = async (item, branchId) => {
  if (!item) return null;
  const rawUrl = typeof item === 'string' ? item : (item.url || item.path || '');
  if (!rawUrl) return null;

  // Title should never be a raw filename
  let itemTitle = 'Lampiran';
  if (typeof item === 'object' && item.title && !isFilename(item.title)) {
    itemTitle = item.title;
  }

  // If it's already a native VerKas upload path, keep it
  if (rawUrl.startsWith(`/uploads/${branchId}/`) || rawUrl.startsWith(`uploads/${branchId}/`)) {
    return {
      title: itemTitle,
      url: rawUrl.startsWith('/') ? rawUrl : `/${rawUrl}`
    };
  }

  try {
    const destDir = path.resolve(__dirname, `../uploads/${branchId}/pengeluaran`);
    if (!fs.existsSync(destDir)) {
      fs.mkdirSync(destDir, { recursive: true });
    }

    let urlPath = rawUrl;
    try {
      if (rawUrl.includes('/api/secure-file/view') || rawUrl.includes('?path=')) {
        const parsedSignUrl = new URL(rawUrl, 'http://localhost');
        const qPath = parsedSignUrl.searchParams.get('path');
        if (qPath) {
          urlPath = '/' + decodeURIComponent(qPath).replace(/^\/+/, '');
        }
      } else if (rawUrl.startsWith('http://') || rawUrl.startsWith('https://')) {
        urlPath = new URL(rawUrl).pathname;
      }
    } catch (e) {
      urlPath = rawUrl;
    }
    const originalFilename = path.basename(urlPath);
    if (!originalFilename || !originalFilename.includes('.')) {
      return { title: itemTitle, url: rawUrl };
    }

    const destFilePath = path.join(destDir, originalFilename);
    const verKasRelativeUrl = `/uploads/${branchId}/pengeluaran/${originalFilename}`;

    if (fs.existsSync(destFilePath) && fs.statSync(destFilePath).size > 0) {
      return {
        title: itemTitle,
        url: verKasRelativeUrl
      };
    }

    // 0. If moving across VerKas branches, check VerKas's own uploads folder first
    const verkasSelfCandidate = path.resolve(__dirname, '..', urlPath.replace(/^\/+/, ''));
    if (fs.existsSync(verkasSelfCandidate) && fs.statSync(verkasSelfCandidate).isFile()) {
      fs.copyFileSync(verkasSelfCandidate, destFilePath);
      return {
        title: itemTitle,
        url: verKasRelativeUrl
      };
    }

    // 1. Try copying from local filesystem if Bosgil uploads directory exists
    const candidateDirs = [
      process.env.BOSGIL_UPLOADS_DIR,
      '/www/wwwroot/bosgilgrup.vegaanggara.com/backend/uploads',
      path.resolve(__dirname, '../../bosgilgrup.vegaanggara.com/backend/uploads'),
      '/www/wwwroot/bosgilgrup-staging.vegaanggara.com/backend/uploads',
      path.resolve(__dirname, '../../../Backend-BSG-Express/uploads')
    ].filter(Boolean);

    let localSourcePath = null;

    for (const bsgUploadsDir of candidateDirs) {
      if (!fs.existsSync(bsgUploadsDir)) continue;

      if (urlPath.includes('/uploads/')) {
        const subPath = urlPath.substring(urlPath.indexOf('/uploads/') + '/uploads/'.length);
        const candidate = path.join(bsgUploadsDir, subPath);
        if (fs.existsSync(candidate)) {
          localSourcePath = candidate;
          break;
        }
      }

      const candidateSubPaths = [
        path.join('data-pengajuan/images', originalFilename),
        path.join('data-pengajuan/documents', originalFilename),
        path.join('general/images', originalFilename),
        path.join('general/documents', originalFilename)
      ];
      for (const relCandidate of candidateSubPaths) {
        const fullCandidate = path.join(bsgUploadsDir, relCandidate);
        if (fs.existsSync(fullCandidate)) {
          localSourcePath = fullCandidate;
          break;
        }
      }
      if (localSourcePath) break;
    }

    if (localSourcePath && fs.existsSync(localSourcePath)) {
      fs.copyFileSync(localSourcePath, destFilePath);
      return {
        title: itemTitle,
        url: verKasRelativeUrl
      };
    }

    // 2. If not found locally, attempt downloading via HTTP
    if (rawUrl.startsWith('http://') || rawUrl.startsWith('https://')) {
      const response = await axios.get(rawUrl, {
        responseType: 'arraybuffer',
        timeout: 10000
      });
      if (response.status === 200 && response.data) {
        fs.writeFileSync(destFilePath, Buffer.from(response.data));
        return {
          title: itemTitle,
          url: verKasRelativeUrl
        };
      }
    }

    return {
      title: itemTitle,
      url: verKasRelativeUrl
    };
  } catch (err) {
    console.error(`[persistExternalAttachment] Error processing ${rawUrl}:`, err.message);
    return {
      title: itemTitle,
      url: rawUrl
    };
  }
};

/**
 * Returns ONLY the active VerKas users belonging to the API Key owner's account/team ecosystem.
 * Never returns users belonging to other unrelated VerKas master/owner accounts.
 */
const getScopedVerkasUsers = async (ownerId) => {
  if (!ownerId) return [];
  try {
    const currentUser = await User.findById(ownerId);
    let teams = await OwnerTeam.findByUserId(ownerId);
    if (currentUser && currentUser.created_by) {
      const creatorTeams = await OwnerTeam.findByUserId(currentUser.created_by);
      teams = [...teams, ...creatorTeams];
    }

    const teamIds = [...new Set(teams.map(t => t.id))];
    let creatorIds = [ownerId];
    if (currentUser && currentUser.created_by) {
      creatorIds.push(currentUser.created_by);
    }

    if (teamIds.length > 0) {
      const memberRows = await query(
        `SELECT DISTINCT user_id FROM owner_team_members WHERE team_id IN (${teamIds.map(() => '?').join(',')}) AND status = 'active'`,
        teamIds
      );
      const teamOwners = await query(
        `SELECT DISTINCT primary_owner_id FROM owner_teams WHERE id IN (${teamIds.map(() => '?').join(',')})`,
        teamIds
      );
      creatorIds = [...new Set([
        ...creatorIds,
        ...memberRows.map(m => m.user_id),
        ...teamOwners.map(t => t.primary_owner_id)
      ])];
    }

    const placeholders = creatorIds.map(() => '?').join(',');
    let sql = `
      SELECT DISTINCT u.id, u.name, u.email, u.role
      FROM users u
      WHERE u.status_deleted = 0
        AND (
          u.id IN (${placeholders})
          OR u.created_by IN (${placeholders})
          OR u.id IN (
            SELECT DISTINCT bp.user_id
            FROM branch_pics bp
            JOIN branches b ON bp.branch_id = b.id
            WHERE b.status_deleted = 0
              AND (b.owner_id IN (${placeholders})
    `;
    const params = [...creatorIds, ...creatorIds, ...creatorIds];

    if (teamIds.length > 0) {
      sql += ` OR b.team_id IN (${teamIds.map(() => '?').join(',')})`;
      params.push(...teamIds);
    }

    sql += `)
          )
        )
      ORDER BY u.name ASC`;

    return await query(sql, params);
  } catch (err) {
    console.error('[getScopedVerkasUsers Error]:', err.message);
    return [];
  }
};

/**
 * Automatically resolves a Bosgil user (by manual mapping, email, name, or token similarity)
 * ONLY within the active VerKas users belonging to this API Key's VerKas account/team.
 */
const resolveVerkasUser = async (userInfo, fallbackUserId, fallbackUserObj = null) => {
  const defaultResult = {
    id: fallbackUserId,
    name: fallbackUserObj?.name || 'Admin VerKas',
    email: fallbackUserObj?.email || null,
    matched: false
  };

  if (!userInfo) return defaultResult;

  const explicitVerkasId = typeof userInfo === 'object' && userInfo.verkas_user_id
    ? parseInt(userInfo.verkas_user_id)
    : null;
  const rawName = typeof userInfo === 'string'
    ? userInfo.trim()
    : (userInfo.nama || userInfo.name || userInfo.username || '').trim();
  const rawEmail = typeof userInfo === 'object' && userInfo.email
    ? userInfo.email.trim().toLowerCase()
    : '';

  if (!explicitVerkasId && !rawName && !rawEmail) return defaultResult;

  try {
    const verkasUsers = await getScopedVerkasUsers(fallbackUserId);

    if (!verkasUsers || verkasUsers.length === 0) {
      return { ...defaultResult, name: rawName || defaultResult.name };
    }

    // 0. Explicit Manual Mapping (verkas_user_id)
    if (explicitVerkasId) {
      const explicitMatch = verkasUsers.find(u => u.id === explicitVerkasId);
      if (explicitMatch) {
        return {
          id: explicitMatch.id,
          name: explicitMatch.name,
          email: explicitMatch.email,
          role: explicitMatch.role,
          matched: true,
          manual_mapped: true
        };
      }
    }

    // 1. Exact Email Match
    if (rawEmail) {
      const exactEmailMatch = verkasUsers.find(
        u => u.email && u.email.trim().toLowerCase() === rawEmail
      );
      if (exactEmailMatch) {
        return {
          id: exactEmailMatch.id,
          name: exactEmailMatch.name,
          email: exactEmailMatch.email,
          role: exactEmailMatch.role,
          matched: true
        };
      }
    }

    const norm = (str) => (str || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
    const targetNameNorm = norm(rawName);

    // 2. Exact Name Match
    if (targetNameNorm) {
      const exactNameMatch = verkasUsers.find(
        u => norm(u.name) === targetNameNorm
      );
      if (exactNameMatch) {
        return {
          id: exactNameMatch.id,
          name: exactNameMatch.name,
          email: exactNameMatch.email,
          role: exactNameMatch.role,
          matched: true
        };
      }
    }

    // 3. Email Prefix Match (e.g., elissuryaningsih31@gmail.com <-> elissuryaningsih@icloud.com)
    if (rawEmail && rawEmail.includes('@')) {
      const stripDigits = (s) => s.split('@')[0].replace(/[0-9_.-]/g, '').toLowerCase();
      const targetPrefix = stripDigits(rawEmail);
      if (targetPrefix.length >= 5) {
        const prefixMatch = verkasUsers.find(u => {
          if (!u.email || !u.email.includes('@')) return false;
          const uPrefix = stripDigits(u.email);
          return uPrefix === targetPrefix;
        });
        if (prefixMatch) {
          return {
            id: prefixMatch.id,
            name: prefixMatch.name,
            email: prefixMatch.email,
            role: prefixMatch.role,
            matched: true
          };
        }
      }
    }

    // 4. Token / Multi-word Subset Match (e.g., "Qiara Liftania Ariani" <-> "Qiara Ariani", "Melda Agustin" <-> "Melda")
    if (targetNameNorm) {
      const targetTokens = targetNameNorm.split(' ').filter(Boolean);
      let bestMatch = null;
      let bestScore = 0;

      for (const u of verkasUsers) {
        const uNorm = norm(u.name);
        if (!uNorm) continue;
        const uTokens = uNorm.split(' ').filter(Boolean);
        if (uTokens.length === 0) continue;

        // Check if all tokens of VerKas name are in Bosgil name, or vice versa
        const allUTokensInTarget = uTokens.every(t => targetTokens.includes(t));
        const allTargetTokensInU = targetTokens.every(t => uTokens.includes(t));

        if (allUTokensInTarget || allTargetTokensInU) {
          const commonCount = uTokens.filter(t => targetTokens.includes(t)).length;
          // Prefer exact first name match + more matching tokens
          const firstTokenSame = uTokens[0] === targetTokens[0] ? 2 : 0;
          const score = commonCount * 3 + firstTokenSame;
          if (score > bestScore && uTokens[0].length >= 3) {
            bestScore = score;
            bestMatch = u;
          }
        }
      }

      if (bestMatch) {
        return {
          id: bestMatch.id,
          name: bestMatch.name,
          email: bestMatch.email,
          role: bestMatch.role,
          matched: true
        };
      }
    }
  } catch (err) {
    console.error('[resolveVerkasUser Error]:', err.message);
  }

  return {
    ...defaultResult,
    name: rawName || defaultResult.name
  };
};

/**
 * Controller for External API Integration (e.g. Bosgil Group)
 */
const externalApiController = {
  /**
   * GET /api/external/v1/meta
   * Returns metadata: Owner profile, accessible Branches, Expense Categories, and Operational Bank Accounts
   */
  getMeta: async (req, res, next) => {
    try {
      const ownerId = req.userId;
      const targetBranchId = req.branchId || (req.headers['x-branch-id'] ? parseInt(req.headers['x-branch-id']) : null);

      // 1. Get branches accessible by this owner/api key
      let branches = [];
      if (req.apiKey && req.apiKey.branch_id) {
        const b = await Branch.findById(req.apiKey.branch_id);
        if (b) branches = [b];
      } else {
        branches = await Branch.findByUserAccess(ownerId, req.user.role || 'owner');
      }

      // Filter active non-deleted branches
      branches = branches.filter(b => !b.status_deleted);

      // 2. Determine which branch IDs to fetch categories & accounts for
      const branchIds = targetBranchId ? [targetBranchId] : branches.map(b => b.id);

      // 3. Get All Categories (expense, income, both)
      let categories = [];
      if (branchIds.length > 0) {
        // Fetch all categories for branches or global categories
        const catRows = await query(
          `SELECT id, name, code, type, branch_id, is_default, is_folder, parent_id
           FROM categories
           WHERE (branch_id IN (${branchIds.map(() => '?').join(',')}) OR branch_id IS NULL OR user_id = ?)
             AND status_deleted = 0
           ORDER BY is_default DESC, name ASC`,
          [...branchIds, ownerId]
        );

        categories = catRows.map(cat => ({
          id: cat.id,
          name: cat.name,
          code: cat.code || null,
          type: cat.type || 'both',
          branch_id: cat.branch_id,
          parent_id: cat.parent_id,
          is_folder: Boolean(cat.is_folder)
        }));
      }

      // 4. Get Active Bank Accounts
      let bankAccounts = [];
      if (branchIds.length > 0) {
        const bankRows = await query(
          `SELECT ba.id, ba.name, ba.account_number, ba.type, ba.branch_id,
                  b.name as branch_name
           FROM bank_accounts ba
           JOIN branches b ON ba.branch_id = b.id
           WHERE ba.branch_id IN (${branchIds.map(() => '?').join(',')})
             AND ba.is_active = 1
           ORDER BY ba.branch_id ASC, ba.name ASC`,
          branchIds
        );

        bankAccounts = bankRows.map(ba => ({
          id: ba.id,
          name: ba.name,
          account_number: ba.account_number || null,
          type: ba.type,
          branch_id: ba.branch_id,
          branch_name: ba.branch_name
        }));
      }

      // 5. Get Locked Periods
      let lockedPeriods = [];
      if (branchIds.length > 0) {
        const lockedRows = await query(
          `SELECT branch_id, month, year, is_locked
           FROM locked_periods
           WHERE branch_id IN (${branchIds.map(() => '?').join(',')})
             AND is_locked = 1`,
          branchIds
        );
        lockedPeriods = lockedRows.map(lp => ({
          branch_id: lp.branch_id,
          month: lp.month,
          year: lp.year,
          is_locked: Boolean(lp.is_locked)
        }));
      }

      // 6. Get Active Products & Brands for accessible branches
      let products = [];
      if (branchIds.length > 0) {
        const prodRows = await query(
          `SELECT p.id, p.branch_id, p.category_id, p.name, p.description, p.is_active,
                  c.name AS category_name
           FROM products p
           LEFT JOIN categories c ON p.category_id = c.id
           WHERE p.branch_id IN (${branchIds.map(() => '?').join(',')})
             AND p.status_deleted = 0
             AND p.is_active = 1
           ORDER BY p.name ASC`,
          branchIds
        );

        if (prodRows.length > 0) {
          const prodIds = prodRows.map((p) => p.id);
          const brandRows = await query(
            `SELECT id, product_id, name, description, is_active
             FROM product_brands
             WHERE product_id IN (${prodIds.map(() => '?').join(',')})
               AND status_deleted = 0
               AND is_active = 1
             ORDER BY name ASC`,
            prodIds
          );

          const brandsByProd = {};
          for (const br of brandRows) {
            if (!brandsByProd[br.product_id]) brandsByProd[br.product_id] = [];
            brandsByProd[br.product_id].push({
              id: br.id,
              product_id: br.product_id,
              name: br.name,
              description: br.description || null,
              is_active: Boolean(br.is_active)
            });
          }

          products = prodRows.map((p) => ({
            id: p.id,
            branch_id: p.branch_id,
            category_id: p.category_id,
            category_name: p.category_name || null,
            name: p.name,
            description: p.description || null,
            is_active: Boolean(p.is_active),
            brands: brandsByProd[p.id] || []
          }));
        }
      }

      // 7. Get Active VerKas Users belonging ONLY to this API Key's VerKas account/team
      const verkasUsers = await getScopedVerkasUsers(ownerId);

      return res.json({
        success: true,
        data: {
          owner: {
            id: req.user.id,
            name: req.user.name,
            email: req.user.email
          },
          users: verkasUsers.map(u => ({
            id: u.id,
            name: u.name,
            email: u.email || null,
            role: u.role || 'user'
          })),
          branches: branches.map(b => ({
            id: b.id,
            name: b.name,
            code: b.code || null,
            address: b.address || null,
            phone: b.phone || null
          })),
          categories,
          products,
          bank_accounts: bankAccounts,
          locked_periods: lockedPeriods
        }
      });
    } catch (error) {
      console.error('[ExternalAPI getMeta Error]:', error);
      next(error);
    }
  },

  /**
   * POST /api/external/v1/transactions
   * Create an Expense transaction from external system (e.g. Bosgil PO)
   */
  createTransaction: async (req, res, next) => {
    try {
      const ownerId = req.userId;
      const {
        branch_id,
        type = 'expense',
        amount,
        date,
        category,
        category_id,
        bank_account_id,
        note,
        lampiran,
        external_reference_id,
        total_customer,
        apc,
        pb1,
        is_debt_payment,
        paid_amount,
        remaining_debt,
        mitra_piutang_id,
        is_savings,
        savings_details,
        product_items,
        is_umum = true,
        is_draft,
        sync_user,
        sync_reason,
        po_creator,
        po_approver,
        po_creator_name,
        po_approver_name
      } = req.body;

      // Determine Branch ID
      const finalBranchId = branch_id || req.branchId || (req.headers['x-branch-id'] ? parseInt(req.headers['x-branch-id']) : null);
      if (!finalBranchId) {
        return res.status(400).json({
          success: false,
          message: 'Branch ID (branch_id) is required.'
        });
      }

      // Check branch access
      const hasAccess = await Branch.userHasAccess(ownerId, parseInt(finalBranchId), req.user.role || 'owner');
      if (!hasAccess) {
        return res.status(403).json({
          success: false,
          message: `Forbidden: No access to Branch ID ${finalBranchId}`
        });
      }

      // Validate Amount
      const parsedAmount = parseFloat(amount);
      if (isNaN(parsedAmount) || parsedAmount <= 0) {
        return res.status(400).json({
          success: false,
          message: 'Nominal amount must be a positive number.'
        });
      }

      // Validate Date
      const txDate = date || new Date().toISOString().split('T')[0];
      const dateObj = new Date(txDate);
      if (isNaN(dateObj.getTime())) {
        return res.status(400).json({
          success: false,
          message: 'Invalid date format. Expected YYYY-MM-DD.'
        });
      }

      // Check Locked Period
      const txMonth = dateObj.getMonth() + 1;
      const txYear = dateObj.getFullYear();
      const isLocked = await LockedPeriod.isLocked(finalBranchId, txMonth, txYear);
      if (isLocked) {
        return res.status(403).json({
          success: false,
          message: `Pembukuan cabang untuk periode ${txMonth}/${txYear} sudah dikunci di VerKas.`
        });
      }

      // Validate Category (and auto-resolve if category_id belongs to a different branch)
      let finalCategoryId = category_id ? parseInt(category_id) : null;
      let finalCategoryName = category || '';

      if (finalCategoryId) {
        const catRecord = await Category.findById(finalCategoryId);
        if (
          !catRecord ||
          catRecord.status_deleted ||
          (catRecord.branch_id !== null &&
            catRecord.branch_id !== undefined &&
            parseInt(catRecord.branch_id) !== parseInt(finalBranchId))
        ) {
          // Category belongs to old branch or was deleted -> resolve by name in target branch
          const lookupName = (category || catRecord?.name || '').trim();
          finalCategoryId = null;
          if (lookupName) {
            const catRows = await query(
              `SELECT id, name FROM categories 
               WHERE (branch_id = ? OR branch_id IS NULL) 
                 AND LOWER(TRIM(name)) = LOWER(TRIM(?))
                 AND status_deleted = 0
               ORDER BY CASE WHEN branch_id = ? THEN 0 ELSE 1 END, id ASC
               LIMIT 1`,
              [finalBranchId, lookupName, finalBranchId]
            );
            if (catRows.length > 0) {
              finalCategoryId = catRows[0].id;
              finalCategoryName = catRows[0].name;
            }
          }
        } else if (!finalCategoryName) {
          finalCategoryName = catRecord.name;
        }
      }

      if (!finalCategoryId && category) {
        // Try finding category by name in this branch or default
        const catRows = await query(
          `SELECT id, name FROM categories 
           WHERE (branch_id = ? OR branch_id IS NULL) 
             AND LOWER(TRIM(name)) = LOWER(TRIM(?))
             AND status_deleted = 0
           ORDER BY CASE WHEN branch_id = ? THEN 0 ELSE 1 END, id ASC
           LIMIT 1`,
          [finalBranchId, category.trim(), finalBranchId]
        );
        if (catRows.length > 0) {
          finalCategoryId = catRows[0].id;
          finalCategoryName = catRows[0].name;
        }
      }

      // If category still not found, fallback to default or first available expense category
      if (!finalCategoryId) {
        const fallbackCats = await query(
          `SELECT id, name FROM categories 
           WHERE (branch_id = ? OR branch_id IS NULL)
             AND (type = ? OR type = 'both' OR type IS NULL)
             AND status_deleted = 0
           ORDER BY is_default DESC, id ASC
           LIMIT 1`,
          [finalBranchId, type]
        );
        if (fallbackCats.length > 0) {
          finalCategoryId = fallbackCats[0].id;
          finalCategoryName = fallbackCats[0].name;
        } else {
          return res.status(400).json({
            success: false,
            message: `Kategori ${type === 'income' ? 'pemasukan' : 'pengeluaran'} tidak ditemukan di VerKas untuk cabang ini.`
          });
        }
      }

      // Validate Bank Account (auto-fallback to target branch account if bank_account_id belongs to old branch)
      let finalBankAccountId = bank_account_id ? parseInt(bank_account_id) : null;
      let resolvedBankAccount = null;

      if (finalBankAccountId) {
        const targetAccount = await BankAccount.findById(finalBankAccountId);
        if (
          targetAccount &&
          targetAccount.is_active &&
          parseInt(targetAccount.branch_id) === parseInt(finalBranchId)
        ) {
          resolvedBankAccount = targetAccount;
        } else {
          // Account belongs to previous branch or is inactive -> pick matching account in target branch
          const preferredType =
            targetAccount?.type ||
            (Boolean(is_savings) ? 'savings' : type === 'income' ? 'income' : 'operational');
          const preferredAccounts = await BankAccount.findAll(finalBranchId, preferredType);
          if (preferredAccounts.length > 0) {
            resolvedBankAccount = preferredAccounts[0];
            finalBankAccountId = resolvedBankAccount.id;
          } else {
            finalBankAccountId = null;
          }
        }
      }

      if (!finalBankAccountId) {
        // Auto-select first operational/income/savings bank account of the branch if not specified
        const defaultType = Boolean(is_savings)
          ? 'savings'
          : type === 'income'
          ? 'income'
          : 'operational';
        const branchAccounts = await BankAccount.findAll(finalBranchId, defaultType);
        if (branchAccounts.length > 0) {
          resolvedBankAccount = branchAccounts[0];
          finalBankAccountId = resolvedBankAccount.id;
        } else {
          const allBranchAccounts = await BankAccount.findAll(finalBranchId);
          if (allBranchAccounts.length > 0) {
            resolvedBankAccount = allBranchAccounts[0];
            finalBankAccountId = resolvedBankAccount.id;
          } else {
            return res.status(400).json({
              success: false,
              message: 'Rekening kas operasional wajib dipilih (tidak ditemukan rekening kas aktif di cabang ini).'
            });
          }
        }
      }

      // Normalize savings_details & product_items across branches if needed
      let normalizedSavingsDetails = undefined;
      if (Array.isArray(savings_details)) {
        normalizedSavingsDetails = [];
        for (const sd of savings_details) {
          if (!sd || !parseFloat(sd.amount || 0)) continue;
          let sdCatId = sd.category_id ? parseInt(sd.category_id) : null;
          let sdCatName = sd.category_name || '';
          if (sdCatId) {
            const sdCatRecord = await Category.findById(sdCatId);
            if (
              !sdCatRecord ||
              sdCatRecord.status_deleted ||
              (sdCatRecord.branch_id !== null &&
                sdCatRecord.branch_id !== undefined &&
                parseInt(sdCatRecord.branch_id) !== parseInt(finalBranchId))
            ) {
              const lookupSdName = (sdCatName || sdCatRecord?.name || '').trim();
              sdCatId = null;
              if (lookupSdName) {
                const matchedSdRows = await query(
                  `SELECT id, name FROM categories
                   WHERE (branch_id = ? OR branch_id IS NULL)
                     AND LOWER(TRIM(name)) = LOWER(TRIM(?))
                     AND status_deleted = 0
                   ORDER BY CASE WHEN branch_id = ? THEN 0 ELSE 1 END, id ASC
                   LIMIT 1`,
                  [finalBranchId, lookupSdName, finalBranchId]
                );
                if (matchedSdRows.length > 0) {
                  sdCatId = matchedSdRows[0].id;
                  sdCatName = matchedSdRows[0].name;
                }
              }
            }
          }
          if (sdCatId) {
            normalizedSavingsDetails.push({
              ...sd,
              category_id: sdCatId,
              category_name: sdCatName,
              amount: parseFloat(sd.amount)
            });
          }
        }
      }

      let normalizedProductItems = undefined;
      if (Array.isArray(product_items)) {
        normalizedProductItems = [];
        for (const item of product_items) {
          if (!item || !parseFloat(item.amount || 0)) continue;
          let prodId = item.product_id ? parseInt(item.product_id) : null;
          let brandId = item.brand_id ? parseInt(item.brand_id) : null;
          if (prodId) {
            const prodRows = await query(
              `SELECT id, branch_id, name FROM products WHERE id = ? AND status_deleted = 0 LIMIT 1`,
              [prodId]
            );
            const prodRec = prodRows[0];
            if (!prodRec || parseInt(prodRec.branch_id) !== parseInt(finalBranchId)) {
              const lookupProdName = (item.product_name || prodRec?.name || '').trim();
              prodId = null;
              brandId = null;
              if (lookupProdName) {
                const newBranchProdRows = await query(
                  `SELECT id, name FROM products
                   WHERE branch_id = ? AND LOWER(TRIM(name)) = LOWER(TRIM(?)) AND status_deleted = 0
                   LIMIT 1`,
                  [finalBranchId, lookupProdName]
                );
                if (newBranchProdRows.length > 0) {
                  prodId = newBranchProdRows[0].id;
                  const lookupBrandName = (item.brand_name || '').trim();
                  if (lookupBrandName) {
                    const newBrandRows = await query(
                      `SELECT id FROM product_brands
                       WHERE product_id = ? AND LOWER(TRIM(name)) = LOWER(TRIM(?)) AND status_deleted = 0
                       LIMIT 1`,
                      [prodId, lookupBrandName]
                    );
                    if (newBrandRows.length > 0) {
                      brandId = newBrandRows[0].id;
                    }
                  }
                }
              }
            }
          }
          if (prodId) {
            normalizedProductItems.push({
              ...item,
              product_id: prodId,
              brand_id: brandId,
              amount: parseFloat(item.amount)
            });
          }
        }
      }

      // Format Lampiran (Normalize & persist to VerKas native upload storage)
      let formattedLampiran = null;
      if (lampiran) {
        let rawItems = [];
        if (Array.isArray(lampiran)) {
          rawItems = lampiran;
        } else if (typeof lampiran === 'string') {
          try {
            const parsed = JSON.parse(lampiran);
            rawItems = Array.isArray(parsed) ? parsed : [parsed];
          } catch {
            rawItems = [lampiran];
          }
        }

        const processedItems = [];
        for (const item of rawItems) {
          const persisted = await persistExternalAttachment(item, parseInt(finalBranchId));
          if (persisted && persisted.url) {
            processedItems.push(persisted);
          }
        }
        if (processedItems.length > 0) {
          formattedLampiran = JSON.stringify(processedItems);
        }
      }

      // Resolve Creator User (Pembuat PO / Transaksi) & Actor User (Finance / Sync User) in VerKas
      const creatorResolved = await resolveVerkasUser(
        po_creator || po_creator_name || sync_user,
        ownerId,
        req.user
      );
      const actorResolved = await resolveVerkasUser(
        sync_user || po_approver || po_approver_name || po_creator || po_creator_name,
        ownerId,
        req.user
      );
      const actorName = sync_user?.nama || sync_user?.name || po_approver?.nama || po_approver_name || po_creator?.nama || po_creator_name || actorResolved.name || 'Finance Bosgil';

      // Check if external_reference_id already exists -> update it with latest sync data
      if (external_reference_id) {
        const existingTx = await Transaction.findByExternalReference(external_reference_id);
        if (existingTx) {
          const isBranchMoved = parseInt(existingTx.branch_id) !== parseInt(finalBranchId);
          if (isBranchMoved && existingTx.transaction_date) {
            const oldDateObj = new Date(existingTx.transaction_date);
            if (!isNaN(oldDateObj.getTime())) {
              const oldMonth = oldDateObj.getMonth() + 1;
              const oldYear = oldDateObj.getFullYear();
              const isOldBranchLocked = await LockedPeriod.isLocked(existingTx.branch_id, oldMonth, oldYear);
              if (isOldBranchLocked) {
                return res.status(403).json({
                  success: false,
                  message: `Pembukuan cabang asal untuk periode ${oldMonth}/${oldYear} sudah dikunci di VerKas sehingga transaksi tidak dapat dipindahkan.`
                });
              }
            }
          }

          const isUmumVal = is_umum !== undefined
            ? (is_umum === true || is_umum === 1 || is_umum === '1' || is_umum === 'true')
            : (existingTx.is_umum !== 0 && existingTx.is_umum !== false);

          // Preserve net amount if this transaction already has refunds in VerKas
          const existingRefunds = await TransactionRefund.findByTransactionId(existingTx.id);
          const totalExistingRefund = (existingRefunds || []).reduce(
            (sum, r) => sum + parseFloat(r.amount || 0),
            0
          );
          const finalTxAmount =
            totalExistingRefund > 0 && parsedAmount >= totalExistingRefund
              ? Math.max(0, parsedAmount - totalExistingRefund)
              : parsedAmount;

          const oldDataObj = {
            branch_id: existingTx.branch_id,
            type: existingTx.type,
            amount: existingTx.amount,
            category: existingTx.category_name || finalCategoryName,
            note: existingTx.note,
            date: existingTx.transaction_date,
            lampiran: existingTx.lampiran,
            is_umum: existingTx.is_umum
          };

          const newDataObj = {
            branch_id: parseInt(finalBranchId),
            type: existingTx.type,
            amount: finalTxAmount,
            category: finalCategoryName,
            note: note ? note.trim() : existingTx.note,
            date: txDate,
            lampiran: formattedLampiran !== null ? formattedLampiran : existingTx.lampiran,
            is_umum: isUmumVal
          };

          await Transaction.update(existingTx.id, {
            branchId: parseInt(finalBranchId),
            amount: finalTxAmount,
            transactionDate: txDate,
            categoryId: finalCategoryId,
            bankAccountId: finalBankAccountId,
            isUmum: isUmumVal,
            isSavings: is_savings !== undefined
              ? (Boolean(is_savings) || (Array.isArray(normalizedSavingsDetails) && normalizedSavingsDetails.length > 0))
              : undefined,
            note: note ? note.trim() : existingTx.note,
            lampiran: formattedLampiran !== null ? formattedLampiran : existingTx.lampiran,
            savingsDetails: Array.isArray(normalizedSavingsDetails)
              ? normalizedSavingsDetails
              : (is_savings === false ? [] : undefined),
            productItems: Array.isArray(normalizedProductItems) ? normalizedProductItems : undefined
          });

          // Ensure transactions.user_id reflects the PO creator in VerKas
          if (creatorResolved.matched && existingTx.user_id !== creatorResolved.id) {
            await query('UPDATE transactions SET user_id = ? WHERE id = ?', [creatorResolved.id, existingTx.id]);
          }

          const finalReason = sync_reason
            ? `${sync_reason} (${actorName})`
            : isBranchMoved
            ? `Sinkronisasi Pembaruan & Perpindahan Cabang PO dari Bosgil (${actorName})`
            : `Sinkronisasi Pembaruan PO dari Bosgil (${actorName})`;

          // Log to activity history table (Audit Trail)
          TransactionEdit.create({
            transactionId: existingTx.id,
            requesterId: actorResolved.id,
            reason: finalReason,
            oldData: oldDataObj,
            newData: newDataObj,
            status: 'approved'
          }).catch(err => console.error('[ExternalAPI] Error logging update history:', err.message));

          return res.status(200).json({
            success: true,
            message: 'Transaksi VerKas berhasil diperbarui dari sinkronisasi Bosgil',
            data: {
              transaction_id: existingTx.id,
              branch_id: parseInt(finalBranchId),
              amount: finalTxAmount,
              date: txDate,
              category_id: finalCategoryId,
              category: finalCategoryName,
              bank_account_id: finalBankAccountId,
              bank_account_name: resolvedBankAccount ? resolvedBankAccount.name : null,
              external_reference_id: existingTx.external_reference_id,
              creator_verkas_user: creatorResolved,
              actor_verkas_user: actorResolved
            }
          });
        }
      }

      // Create Transaction (userId = creatorResolved.id so "Dibuat Oleh" shows Pembuat PO)
      const createdTx = await Transaction.create({
        userId: creatorResolved.id,
        branchId: parseInt(finalBranchId),
        type: type === 'income' ? 'income' : 'expense',
        categoryId: finalCategoryId,
        amount: parsedAmount,
        totalCustomer: total_customer ? parseInt(total_customer) : null,
        apc: apc ? parseFloat(apc) : null,
        pb1: pb1 ? parseFloat(pb1) : null,
        isDebtPayment: Boolean(is_debt_payment),
        paidAmount: paid_amount ? parseFloat(paid_amount) : null,
        remainingDebt: remaining_debt ? parseFloat(remaining_debt) : null,
        mitraPiutangId: mitra_piutang_id ? parseInt(mitra_piutang_id) : null,
        isSavings: Boolean(is_savings) || (Array.isArray(normalizedSavingsDetails) && normalizedSavingsDetails.length > 0),
        savingsDetails: Array.isArray(normalizedSavingsDetails) ? normalizedSavingsDetails : [],
        productItems: Array.isArray(normalizedProductItems) ? normalizedProductItems : [],
        note: note ? note.trim() : `[External Sync] ${type === 'income' ? 'Pemasukan' : 'Pengeluaran'} ${finalCategoryName}`,
        transactionDate: txDate,
        lampiran: formattedLampiran,
        bankAccountId: finalBankAccountId,
        isUmum: is_umum !== undefined ? (is_umum === true || is_umum === 1 || is_umum === '1' || is_umum === 'true') : true,
        isDraft: Boolean(is_draft),
        externalReferenceId: external_reference_id || null
      });

      // Get updated bank account balance
      const updatedAccount = await BankAccount.findById(finalBankAccountId);

      // Log to activity history table (Audit Trail)
      TransactionEdit.create({
        transactionId: createdTx.id,
        requesterId: actorResolved.id,
        reason: is_draft ? 'Draft Transaksi Dibuat' : 'Transaksi Dibuat',
        oldData: {},
        newData: {
          type: type === 'income' ? 'income' : 'expense',
          amount: parsedAmount,
          category: finalCategoryName,
          note: note ? note.trim() : `[External Sync] ${type === 'income' ? 'Pemasukan' : 'Pengeluaran'} ${finalCategoryName}`,
          date: txDate,
          lampiran: formattedLampiran,
          is_umum: is_umum !== undefined ? Boolean(is_umum) : true,
          external_sync_by: actorName
        },
        status: 'approved'
      }).catch(err => console.error('[ExternalAPI] Error logging create history:', err.message));

      return res.status(201).json({
        success: true,
        message: `Transaksi ${type === 'income' ? 'pemasukan' : 'pengeluaran'} berhasil dicatat ke VerKas`,
        data: {
          transaction_id: createdTx.id,
          branch_id: parseInt(finalBranchId),
          type: type === 'income' ? 'income' : 'expense',
          amount: parsedAmount,
          date: txDate,
          category: finalCategoryName,
          category_id: finalCategoryId,
          bank_account_id: finalBankAccountId,
          bank_account_name: updatedAccount ? updatedAccount.name : null,
          remaining_bank_balance: updatedAccount ? updatedAccount.balance : null,
          external_reference_id: external_reference_id || null
        }
      });
    } catch (error) {
      console.error('[ExternalAPI createTransaction Error]:', error);
      next(error);
    }
  },

  /**
   * DELETE /api/external/v1/transactions
   * Soft-delete an external transaction (e.g. removed category split of a PO)
   */
  deleteTransaction: async (req, res, next) => {
    try {
      const ownerId = req.userId;
      const external_reference_id = req.body?.external_reference_id || req.query?.external_reference_id;
      const transaction_id = req.body?.transaction_id || req.query?.transaction_id;
      const sync_user = req.body?.sync_user || null;
      const reason = req.body?.reason || 'Hapus Transaksi Kategori PO (Sync Bosgil)';

      if (!external_reference_id && !transaction_id) {
        return res.status(400).json({
          success: false,
          message: 'external_reference_id atau transaction_id wajib disertakan'
        });
      }

      let tx = null;
      if (transaction_id) {
        tx = await Transaction.findById(transaction_id);
      }
      if (!tx && external_reference_id) {
        tx = await Transaction.findByExternalReference(external_reference_id);
      }

      if (!tx) {
        return res.status(200).json({
          success: true,
          already_deleted: true,
          message: 'Transaksi sudah tidak aktif atau telah dihapus di VerKas'
        });
      }

      const txDateObj = new Date(tx.transaction_date);
      const isLocked = await LockedPeriod.isLocked(tx.branch_id, txDateObj.getMonth() + 1, txDateObj.getFullYear());
      if (isLocked) {
        return res.status(403).json({
          success: false,
          message: 'Tidak dapat menghapus transaksi: Periode tanggal transaksi sudah ditutup buku (Locked) di VerKas'
        });
      }

      const actorResolved = await resolveVerkasUser(sync_user, ownerId, req.user);
      const actorName = sync_user?.nama || sync_user?.name || actorResolved.name || 'Finance Bosgil';

      await Transaction.softDelete(tx.id);

      await TransactionEdit.create({
        transactionId: tx.id,
        requesterId: actorResolved.id,
        reason,
        oldData: {
          type: tx.type,
          amount: tx.amount,
          category: tx.category_name,
          note: tx.note,
          date: tx.transaction_date
        },
        newData: {
          action: 'soft_delete_external_split',
          external_reference_id: tx.external_reference_id,
          external_sync_by: `${actorName} (via Bosgil PO)`
        },
        status: 'approved'
      }).catch(err => console.error('[ExternalAPI] Error logging deleteTransaction history:', err.message));

      return res.status(200).json({
        success: true,
        message: 'Transaksi berhasil dihapus di VerKas',
        data: {
          deleted_transaction_id: tx.id,
          external_reference_id: tx.external_reference_id
        }
      });
    } catch (error) {
      console.error('[ExternalAPI deleteTransaction Error]:', error);
      next(error);
    }
  },

  /**
   * POST /api/external/v1/refunds
   * Record a refund for a transaction linked by external_reference_id or transaction_id
   */
  createRefund: async (req, res, next) => {
    try {
      const ownerId = req.userId;
      const {
        external_reference_id,
        transaction_id,
        amount,
        refund_date,
        note,
        lampiran,
        sync_user
      } = req.body;

      if (!external_reference_id && !transaction_id) {
        return res.status(400).json({
          success: false,
          message: 'external_reference_id atau transaction_id wajib disertakan'
        });
      }

      // Check if external_reference_id is a base PO reference (e.g. "po_105") which may have multiple split transactions
      const poBaseMatch = external_reference_id ? String(external_reference_id).match(/^(po_\d+)$/i) : null;
      let candidateTxs = [];

      if (poBaseMatch) {
        const baseRef = poBaseMatch[1];
        const rows = await query(
          `SELECT id FROM transactions 
           WHERE (external_reference_id = ? OR external_reference_id LIKE ? OR external_reference_id LIKE ?) 
             AND status_deleted = false 
           ORDER BY id ASC`,
          [baseRef, `${baseRef}_cat_%`, `${baseRef}_split_%`]
        );
        for (const r of rows) {
          const found = await Transaction.findById(r.id);
          if (found) candidateTxs.push(found);
        }
      }

      if (candidateTxs.length === 0) {
        let tx = null;
        if (external_reference_id) {
          tx = await Transaction.findByExternalReference(external_reference_id);
        }
        if (!tx && transaction_id) {
          tx = await Transaction.findById(transaction_id);
        }
        if (tx) candidateTxs = [tx];
      }

      if (candidateTxs.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'Transaksi terkait di VerKas tidak ditemukan'
        });
      }

      const refundAmount = parseFloat(amount);
      if (isNaN(refundAmount) || refundAmount <= 0) {
        return res.status(400).json({
          success: false,
          message: 'Nominal refund harus bernilai angka positif lebih dari 0'
        });
      }

      const totalCurrentAmount = candidateTxs.reduce(
        (sum, t) => sum + Math.abs(parseFloat(t.amount || 0)),
        0
      );
      if (refundAmount > totalCurrentAmount + 0.01) {
        return res.status(400).json({
          success: false,
          message: `Nominal refund (Rp ${refundAmount.toLocaleString('id-ID')}) melebihi sisa nominal transaksi (Rp ${totalCurrentAmount.toLocaleString('id-ID')})`
        });
      }

      const primaryTx = candidateTxs[0];
      const finalDate = refund_date || new Date().toISOString().split('T')[0];
      const refDateObj = new Date(finalDate);
      const isLocked = await LockedPeriod.isLocked(primaryTx.branch_id, refDateObj.getMonth() + 1, refDateObj.getFullYear());
      if (isLocked) {
        return res.status(403).json({
          success: false,
          message: 'Periode tanggal refund sudah ditutup buku (Locked) di VerKas'
        });
      }

      // Persist attachments if any
      let processedLampiran = null;
      if (lampiran) {
        let rawItems = [];
        if (Array.isArray(lampiran)) {
          rawItems = lampiran;
        } else if (typeof lampiran === 'string') {
          try {
            const parsed = JSON.parse(lampiran);
            rawItems = Array.isArray(parsed) ? parsed : [parsed];
          } catch {
            rawItems = [lampiran];
          }
        }

        const items = [];
        for (const item of rawItems) {
          const persisted = await persistExternalAttachment(item, primaryTx.branch_id);
          if (persisted && persisted.url) {
            items.push(persisted);
          }
        }
        if (items.length > 0) {
          processedLampiran = JSON.stringify(items);
        }
      }

      // Resolve actor user in VerKas
      const refundActorResolved = await resolveVerkasUser(sync_user, ownerId, req.user);
      const actorName = sync_user?.nama || sync_user?.name || refundActorResolved.name || 'Finance Bosgil';

      // Distribute refund across candidateTxs sequentially
      let remainingToRefund = refundAmount;
      const splitRefunds = [];

      for (const tx of candidateTxs) {
        if (remainingToRefund <= 0.001) break;
        const txCurrentAmount = Math.abs(parseFloat(tx.amount || 0));
        if (txCurrentAmount <= 0.001) continue;

        const portion = Math.min(remainingToRefund, txCurrentAmount);
        remainingToRefund = Math.max(0, remainingToRefund - portion);

        const existingRefunds = await TransactionRefund.findByTransactionId(tx.id);
        const totalExistingRefund = existingRefunds.reduce((sum, r) => sum + parseFloat(r.amount || 0), 0);

        const refundNote = candidateTxs.length > 1 && tx.category_name
          ? `${note ? note.trim() : 'Refund PO'} [${tx.category_name}]`
          : (note ? note.trim() : null);

        // 1. Create refund record
        const refundId = await TransactionRefund.create({
          transactionId: tx.id,
          userId: refundActorResolved.id,
          amount: portion,
          refundDate: finalDate,
          note: refundNote,
          lampiran: processedLampiran
        });

        // 2. Reduce transactions.amount in DB
        const newAmount = Math.max(0, txCurrentAmount - portion);
        await query('UPDATE transactions SET amount = ? WHERE id = ?', [newAmount, tx.id]);

        // 3. Log to activity history (Audit Trail)
        await TransactionEdit.create({
          transactionId: tx.id,
          requesterId: refundActorResolved.id,
          reason: 'Refund Baru',
          oldData: { total_refund: totalExistingRefund, net_amount: txCurrentAmount },
          newData: {
            refund_id: refundId,
            refund_amount: portion,
            refund_date: finalDate,
            total_refund: totalExistingRefund + portion,
            net_amount: newAmount,
            note: refundNote,
            lampiran: processedLampiran,
            external_sync_by: `${actorName} (via Bosgil PO)`
          },
          status: 'approved'
        }).catch(err => console.error('[ExternalAPI] Error logging refund history:', err.message));

        splitRefunds.push({
          refund_id: refundId,
          transaction_id: tx.id,
          external_reference_id: tx.external_reference_id,
          category_name: tx.category_name || null,
          amount: portion,
          remaining_transaction_amount: newAmount,
          refund_date: finalDate,
          note: refundNote
        });
      }

      const firstRefund = splitRefunds[0] || {};
      const newTotalRemaining = Math.max(0, totalCurrentAmount - refundAmount);

      return res.status(201).json({
        success: true,
        message: 'Refund transaksi berhasil dicatat ke VerKas',
        data: {
          refund_id: firstRefund.refund_id || null,
          transaction_id: firstRefund.transaction_id || primaryTx.id,
          amount: refundAmount,
          remaining_transaction_amount: newTotalRemaining,
          refund_date: finalDate,
          external_reference_id: firstRefund.external_reference_id || primaryTx.external_reference_id,
          split_refunds: splitRefunds
        }
      });
    } catch (error) {
      console.error('[ExternalAPI createRefund Error]:', error);
      next(error);
    }
  },

  /**
   * GET /api/external/v1/refunds
   * Fetch all refunds for a transaction (or all category splits of a PO) by external_reference_id or transaction_id
   */
  getRefunds: async (req, res, next) => {
    try {
      const { external_reference_id, transaction_id } = req.query;

      if (!external_reference_id && !transaction_id) {
        return res.status(400).json({
          success: false,
          message: 'external_reference_id atau transaction_id wajib disertakan'
        });
      }

      const poBaseMatch = external_reference_id ? String(external_reference_id).match(/^(po_\d+)(?:_(?:cat|split)_\d+)?$/i) : null;
      const baseRef = poBaseMatch ? poBaseMatch[1] : null;

      let activeTxIds = [];
      let deletedSplitTxs = [];

      if (baseRef) {
        const allPoRows = await query(
          `SELECT id, external_reference_id, status_deleted 
           FROM transactions 
           WHERE external_reference_id = ? 
              OR external_reference_id LIKE ? 
              OR external_reference_id LIKE ? 
           ORDER BY id ASC`,
          [baseRef, `${baseRef}_cat_%`, `${baseRef}_split_%`]
        );
        activeTxIds = allPoRows.filter(r => !r.status_deleted).map(r => r.id);
        deletedSplitTxs = allPoRows.filter(r => Boolean(r.status_deleted));
      }

      if (activeTxIds.length === 0) {
        let tx = null;
        if (external_reference_id && !baseRef) {
          tx = await Transaction.findByExternalReference(external_reference_id);
        }
        if (!tx && transaction_id) {
          tx = await Transaction.findById(transaction_id);
        }
        if (tx) {
          activeTxIds = [tx.id];
        }
      }

      if (activeTxIds.length === 0) {
        // Check if transaction was soft-deleted in VerKas
        let deletedTx = deletedSplitTxs[deletedSplitTxs.length - 1] || null;
        if (!deletedTx && transaction_id) {
          const rows = await query(
            'SELECT id, external_reference_id, status_deleted FROM transactions WHERE id = ? LIMIT 1',
            [transaction_id]
          );
          deletedTx = rows[0] || null;
        }
        if (!deletedTx && external_reference_id) {
          const rows = await query(
            'SELECT id, external_reference_id, status_deleted FROM transactions WHERE external_reference_id = ? ORDER BY id DESC LIMIT 1',
            [external_reference_id]
          );
          deletedTx = rows[0] || null;
        }

        return res.status(200).json({
          success: true,
          found: false,
          deleted_in_verkas: Boolean(deletedTx?.status_deleted || transaction_id),
          deleted_transaction_id: deletedTx?.id || (transaction_id ? Number(transaction_id) : null),
          deleted_transactions: deletedSplitTxs,
          data: {
            transaction_id: null,
            external_reference_id: external_reference_id || null,
            current_amount: 0,
            refunds: [],
            transactions: []
          }
        });
      }

      const fullTransactions = [];
      const allRefunds = [];
      let totalCurrentAmount = 0;

      for (const txId of activeTxIds) {
        const fullTx = await Transaction.findById(txId, true);
        if (!fullTx) continue;
        fullTransactions.push(fullTx);
        totalCurrentAmount += parseFloat(fullTx.amount || 0);
        const txRefunds = fullTx.refunds || (await TransactionRefund.findByTransactionId(fullTx.id)) || [];
        for (const r of txRefunds) {
          allRefunds.push({
            ...r,
            external_reference_id: fullTx.external_reference_id,
            category_name: fullTx.category_name || null
          });
        }
      }

      const primaryTx = fullTransactions[0];

      return res.status(200).json({
        success: true,
        found: true,
        deleted_transactions: deletedSplitTxs,
        data: {
          transaction_id: primaryTx.id,
          external_reference_id: primaryTx.external_reference_id,
          current_amount: totalCurrentAmount,
          refunds: allRefunds,
          transaction: primaryTx,
          transactions: fullTransactions
        }
      });
    } catch (error) {
      console.error('[ExternalAPI getRefunds Error]:', error);
      next(error);
    }
  },

  /**
   * PUT /api/external/v1/refunds/:refundId
   * Update an existing refund in VerKas
   */
  updateRefund: async (req, res, next) => {
    try {
      const ownerId = req.userId;
      const { refundId } = req.params;
      const { amount, refund_date, note, lampiran, sync_user } = req.body;

      const refund = await TransactionRefund.findById(refundId);
      if (!refund) {
        return res.status(404).json({
          success: false,
          message: 'Data refund di VerKas tidak ditemukan'
        });
      }

      const tx = await Transaction.findById(refund.transaction_id);
      if (!tx) {
        return res.status(404).json({
          success: false,
          message: 'Transaksi induk di VerKas tidak ditemukan'
        });
      }

      const newRefundAmount = parseFloat(amount);
      if (isNaN(newRefundAmount) || newRefundAmount <= 0) {
        return res.status(400).json({
          success: false,
          message: 'Nominal refund harus bernilai angka positif lebih dari 0'
        });
      }

      const oldRefundAmount = parseFloat(refund.amount || 0);
      const currentAmount = Math.abs(parseFloat(tx.amount || 0));
      const maxRefundable = currentAmount + oldRefundAmount;

      if (newRefundAmount > maxRefundable + 0.01) {
        return res.status(400).json({
          success: false,
          message: `Nominal refund (Rp ${newRefundAmount.toLocaleString('id-ID')}) melebihi sisa nominal yang dapat di-refund (Rp ${maxRefundable.toLocaleString('id-ID')})`
        });
      }

      const finalDate = refund_date || refund.refund_date || new Date().toISOString().split('T')[0];
      const refDateObj = new Date(finalDate);
      const isLocked = await LockedPeriod.isLocked(tx.branch_id, refDateObj.getMonth() + 1, refDateObj.getFullYear());
      if (isLocked) {
        return res.status(403).json({
          success: false,
          message: 'Periode tanggal refund sudah ditutup buku (Locked) di VerKas'
        });
      }

      let processedLampiran = refund.lampiran;
      if (lampiran !== undefined) {
        let rawItems = [];
        if (Array.isArray(lampiran)) {
          rawItems = lampiran;
        } else if (typeof lampiran === 'string' && lampiran.trim()) {
          try {
            const parsed = JSON.parse(lampiran);
            rawItems = Array.isArray(parsed) ? parsed : [parsed];
          } catch {
            rawItems = [lampiran];
          }
        }

        const items = [];
        for (const item of rawItems) {
          const persisted = await persistExternalAttachment(item, tx.branch_id);
          if (persisted && persisted.url) {
            items.push(persisted);
          }
        }
        processedLampiran = items.length > 0 ? JSON.stringify(items) : null;
      }

      const refundActorResolved = await resolveVerkasUser(sync_user, ownerId, req.user);
      const actorName = sync_user?.nama || sync_user?.name || refundActorResolved.name || 'Finance Bosgil';

      await TransactionRefund.update(refundId, {
        amount: newRefundAmount,
        refundDate: finalDate,
        note: note !== undefined ? (note ? note.trim() : null) : refund.note,
        lampiran: processedLampiran
      });

      const diff = newRefundAmount - oldRefundAmount;
      const newTxAmount = Math.max(0, currentAmount - diff);
      await query('UPDATE transactions SET amount = ? WHERE id = ?', [newTxAmount, tx.id]);

      await TransactionEdit.create({
        transactionId: tx.id,
        requesterId: refundActorResolved.id,
        reason: 'Edit Refund',
        oldData: {
          refund_id: refundId,
          refund_amount: oldRefundAmount,
          refund_date: refund.refund_date,
          note: refund.note,
          lampiran: refund.lampiran
        },
        newData: {
          refund_id: refundId,
          refund_amount: newRefundAmount,
          refund_date: finalDate,
          note: note !== undefined ? (note ? note.trim() : null) : refund.note,
          lampiran: processedLampiran,
          external_sync_by: `${actorName} (via Bosgil PO)`
        },
        status: 'approved'
      }).catch(err => console.error('[ExternalAPI] Error logging update refund history:', err.message));

      return res.json({
        success: true,
        message: 'Refund berhasil diperbarui di VerKas',
        data: {
          refund_id: Number(refundId),
          transaction_id: tx.id,
          amount: newRefundAmount,
          remaining_transaction_amount: newTxAmount,
          refund_date: finalDate,
          external_reference_id: tx.external_reference_id
        }
      });
    } catch (error) {
      console.error('[ExternalAPI updateRefund Error]:', error);
      next(error);
    }
  },

  /**
   * DELETE /api/external/v1/refunds/:refundId
   * Delete an existing refund in VerKas and restore transaction amount
   */
  deleteRefund: async (req, res, next) => {
    try {
      const ownerId = req.userId;
      const { refundId } = req.params;
      const sync_user = req.body?.sync_user || null;

      const refund = await TransactionRefund.findById(refundId);
      if (!refund) {
        return res.json({
          success: true,
          message: 'Data refund sudah tidak ada di VerKas'
        });
      }

      const tx = await Transaction.findById(refund.transaction_id);
      if (tx) {
        const refDateObj = new Date(refund.refund_date);
        const isLocked = await LockedPeriod.isLocked(tx.branch_id, refDateObj.getMonth() + 1, refDateObj.getFullYear());
        if (isLocked) {
          return res.status(403).json({
            success: false,
            message: 'Tidak dapat menghapus refund: Periode tanggal refund sudah ditutup buku (Locked) di VerKas'
          });
        }
      }

      const refundAmount = parseFloat(refund.amount || 0);
      if (tx) {
        await query('UPDATE transactions SET amount = amount + ? WHERE id = ?', [refundAmount, tx.id]);
      }
      await TransactionRefund.delete(refundId);

      if (tx) {
        const refundActorResolved = await resolveVerkasUser(sync_user, ownerId, req.user);
        const actorName = sync_user?.nama || sync_user?.name || refundActorResolved.name || 'Finance Bosgil';
        await TransactionEdit.create({
          transactionId: tx.id,
          requesterId: refundActorResolved.id,
          reason: 'Hapus Refund',
          oldData: {
            refund_id: refundId,
            refund_amount: refund.amount,
            refund_date: refund.refund_date,
            note: refund.note
          },
          newData: {
            action: 'delete_refund',
            deleted_refund_id: refundId,
            external_sync_by: `${actorName} (via Bosgil PO)`
          },
          status: 'approved'
        }).catch(err => console.error('[ExternalAPI] Error logging delete refund history:', err.message));
      }

      return res.json({
        success: true,
        message: 'Refund berhasil dihapus di VerKas',
        data: {
          deleted_refund_id: Number(refundId),
          transaction_id: tx ? tx.id : null
        }
      });
    } catch (error) {
      console.error('[ExternalAPI deleteRefund Error]:', error);
      next(error);
    }
  }
};

module.exports = externalApiController;
