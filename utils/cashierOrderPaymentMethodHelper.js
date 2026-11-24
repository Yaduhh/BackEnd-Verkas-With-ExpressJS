const { query } = require('../config/database');

let ensureOrderPmColsPromise = null;

/**
 * Lazily ensures `dp_payment_method_id` and `settlement_payment_method_id` exist on
 * `cashier_report_orders` even if `npm run migrate` has not been executed yet.
 */
async function ensureOrderPaymentMethodColumns() {
  if (!ensureOrderPmColsPromise) {
    ensureOrderPmColsPromise = (async () => {
      try {
        const existingCols = await query(
          `SELECT COLUMN_NAME
           FROM INFORMATION_SCHEMA.COLUMNS
           WHERE TABLE_SCHEMA = DATABASE()
             AND TABLE_NAME = 'cashier_report_orders'
             AND COLUMN_NAME IN ('dp_payment_method_id', 'settlement_payment_method_id')`
        );
        const colSet = new Set((existingCols || []).map((r) => r.COLUMN_NAME));

        if (!colSet.has('dp_payment_method_id')) {
          await query(`
            ALTER TABLE cashier_report_orders
            ADD COLUMN dp_payment_method_id INT NULL DEFAULT NULL AFTER dp_channel,
            ADD INDEX idx_cro_dp_pm (dp_payment_method_id),
            ADD CONSTRAINT fk_cro_dp_pm FOREIGN KEY (dp_payment_method_id) REFERENCES payment_methods(id) ON DELETE SET NULL
          `);
        }

        if (!colSet.has('settlement_payment_method_id')) {
          await query(`
            ALTER TABLE cashier_report_orders
            ADD COLUMN settlement_payment_method_id INT NULL DEFAULT NULL AFTER settlement_channel,
            ADD INDEX idx_cro_settlement_pm (settlement_payment_method_id),
            ADD CONSTRAINT fk_cro_settlement_pm FOREIGN KEY (settlement_payment_method_id) REFERENCES payment_methods(id) ON DELETE SET NULL
          `);
        }
      } catch (err) {
        ensureOrderPmColsPromise = null;
        throw err;
      }
    })();
  }
  return ensureOrderPmColsPromise;
}

function normalizeLabel(val) {
  return String(val || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Returns broad payment family token for comparing whether a manual payment method
 * change is still within the same bank family as an incoming external sync.
 */
function detectBankFamily(rawLabel) {
  const lower = normalizeLabel(rawLabel);
  if (!lower) return null;
  if (lower.includes('piutang') || lower.includes('mitra') || lower.includes('a/r')) return 'piutang';
  if (lower.includes('bca')) return 'bca';
  if (lower.includes('mandiri')) return 'mandiri';
  if (lower.includes('bri')) return 'bri';
  if (lower.includes('bni')) return 'bni';
  if (lower.includes('qris') || lower === 'qr' || lower.includes('qr ')) return 'qris';
  if (lower.includes('cash') || lower.includes('tunai')) return 'cash';
  return null;
}

/**
 * Returns selectable (leaf) payment methods: excludes parent group headers that have active children.
 */
function getSelectablePaymentMethods(paymentMethods = []) {
  const list = Array.isArray(paymentMethods) ? paymentMethods : [];
  const parentIdsWithChildren = new Set();
  for (const pm of list) {
    if (pm.parent_id) parentIdsWithChildren.add(Number(pm.parent_id));
  }
  return list.filter((pm) => !parentIdsWithChildren.has(Number(pm.id)));
}

function isNonEdcTransferCandidate(pm) {
  const n = normalizeLabel(pm?.name);
  if (!n) return false;
  return (
    !n.includes('edc') &&
    !n.includes('qris') &&
    !n.includes('qr ') &&
    !n.includes('gopay') &&
    !n.includes('ovo') &&
    !n.includes('dana') &&
    !n.includes('grab') &&
    !n.includes('go resto') &&
    !n.includes('goresto') &&
    !n.includes('shopee') &&
    !n.includes('livin')
  );
}

/**
 * Resolves a Cashier Report Order's payment channel against branch active Payment Methods (Cara Pembayaran),
 * automatically filling its linked `default_bank_account_id` while staying backward-compatible with legacy text/banks.
 *
 * @param {object} opts
 * @param {number|string|null} opts.rawPaymentMethodId
 * @param {number|string|null} opts.rawBankAccountId
 * @param {string|null} opts.rawChannelText
 * @param {Array} opts.paymentMethods - active payment_methods rows for the branch
 * @param {Array} opts.bankAccounts - active bank_accounts rows for the branch
 * @param {'dp'|'settlement'|'general'} [opts.context='dp']
 * @param {boolean} [opts.allowKeywordFallback=false]
 */
function resolveOrderPaymentMethod({
  rawPaymentMethodId = null,
  rawBankAccountId = null,
  rawChannelText = '',
  paymentMethods = [],
  bankAccounts = [],
  context = 'dp',
  allowKeywordFallback = false
}) {
  const allPms = Array.isArray(paymentMethods) ? paymentMethods : [];
  const selectablePms = getSelectablePaymentMethods(allPms);
  const pmById = new Map(allPms.map((pm) => [Number(pm.id), pm]));
  const parentById = new Map(allPms.map((pm) => [Number(pm.id), pm]));
  const selectableByName = new Map(
    selectablePms.map((pm) => [normalizeLabel(pm.name), pm])
  );
  const allByName = new Map(allPms.map((pm) => [normalizeLabel(pm.name), pm]));

  const banks = Array.isArray(bankAccounts) ? bankAccounts : [];
  const bankById = new Map(banks.map((b) => [Number(b.id), b]));
  const bankByName = new Map(banks.map((b) => [normalizeLabel(b.name), b]));

  const parsedPmId = rawPaymentMethodId ? parseInt(rawPaymentMethodId, 10) : null;
  const parsedBankId = rawBankAccountId ? parseInt(rawBankAccountId, 10) : null;
  const cleanText = rawChannelText ? String(rawChannelText).trim() : '';
  const lower = normalizeLabel(cleanText);

  const packPm = (pm) => {
    const defaultBankId = pm.default_bank_account_id ? Number(pm.default_bank_account_id) : null;
    const matchedBank = defaultBankId ? bankById.get(defaultBankId) : null;
    const bankName = matchedBank
      ? String(matchedBank.name).trim()
      : (pm.default_bank_account_name ? String(pm.default_bank_account_name).trim() : null);
    return {
      payment_method_id: Number(pm.id),
      payment_method_name: String(pm.name).trim(),
      channel_name: String(pm.name).trim(),
      bank_account_id: defaultBankId,
      bank_account_name: bankName
    };
  };

  // 1. Direct payment_method_id lookup
  if (parsedPmId && pmById.has(parsedPmId)) {
    return packPm(pmById.get(parsedPmId));
  }

  // 2. Exact name match against active Payment Methods
  if (lower) {
    const exactSelectable = selectableByName.get(lower);
    if (exactSelectable) return packPm(exactSelectable);
    const exactAny = allByName.get(lower);
    if (exactAny) return packPm(exactAny);
  }

  // 3. Smart keyword auto-mapping (used by Pesan-BosGiL sync & Excel import)
  if (allowKeywordFallback && lower) {
    const isUnderAdminPesanan = (pm) => {
      if (!pm.parent_id) return false;
      const parent = parentById.get(Number(pm.parent_id));
      return normalizeLabel(parent?.name).includes('admin pesanan');
    };

    const pickFirst = (predicates) => {
      for (const pred of predicates) {
        const adminMatch = selectablePms.find((pm) => isUnderAdminPesanan(pm) && pred(pm));
        if (adminMatch) return adminMatch;
        const anyMatch = selectablePms.find(pred);
        if (anyMatch) return anyMatch;
      }
      return null;
    };

    const hasName = (pm, ...tokens) => {
      const n = normalizeLabel(pm.name);
      return tokens.every((tok) => n.includes(tok));
    };
    const isDpPm = (pm) => {
      const n = normalizeLabel(pm.name);
      return /\bdp\b/.test(n) || n.includes('deposit');
    };

    let matchedPm = null;

    if (lower.includes('edc')) {
      if (lower.includes('bca')) {
        matchedPm = pickFirst([(pm) => hasName(pm, 'edc', 'bca'), (pm) => hasName(pm, 'edc')]);
      } else if (lower.includes('bri')) {
        matchedPm = pickFirst([(pm) => hasName(pm, 'edc', 'bri'), (pm) => hasName(pm, 'edc')]);
      } else if (lower.includes('mandiri')) {
        matchedPm = pickFirst([(pm) => hasName(pm, 'edc', 'mandiri'), (pm) => hasName(pm, 'edc')]);
      } else {
        matchedPm = pickFirst([(pm) => hasName(pm, 'edc')]);
      }
    } else if (lower.includes('bca')) {
      if (lower.includes('kasir') || lower.includes('online')) {
        matchedPm = pickFirst([
          (pm) => hasName(pm, 'bca', 'kasir'),
          (pm) => hasName(pm, 'bca', 'online'),
          (pm) => hasName(pm, 'transfer', 'bca') && !isDpPm(pm)
        ]);
      } else if (lower.includes('lama')) {
        matchedPm = pickFirst([
          (pm) => hasName(pm, 'bca', 'lama'),
          (pm) => hasName(pm, 'transfer', 'bca') && !isDpPm(pm)
        ]);
      } else if (/\bdp\b/.test(lower) || lower.includes('deposit')) {
        matchedPm = pickFirst([
          (pm) => isDpPm(pm) && hasName(pm, 'bca'),
          (pm) => hasName(pm, 'transfer', 'bca', 'cv'),
          (pm) => hasName(pm, 'transfer', 'bca'),
          (pm) => hasName(pm, 'bca') && isNonEdcTransferCandidate(pm),
          (pm) => hasName(pm, 'bca')
        ]);
      } else if (lower.includes('cv')) {
        matchedPm = pickFirst([
          (pm) => hasName(pm, 'transfer', 'bca', 'cv') && !isDpPm(pm),
          (pm) => hasName(pm, 'bca', 'cv') && isNonEdcTransferCandidate(pm) && !isDpPm(pm),
          (pm) => hasName(pm, 'transfer', 'bca') && !isDpPm(pm),
          (pm) => hasName(pm, 'bca') && isNonEdcTransferCandidate(pm)
        ]);
      } else if (context === 'dp') {
        // Recommended rule: DP / Deposit -> DP BCA Admin first, then Transfer BCA CV -> Transfer BCA
        matchedPm = pickFirst([
          (pm) => isDpPm(pm) && hasName(pm, 'bca'),
          (pm) => hasName(pm, 'transfer', 'bca', 'cv'),
          (pm) => hasName(pm, 'transfer', 'bca'),
          (pm) => hasName(pm, 'bca') && isNonEdcTransferCandidate(pm),
          (pm) => hasName(pm, 'bca')
        ]);
      } else {
        // Settlement / general -> Transfer BCA CV -> Transfer BCA (non-DP) -> BCA non-EDC -> DP BCA
        matchedPm = pickFirst([
          (pm) => hasName(pm, 'transfer', 'bca', 'cv') && !isDpPm(pm),
          (pm) => hasName(pm, 'transfer', 'bca') && !isDpPm(pm),
          (pm) => hasName(pm, 'bca') && !isDpPm(pm) && isNonEdcTransferCandidate(pm),
          (pm) => isDpPm(pm) && hasName(pm, 'bca'),
          (pm) => hasName(pm, 'bca')
        ]);
      }
    } else if (lower.includes('mandiri')) {
      if (/\bdp\b/.test(lower) || lower.includes('deposit')) {
        matchedPm = pickFirst([
          (pm) => isDpPm(pm) && hasName(pm, 'mandiri'),
          (pm) => hasName(pm, 'transfer', 'mandiri'),
          (pm) => hasName(pm, 'mandiri') && isNonEdcTransferCandidate(pm),
          (pm) => hasName(pm, 'mandiri')
        ]);
      } else if (context === 'dp') {
        // Recommended rule: DP / Deposit -> DP Mandiri Admin first, then Transfer Mandiri
        matchedPm = pickFirst([
          (pm) => isDpPm(pm) && hasName(pm, 'mandiri'),
          (pm) => hasName(pm, 'transfer', 'mandiri'),
          (pm) => hasName(pm, 'mandiri') && isNonEdcTransferCandidate(pm),
          (pm) => hasName(pm, 'mandiri')
        ]);
      } else {
        // Settlement / general -> Transfer Mandiri (non-DP) -> Mandiri non-EDC -> DP Mandiri
        matchedPm = pickFirst([
          (pm) => hasName(pm, 'transfer', 'mandiri') && !isDpPm(pm),
          (pm) => hasName(pm, 'mandiri') && !isDpPm(pm) && isNonEdcTransferCandidate(pm),
          (pm) => isDpPm(pm) && hasName(pm, 'mandiri'),
          (pm) => hasName(pm, 'mandiri')
        ]);
      }
    } else if (lower.includes('bri')) {
      matchedPm = pickFirst([
        (pm) => hasName(pm, 'transfer', 'bri'),
        (pm) => hasName(pm, 'bri') && isNonEdcTransferCandidate(pm),
        (pm) => hasName(pm, 'bri')
      ]);
    } else if (lower.includes('qris') || lower === 'qr' || lower.includes('qr ')) {
      matchedPm = pickFirst([
        (pm) => hasName(pm, 'qris'),
        (pm) => hasName(pm, 'qr')
      ]);
    } else if (lower.includes('cash') || lower.includes('tunai')) {
      matchedPm = pickFirst([
        (pm) => hasName(pm, 'cash'),
        (pm) => hasName(pm, 'tunai')
      ]);
    } else if (!lower.includes('piutang') && !lower.includes('mitra')) {
      // Unique partial match for other channels (e.g. "Go Resto", "Grab Food", "Livin Food")
      const partialMatches = selectablePms.filter((pm) => {
        const pn = normalizeLabel(pm.name);
        return pn && (pn.includes(lower) || lower.includes(pn));
      });
      if (partialMatches.length === 1) {
        matchedPm = partialMatches[0];
      }
    }

    if (matchedPm) {
      return packPm(matchedPm);
    }
  }

  // 4. Fallback: preserve custom text (e.g. 'PIUTANG') or legacy bank_account_id if not matched to a Payment Method
  const fallbackBank =
    (parsedBankId ? bankById.get(parsedBankId) : null) ||
    (lower ? bankByName.get(lower) : null) ||
    null;

  return {
    payment_method_id: null,
    payment_method_name: null,
    channel_name: cleanText || (fallbackBank ? String(fallbackBank.name).trim() : null),
    bank_account_id: fallbackBank ? Number(fallbackBank.id) : null,
    bank_account_name: fallbackBank ? String(fallbackBank.name).trim() : null
  };
}

module.exports = {
  ensureOrderPaymentMethodColumns,
  detectBankFamily,
  getSelectablePaymentMethods,
  resolveOrderPaymentMethod
};
