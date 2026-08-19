// Direct Resolvers that resolve specific user requests programmatically for speed and accuracy
const { query } = require('../../config/database');
const { formatIDR } = require('./aiFormatter');

const GLOBAL_MONTH_MAP = {
  'januari': 1, 'jan': 1,
  'februari': 2, 'feb': 2,
  'maret': 3, 'mar': 3,
  'april': 4, 'apr': 4,
  'mei': 5,
  'juni': 6, 'jun': 6,
  'juli': 7, 'jul': 7,
  'agustus': 8, 'agu': 8, 'agt': 8,
  'september': 9, 'sep': 9,
  'oktober': 10, 'okt': 10,
  'november': 11, 'nov': 11,
  'desember': 12, 'des': 12
};

const GLOBAL_MONTH_NAMES_INDO = ['', 'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];

function isGeneralMonthlyQuery(message, chatHistory) {
  const msg = message.toLowerCase();

  // Inherit topic from chatHistory if it's a follow-up query
  let inheritedTopic = '';
  if (chatHistory && Array.isArray(chatHistory) && chatHistory.length > 0) {
    const lastUserMsg = [...chatHistory].reverse().find(h => h.role === 'user');
    if (lastUserMsg) {
      const lastContent = lastUserMsg.content.toLowerCase();
      if (lastContent.includes('pengeluaran') || lastContent.includes('belanja') || lastContent.includes('biaya')) {
        inheritedTopic = 'pengeluaran';
      } else if (lastContent.includes('pemasukan') && !lastContent.includes('lain') && !lastContent.includes('piutang')) {
        inheritedTopic = 'pemasukan';
      } else if (lastContent.includes('omzet') || lastContent.includes('omset')) {
        inheritedTopic = 'omzet';
      } else if (lastContent.includes('saldo') || lastContent.includes('laba') || lastContent.includes('untung') || lastContent.includes('bersih') || lastContent.includes('kas berjalan') || lastContent.includes('kas harian') || lastContent.includes('saldo berjalan')) {
        inheritedTopic = 'saldo';
      } else if (lastContent.includes('pemasukan lain') || lastContent.includes('lain-lain')) {
        inheritedTopic = 'pemasukan lain';
      } else if (lastContent.includes('pb1') || lastContent.includes('pajak')) {
        inheritedTopic = 'pajak';
      }
    }
  }

  // Keywords indicating a monthly or current period query
  const months = Object.keys(GLOBAL_MONTH_MAP);

  const hasMonth = months.some(m => msg.includes(m));
  const hasThisMonth = msg.includes('bulan ini') || msg.includes('hari ini') || msg.includes('sekarang');

  if (!hasMonth && !hasThisMonth) return false;

  // General summary indicators
  const generalKeywords = [
    'laporan', 'ringkasan', 'keuangan',
    'omzet', 'omset',
    'pemasukan', 'pengeluaran', 'belanja',
    'saldo', 'laba bersih', 'laba', 'keuntungan', 'netto',
    'pb1', 'pajak',
    'kas berjalan', 'total kas',
    'pemasukan lain-lain', 'pemasukan lain', 'pemasukan lainnya'
  ];

  const hasGeneralKeyword = generalKeywords.some(kw => msg.includes(kw)) || inheritedTopic !== '';

  // Exclude specific category/repayment queries that require dynamic SQL
  const specificExclusions = [
    'biaya lain', 'pendapatan lain', 'bahan baku', 'operasional', 'gaji', 'marketplace', 'grab', 'go food', 'shopee', 'tokopedia', 'lazada', 'toko', 'sewa', 'gathering'
  ];
  const isSpecific = specificExclusions.some(ex => msg.includes(ex));

  // Exclude detailed/sorting/extreme/creator queries that need SQL query execution
  const hasDetailedOrSorted = [
    'besar', 'banyak', 'kecil', 'detail', 'apa saja', 'daftar', 'list', 'nama', 'kategori',
    'terbesar', 'terbanyak', 'terkecil', 'paling', 'siapa', 'dibuat', 'buat', 'pembuat', 'input',
    'keterangan', 'catatan', 'nota', 'bukti', 'lampiran', 'kapan', 'tanggal', 'jam', 'user', 'admin', 'pic'
  ].some(w => msg.includes(w));
  if (hasDetailedOrSorted) return false;

  return hasGeneralKeyword && !isSpecific;
}

// Direct resolver for Verkas packages / subscriptions
function tryResolveSubscriptionQueryDirectly(message, subscriptionPlans, activeSubscription) {
  const msg = message.toLowerCase();
  const msgClean = msg.replace(/\s+/g, '');
  const isSubQuery = ['paket', 'langganan', 'subscription', 'hargaverkas', 'biayaverkas', 'layananverkas', 'bayarverkas'].some(kw => msgClean.includes(kw)) ||
    (msg.includes('paket') || msg.includes('langganan') || msg.includes('subscription')) ||
    ((msg.includes('biaya') || msg.includes('harga') || msg.includes('layanan') || msg.includes('tarif')) && msg.includes('verkas'));

  if (!isSubQuery) return null;

  // Check if they are asking about their own active subscription
  const isPersonalQuery = ['saya', 'gua', 'aktif', 'kapan', 'habis', 'expired', 'punya', 'milik'].some(w => msg.includes(w));
  if (isPersonalQuery) {
    if (activeSubscription) {
      const endDate = new Date(activeSubscription.end_date).toLocaleDateString('id-ID', { year: 'numeric', month: 'long', day: 'numeric' });
      return `Paket langganan aktif Anda saat ini adalah Paket "${activeSubscription.plan_name}" (Status: ${activeSubscription.status}). Paket ini aktif sampai tanggal ${endDate}.`;
    } else {
      return `Anda saat ini tidak memiliki paket langganan aktif yang terdaftar di sistem.`;
    }
  }

  if (subscriptionPlans && subscriptionPlans.length > 0) {
    let reply = `Daftar paket langganan Verkas yang tersedia:\n`;
    subscriptionPlans.forEach(p => {
      const priceM = new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0 }).format(p.price_monthly);
      const priceY = new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0 }).format(p.price_yearly);
      const branchesLimit = p.max_branches === null ? 'Tanpa Batas' : `${p.max_branches} Cabang`;
      const adminLimit = p.max_admin === null ? 'Tanpa Batas' : `${p.max_admin} Staf`;

      reply += `- Paket ${p.name}: ${p.description || ''} (Maks: ${branchesLimit}, ${adminLimit}) - Bulanan: ${priceM}, Tahunan: ${priceY}\n`;
    });
    return reply;
  }
  return null;
}

async function tryResolveExtremeTransactionQueryDirectly(message, branchId) {
  const msg = message.toLowerCase();
  const hasLargest = msg.includes('terbesar') || msg.includes('paling besar') || msg.includes('maksimal');
  const hasSmallest = msg.includes('terkecil') || msg.includes('paling kecil') || msg.includes('minimal');
  
  if (!hasLargest && !hasSmallest) return null;
  
  // check if it's about transactions
  const hasTxKeyword = ['transaksi', 'pembayaran', 'belanja', 'pemasukan', 'pengeluaran', 'omzet', 'omset'].some(kw => msg.includes(kw));
  if (!hasTxKeyword) return null;

  // determine period dynamically
  const now = new Date();
  let targetMonth = now.getMonth() + 1;
  let targetYear = now.getFullYear();
  let targetMonthName = now.toLocaleDateString('id-ID', { month: 'long' });

  let foundMonth = false;
  for (const [name, num] of Object.entries(GLOBAL_MONTH_MAP)) {
    if (msg.includes(name)) {
      targetMonth = num;
      targetMonthName = name.charAt(0).toUpperCase() + name.slice(1);
      foundMonth = true;
      break;
    }
  }

  if (!foundMonth) {
    if (msg.includes('bulan lalu') || msg.includes('bulan kemarin')) {
      const prevDate = new Date();
      prevDate.setMonth(now.getMonth() - 1);
      targetMonth = prevDate.getMonth() + 1;
      targetYear = prevDate.getFullYear();
      targetMonthName = prevDate.toLocaleDateString('id-ID', { month: 'long' });
    } else if (msg.includes('bulan ini')) {
      targetMonth = now.getMonth() + 1;
      targetYear = now.getFullYear();
      targetMonthName = now.toLocaleDateString('id-ID', { month: 'long' });
    } else {
      // Default to previous month if no month specified
      const prevDate = new Date();
      prevDate.setMonth(now.getMonth() - 1);
      targetMonth = prevDate.getMonth() + 1;
      targetYear = prevDate.getFullYear();
      targetMonthName = prevDate.toLocaleDateString('id-ID', { month: 'long' });
    }
  }

  const startOfMonth = `${targetYear}-${String(targetMonth).padStart(2, '0')}-01`;
  const lastDay = new Date(targetYear, targetMonth, 0).getDate();
  const endDate = `${targetYear}-${String(targetMonth).padStart(2, '0')}-${lastDay}`;

  const type = msg.includes('pengeluaran') ? 'expense' : (msg.includes('pemasukan') || msg.includes('omzet') || msg.includes('omset') ? 'income' : null);
  const typeFilter = type ? `AND t.type = '${type}'` : '';
  const order = hasLargest ? 'DESC' : 'ASC';
  const label = hasLargest ? 'terbesar' : 'terkecil';

  try {
    const rawSql = `
      SELECT t.amount, t.note, t.transaction_date, c.name as category_name
      FROM transactions t
      LEFT JOIN categories c ON t.category_id = c.id
      WHERE t.branch_id = ? AND t.status_deleted = 0 AND t.is_umum = 1
        ${typeFilter}
        AND DATE(t.transaction_date) BETWEEN ? AND ?
      ORDER BY t.amount ${order}
      LIMIT 1
    `;
    const [result] = await query(rawSql, [branchId, startOfMonth, endDate]);
    if (!result) {
      return `Tidak ada data transaksi yang tercatat pada Kas Berjalan untuk bulan ${targetMonthName} ${targetYear}.`;
    }

    const dateStr = new Date(result.transaction_date).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });
    const categoryStr = result.category_name ? `kategori ${result.category_name}` : 'tanpa kategori';
    const noteStr = result.note ? ` ("${result.note}")` : '';

    return `Transaksi ${label} pada Kas Berjalan untuk bulan ${targetMonthName} ${targetYear} adalah transaksi ${categoryStr} senilai ${formatIDR(result.amount)}${noteStr} pada tanggal ${dateStr}.`;
  } catch (err) {
    console.error('[AI-Service] tryResolveExtremeTransactionQueryDirectly failed:', err);
    return null;
  }
}

async function tryResolveSavingsBalanceQueryDirectly(message, branchId, chatHistory) {
  const msg = message.toLowerCase();
  
  // If query is about PB1 or Pajak, DO NOT treat it as Kas Simpanan query!
  if (msg.includes('pb1') || msg.includes('pajak')) return null;

  const hasSavingsKeyword = ['simpanan', 'simpaan', 'tabungan', 'cadangan'].some(kw => msg.includes(kw));
  
  let isSavingsBalanceQuery = hasSavingsKeyword && 
    (msg.includes('saldo') || msg.includes('uang') || msg.includes('isi') || msg.includes('nominal') || msg.includes('berapa') || msg.includes('detail') || msg.includes('tampilkan') || msg.includes('list') || msg.includes('daftar') || msg.includes('terbesar') || msg.includes('terkecil') || msg.includes('mana') || msg.includes('dimana') || msg.includes('paling'));

  // Conversational follow-up detection from chat history
  if (!isSavingsBalanceQuery && chatHistory && Array.isArray(chatHistory) && chatHistory.length > 0) {
    const lastUserMsgs = chatHistory.filter(h => h.role === 'user').slice(-2);
    const historyWasSavings = lastUserMsgs.some(m => {
      const contentLower = m.content.toLowerCase();
      return (contentLower.includes('saldo') || contentLower.includes('uang') || contentLower.includes('isi') || contentLower.includes('nominal') || contentLower.includes('berapa') || contentLower.includes('terbesar') || contentLower.includes('terkecil') || contentLower.includes('mana') || contentLower.includes('dimana') || contentLower.includes('paling')) &&
        ['simpanan', 'simpaan', 'tabungan', 'cadangan'].some(kw => contentLower.includes(kw));
    });

    if (historyWasSavings) {
      const followUpKeywords = ['kalau', 'lalu', 'bagaimana', 'gimana', 'dan', 'yg', 'yang', 'untuk', 'sisa'];
      const isFollowUp = followUpKeywords.some(kw => msg.includes(kw)) || msg.split(/\s+/).length <= 4 || hasSavingsKeyword;
      if (isFollowUp) {
        isSavingsBalanceQuery = true;
      }
    }
  }

  if (!isSavingsBalanceQuery) return null;

  try {
    const rawSql = `
      SELECT cat.name, SUM(CASE WHEN t.type = 'income' OR (t.is_umum = 1 AND t.type = 'expense') THEN amount_val ELSE -amount_val END) as saldo 
      FROM (
        SELECT id, type, is_umum, amount as amount_val, category_id, transaction_date 
        FROM transactions 
        WHERE branch_id = ? AND status_deleted = 0 
        UNION ALL 
        SELECT t.id, t.type, t.is_umum, tsd.amount as amount_val, tsd.category_id, t.transaction_date 
        FROM transaction_savings_details tsd 
        JOIN transactions t ON tsd.transaction_id = t.id 
        WHERE t.branch_id = ? AND t.status_deleted = 0
      ) as t 
      JOIN categories cat ON t.category_id = cat.id 
      WHERE (cat.branch_id = ? OR cat.branch_id IS NULL) 
        AND cat.status_deleted = 0 
        AND cat.parent_id IS NOT NULL 
        AND (cat.name LIKE '%Simpanan%' OR cat.name = 'Packaging') 
      GROUP BY cat.id, cat.name
      ORDER BY cat.name ASC
    `;
    const results = await query(rawSql, [branchId, branchId, branchId]);
    if (!results || results.length === 0) {
      return 'Belum ada data saldo untuk masing-masing kas simpanan Anda.';
    }

    // Check if user is asking for a specific savings account
    const matchedResults = results.filter(r => {
      const cleanCatName = r.name.toLowerCase().replace(/kas\s+simpanan\s*/g, '').trim();
      return msg.includes(cleanCatName) || msg.includes(r.name.toLowerCase());
    });

    let filteredResults = results;
    let isSpecific = false;
    if (matchedResults.length > 0) {
      filteredResults = matchedResults;
      isSpecific = true;
    }

    // Check if asking for extreme values (largest / smallest)
    const wantsLargest = msg.includes('terbesar') || msg.includes('terbanyak') || (msg.includes('paling') && (msg.includes('besar') || msg.includes('banyak')));
    const wantsSmallest = msg.includes('terkecil') || msg.includes('tersedikit') || (msg.includes('paling') && (msg.includes('kecil') || msg.includes('sedikit')));

    if (wantsLargest) {
      const sorted = [...results].sort((a, b) => (parseFloat(b.saldo) || 0) - (parseFloat(a.saldo) || 0));
      if (sorted.length > 0) {
        const top = sorted[0];
        return `Kas Simpanan terbesar Anda saat ini adalah ${top.name} dengan saldo ${formatIDR(parseFloat(top.saldo) || 0)}.`;
      }
    }

    if (wantsSmallest) {
      const sorted = [...results].sort((a, b) => (parseFloat(a.saldo) || 0) - (parseFloat(b.saldo) || 0));
      if (sorted.length > 0) {
        const bottom = sorted[0];
        return `Kas Simpanan terkecil Anda saat ini adalah ${bottom.name} dengan saldo ${formatIDR(parseFloat(bottom.saldo) || 0)}.`;
      }
    }

    if (isSpecific && filteredResults.length === 1) {
      const r = filteredResults[0];
      const saldoVal = parseFloat(r.saldo) || 0;
      return `Saldo ${r.name} Anda saat ini adalah ${formatIDR(saldoVal)}.`;
    }

    let totalSavings = 0;
    let reply = isSpecific 
      ? 'Berikut adalah rincian saldo Kas Simpanan yang Anda cari:\n\n' 
      : 'Berikut adalah rincian saldo masing-masing Kas Simpanan Anda:\n\n';
      
    filteredResults.forEach(r => {
      const saldoVal = parseFloat(r.saldo) || 0;
      totalSavings += saldoVal;
      reply += `- ${r.name}: ${formatIDR(saldoVal)}\n`;
    });

    if (filteredResults.length > 1) {
      reply += `\nTotal Keseluruhan Kas Simpanan: ${formatIDR(totalSavings)}`;
    }
    return reply;
  } catch (err) {
    console.error('[AI-Service] tryResolveSavingsBalanceQueryDirectly failed:', err);
    return null;
  }
}

function tryResolvePICQueryDirectly(message, branchPics, teamMembers, branchName) {
  const msg = message.toLowerCase();
  
  // Detect if query is about PIC / admin / team members list of the branch
  const isPICQuery = ['admin', 'pic', 'tim', 'staff', 'staf', 'owner', 'anggota', 'orang'].some(kw => msg.includes(kw)) &&
    ['siapa', 'daftar', 'list', 'tunjukan', 'lihat', 'ada'].some(kw => msg.includes(kw));

  if (!isPICQuery) return null;

  if ((!branchPics || branchPics.length === 0) && (!teamMembers || teamMembers.length === 0)) {
    return `Belum ada tim PIC / Admin / Owner yang terdaftar di Buku Kas "${branchName}".`;
  }

  let reply = `Berikut adalah daftar Tim yang bertanggung jawab di Buku Kas "${branchName}":\n\n`;

  if (teamMembers && teamMembers.length > 0) {
    reply += `Owner & Co-Owner (Pengelola Utama):\n`;
    teamMembers.forEach(t => {
      const roleStr = t.role === 'owner' ? 'Owner' : (t.role === 'co-owner' ? 'Co-Owner' : t.role);
      reply += `- ${t.name} (${t.email}) - ${roleStr}\n`;
    });
    reply += `\n`;
  }

  if (branchPics && branchPics.length > 0) {
    reply += `Person In Charge (PIC) / Admin:\n`;
    branchPics.forEach(p => {
      reply += `- ${p.name} (${p.email})\n`;
    });
  }

  return reply;
}

async function tryResolveMonthlyQueryDirectly(message, monthlySummaries, branchName, chatHistory, branchId) {
  const msg = message.toLowerCase();

  const isQuestion = ['siapa', 'kapan', 'kenapa', 'mengapa', 'bagaimana', 'apa', 'apakah', 'berapa', '?'].some(q => msg.includes(q));
  const writeAction = ['buatkan', 'buat', 'bikin', 'tambah', 'tambahkan', 'input', 'masukkan', 'sisipkan', 'edit', 'ubah', 'hapus', 'delete', 'remove'].some(w => msg.includes(w));
  const writeTarget = ['transaksi', 'pemasukan', 'pengeluaran', 'data', 'catatan', 'nota', 'piutang'].some(t => msg.includes(t));
  if (!isQuestion && writeAction && writeTarget) {
    return 'Maaf, sebagai AI Assistant saya hanya memiliki akses baca (read-only) untuk menganalisis laporan keuangan Anda, sehingga tidak dapat membuat, mengubah, atau menghapus transaksi.\n\nAnda dapat menambahkan atau mengelola transaksi secara langsung melalui tombol "+ Transaksi" pada aplikasi Verkas.';
  }

  const comparativeKeywords = ['bandingkan', 'banding', 'perbandingan', 'selisih', 'vs', 'perkembangan', 'tren', 'analisis', 'analisa', 'kenapa', 'mengapa', 'sebab', 'alasan'];
  const isComparative = comparativeKeywords.some(kw => msg.includes(kw));

  const isSavingsQuery = ['simpanan', 'simpaan', 'tabungan', 'cadangan', 'pribadi'].some(w => msg.includes(w));
  if (isSavingsQuery) return null;

  // If query is asking about creator/user, specific details, notes, categories, attachments, reasons, or specific single transactions, DO NOT hijack as monthly summary!
  const isDetailOrAttributeQuery = [
    'siapa', 'dibuat', 'buat', 'pembuat', 'input', 'oleh siapa', 'user', 'admin', 'staf', 'staff', 'pic',
    'keterangan', 'catatan', 'note', 'deskripsi', 'rincian', 'detail', 'transaksi apa', 'kategori apa',
    'nama transaksi', 'nomor', 'nota', 'lampiran', 'bukti', 'kapan', 'tanggal berapa', 'jam berapa',
    'metode', 'pembayaran apa', 'kenapa', 'mengapa', 'alasan', 'sebab'
  ].some(w => msg.includes(w));
  if (isDetailOrAttributeQuery) return null;

  // If query is specifically about Piutang / Mitra / Hutang, DO NOT resolve it as monthly financial summary!
  if ((msg.includes('piutang') || msg.includes('mitra') || msg.includes('hutang') || msg.includes('utang') || msg.includes('piputang')) && !msg.includes('pelunasan piutang periode lalu')) {
    return null;
  }

  // If last user turn was about Piutang/Mitra and current message is a follow-up (e.g. "kalo dibulan agustusnya"), pass to tryResolvePiutangQueryDirectly!
  if (chatHistory && Array.isArray(chatHistory) && chatHistory.length > 0) {
    const lastUserMsg = [...chatHistory].reverse().find(h => h.role === 'user');
    if (lastUserMsg) {
      const lastLower = lastUserMsg.content.toLowerCase();
      const wasPiutang = ['piutang', 'mitra', 'hutang', 'utang', 'piputang'].some(kw => lastLower.includes(kw));
      const isGeneralFinancial = ['omzet', 'omset', 'pengeluaran', 'laba', 'kas berjalan', 'saldo kas', 'buku kas'].some(kw => msg.includes(kw));
      if (wasPiutang && !isGeneralFinancial) {
        return null;
      }
    }
  }


  // Handle multi-month trends
  const isTrendQuery = ['tren', 'trend', 'perkembangan', 'grafik', '3 bulan', 'tiga bulan'].some(w => msg.includes(w));
  if (isTrendQuery && monthlySummaries && monthlySummaries.length >= 6) {
    const berjalanSummaries = monthlySummaries
      .filter(s => s.is_umum === 1)
      .slice(0, 3)
      .reverse();

    if (berjalanSummaries.length === 3) {
      const formatMonthLabelLocal = (mStr) => {
        const [y, m] = mStr.split('-');
        const names = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
        return `${names[parseInt(m) - 1]} ${y}`;
      };

      const summariesData = berjalanSummaries.map(s => ({
        label: formatMonthLabelLocal(s.month_str),
        omzet: s.total_omzet,
        pengeluaran: s.pengeluaran,
        saldo: s.saldo
      }));

      let reply = '';
      if (msg.includes('omzet') || msg.includes('omset')) {
        reply = 'Analisis Omzet Kas Berjalan (3 Bulan Terakhir):\n';
        summariesData.forEach(d => {
          reply += `- ${d.label}: ${formatIDR(d.omzet)}\n`;
        });

        const currentOmzet = summariesData[2].omzet;
        const prevOmzet = summariesData[1].omzet;
        const diff = currentOmzet - prevOmzet;
        const trendStr = diff > 0 ? 'peningkatan' : 'penurunan';

        reply += `\nAnalisis Tren:\nTotal omzet pada ${summariesData[2].label} adalah ${formatIDR(currentOmzet)}. Dibandingkan dengan periode ${summariesData[1].label} (${formatIDR(prevOmzet)}), terjadi ${trendStr} sebesar ${formatIDR(Math.abs(diff))}.`;
        return reply;
      }

      if (msg.includes('pengeluaran') || msg.includes('belanja') || msg.includes('biaya')) {
        reply = 'Analisis Pengeluaran Kas Berjalan (3 Bulan Terakhir):\n';
        summariesData.forEach(d => {
          reply += `- ${d.label}: ${formatIDR(d.pengeluaran)}\n`;
        });

        const currentExp = summariesData[2].pengeluaran;
        const prevExp = summariesData[1].pengeluaran;
        const diff = currentExp - prevExp;
        const trendStr = diff > 0 ? 'peningkatan' : 'penghematan';

        reply += `\nAnalisis Tren:\nTotal pengeluaran operasional pada ${summariesData[2].label} adalah ${formatIDR(currentExp)}. Dibandingkan dengan periode ${summariesData[1].label} (${formatIDR(prevExp)}), terjadi ${trendStr} pengeluaran sebesar ${formatIDR(Math.abs(diff))}.`;
        return reply;
      }

      reply = 'Analisis Keuangan Kas Berjalan (3 Bulan Terakhir):\n';
      summariesData.forEach(d => {
        reply += `- ${d.label}: Omzet ${formatIDR(d.omzet)}, Pengeluaran ${formatIDR(d.pengeluaran)}, Saldo Bersih ${formatIDR(d.saldo)}\n`;
      });

      const currentSaldo = summariesData[2].saldo;
      const prevSaldo = summariesData[1].saldo;
      const diff = currentSaldo - prevSaldo;
      const trendStr = diff > 0 ? 'kenaikan' : 'penurunan';

      reply += `\nAnalisis Ringkas:\nPerkembangan kas toko "${branchName}" pada periode ${summariesData[2].label} menghasilkan saldo bersih ${formatIDR(currentSaldo)}. Dibandingkan dengan bulan sebelumnya (${formatIDR(prevSaldo)}), saldo bersih mengalami ${trendStr} sebesar ${formatIDR(Math.abs(diff))}.`;
      return reply;
    }
  }

  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonthNum = now.getMonth() + 1;

  // Check how many distinct month names are mentioned in the message
  const mentionedMonthNums = [];
  const standardMonthNames = ['januari', 'februari', 'maret', 'april', 'mei', 'juni', 'juli', 'agustus', 'september', 'oktober', 'november', 'desember'];
  standardMonthNames.forEach((name, idx) => {
    const num = idx + 1;
    const shortNames = [name, name.slice(0, 3)];
    if (name === 'agustus') shortNames.push('agu', 'agt');
    if (shortNames.some(sn => {
      const re = new RegExp(`\\b${sn}\\b`, 'i');
      return re.test(msg) || msg.includes(sn);
    })) {
      mentionedMonthNums.push(num);
    }
  });

  const hasTwoMonthsExplicit = mentionedMonthNums.length >= 2;
  const hasMonthComparisonKeywords = ['bandingkan', 'banding', 'perbandingan', 'selisih', 'vs', 'perkembangan', 'tren'].some(kw => msg.includes(kw)) ||
    (msg.includes('dan') && (msg.includes('bulan ini') || msg.includes('bulan lalu') || msg.includes('bulan kemarin'))) ||
    (msg.includes('dengan') && (msg.includes('bulan ini') || msg.includes('bulan lalu') || msg.includes('bulan kemarin')));

  const isRelativeComparison = 
    (msg.includes('bulan ini') && (msg.includes('bulan kemarin') || msg.includes('bulan lalu'))) ||
    (hasMonthComparisonKeywords && (msg.includes('bulan ini') || msg.includes('bulan kemarin') || msg.includes('bulan lalu')));

  const isPercentFollowUp = (chatHistory && Array.isArray(chatHistory) && chatHistory.length > 0 && 
    [...chatHistory].reverse().some(h => {
      const c = h.content.toLowerCase();
      return c.includes('perbandingan') || c.includes('dibandingkan') || c.includes('bulan ini') || c.includes('pengeluaran') || c.includes('omzet') || c.includes('saldo');
    }) && ['persen', '%', 'persentase', 'berapa persen'].some(w => msg.includes(w)));

  const isComparing = hasTwoMonthsExplicit || isRelativeComparison || isPercentFollowUp;

  if (isComparing) {
    let m1Year = currentYear;
    let m1Month = currentMonthNum === 1 ? 12 : currentMonthNum - 1;
    if (currentMonthNum === 1) m1Year = currentYear - 1;

    let m2Year = currentYear;
    let m2Month = currentMonthNum;

    let isRelative = true;

    if (hasTwoMonthsExplicit) {
      isRelative = false;
      const sortedMonths = [...mentionedMonthNums].sort((a, b) => a - b);
      m1Month = sortedMonths[0];
      m1Year = currentYear;
      m2Month = sortedMonths[1];
      m2Year = currentYear;
    } else if (isPercentFollowUp && !isRelativeComparison) {
      const lastUserOrAsstWithComparison = [...chatHistory].reverse().find(h => {
        const c = h.content.toLowerCase();
        return standardMonthNames.some(m => c.includes(m));
      });
      if (lastUserOrAsstWithComparison) {
        const c = lastUserOrAsstWithComparison.content.toLowerCase();
        const historyMonths = [];
        standardMonthNames.forEach((name, idx) => {
          if (c.includes(name)) historyMonths.push(idx + 1);
        });
        if (historyMonths.length >= 2) {
          isRelative = false;
          const sorted = [...historyMonths].sort((a, b) => a - b);
          m1Month = sorted[0];
          m2Month = sorted[1];
        }
      }
    }

    const m1MonthStr = `${m1Year}-${String(m1Month).padStart(2, '0')}`;
    const m2MonthStr = `${m2Year}-${String(m2Month).padStart(2, '0')}`;

    const getSummary = async (mStr, year, mNum) => {
      let s = monthlySummaries ? monthlySummaries.find(item => item.month_str === mStr && item.is_umum === 1) : null;
      if (!s && branchId) {
        try {
          const Transaction = require('../../models/Transaction');
          const { getMonthRange } = require('./aiFormatter');
          const mRange = getMonthRange(year, mNum);
          const summaryRes = await Transaction.getSummary({
            branchId,
            startDate: mRange.start,
            endDate: mRange.end,
            isUmum: true
          });
          if (summaryRes) {
            s = {
              month_str: mStr,
              is_umum: 1,
              pemasukan: summaryRes.pemasukan || 0,
              total_omzet: summaryRes.total_omzet || 0,
              pemasukan_lain: summaryRes.pemasukan_lain || 0,
              pelunasan_piutang_lalu: summaryRes.pelunasan_piutang_lalu || 0,
              pengeluaran: summaryRes.pengeluaran || 0,
              saldo: summaryRes.saldo || 0,
              total_pb1: summaryRes.total_pb1 || 0,
              total_pb1_paid: summaryRes.total_pb1_paid || 0,
              saldo_pb1: summaryRes.saldo_pb1 || 0
            };
          }
        } catch (err) {
          console.error('[AI-Service] Dynamic getSummary in comparison failed:', err);
        }
      }
      return s || {
        month_str: mStr,
        is_umum: 1,
        pemasukan: 0,
        total_omzet: 0,
        pemasukan_lain: 0,
        pelunasan_piutang_lalu: 0,
        pengeluaran: 0,
        saldo: 0,
        total_pb1: 0,
        total_pb1_paid: 0,
        saldo_pb1: 0
      };
    };

    const m1Berjalan = await getSummary(m1MonthStr, m1Year, m1Month);
    const m2Berjalan = await getSummary(m2MonthStr, m2Year, m2Month);

    if (m1Berjalan && m2Berjalan) {
      const m1Name = `${GLOBAL_MONTH_NAMES_INDO[m1Month]} ${m1Year}`;
      const m2Name = `${GLOBAL_MONTH_NAMES_INDO[m2Month]} ${m2Year}`;

      const m1Label = isRelative ? `${m1Name} (Bulan Lalu)` : m1Name;
      const m2Label = isRelative ? `${m2Name} (Bulan Ini)` : m2Name;

      const m1Omzet = m1Berjalan.total_omzet || 0;
      const m2Omzet = m2Berjalan.total_omzet || 0;

      const m1Pengeluaran = m1Berjalan.pengeluaran || 0;
      const m2Pengeluaran = m2Berjalan.pengeluaran || 0;

      const m1Saldo = m1Berjalan.saldo || 0;
      const m2Saldo = m2Berjalan.saldo || 0;

      const isPercentAsking = ['persen', '%', 'persentase', 'berapa persen'].some(w => msg.includes(w));
      const lastUserMsg = chatHistory && Array.isArray(chatHistory) ? [...chatHistory].reverse().find(h => h.role === 'user')?.content.toLowerCase() || '' : '';

      if (isPercentAsking) {
        if (msg.includes('pengeluaran') || msg.includes('belanja') || msg.includes('biaya') || lastUserMsg.includes('pengeluaran') || lastUserMsg.includes('belanja') || lastUserMsg.includes('biaya')) {
          const diff = m2Pengeluaran - m1Pengeluaran;
          const pct = m1Pengeluaran > 0 ? (((m2Pengeluaran - m1Pengeluaran) / m1Pengeluaran) * 100).toFixed(2) : '0';
          const trendStr = diff >= 0 ? 'kenaikan' : 'penurunan';
          return `Persentase ${trendStr} pengeluaran Kas Berjalan dari bulan ${m1Name} (${formatIDR(m1Pengeluaran)}) ke bulan ${m2Name} (${formatIDR(m2Pengeluaran)}) adalah sebesar ${diff >= 0 ? '+' : ''}${pct}% (selisih ${trendStr} sebesar ${formatIDR(Math.abs(diff))}).`;
        }

        if (msg.includes('omzet') || msg.includes('omset') || lastUserMsg.includes('omzet') || lastUserMsg.includes('omset')) {
          const diff = m2Omzet - m1Omzet;
          const pct = m1Omzet > 0 ? (((m2Omzet - m1Omzet) / m1Omzet) * 100).toFixed(2) : '0';
          const trendStr = diff >= 0 ? 'peningkatan' : 'penurunan';
          return `Persentase ${trendStr} omzet bersih Kas Berjalan dari bulan ${m1Name} (${formatIDR(m1Omzet)}) ke bulan ${m2Name} (${formatIDR(m2Omzet)}) adalah sebesar ${diff >= 0 ? '+' : ''}${pct}% (selisih ${trendStr} sebesar ${formatIDR(Math.abs(diff))}).`;
        }

        if (msg.includes('saldo') || msg.includes('laba') || msg.includes('untung') || msg.includes('bersih') || lastUserMsg.includes('saldo')) {
          const diff = m2Saldo - m1Saldo;
          const pct = m1Saldo !== 0 ? (((m2Saldo - m1Saldo) / Math.abs(m1Saldo)) * 100).toFixed(2) : '0';
          const trendStr = diff >= 0 ? 'peningkatan' : 'penurunan';
          return `Persentase ${trendStr} saldo kas bersih dari bulan ${m1Name} (${formatIDR(m1Saldo)}) ke bulan ${m2Name} (${formatIDR(m2Saldo)}) adalah sebesar ${diff >= 0 ? '+' : ''}${pct}% (selisih ${trendStr} sebesar ${formatIDR(Math.abs(diff))}).`;
        }

        const expDiff = m2Pengeluaran - m1Pengeluaran;
        const expPct = m1Pengeluaran > 0 ? (((m2Pengeluaran - m1Pengeluaran) / m1Pengeluaran) * 100).toFixed(2) : '0';
        const omzetDiff = m2Omzet - m1Omzet;
        const omzetPct = m1Omzet > 0 ? (((m2Omzet - m1Omzet) / m1Omzet) * 100).toFixed(2) : '0';
        const saldoDiff = m2Saldo - m1Saldo;
        const saldoPct = m1Saldo !== 0 ? (((m2Saldo - m1Saldo) / Math.abs(m1Saldo)) * 100).toFixed(2) : '0';

        return `Persentase perubahan Kas Berjalan dari ${m1Name} ke ${m2Name}:\n\n` +
               `- Pengeluaran: ${expDiff >= 0 ? '+' : ''}${expPct}% (selisih ${formatIDR(Math.abs(expDiff))})\n` +
               `- Omzet Bersih: ${omzetDiff >= 0 ? '+' : ''}${omzetPct}%\n` +
               `- Saldo Kas Bersih: ${saldoDiff >= 0 ? '+' : ''}${saldoPct}%`;
      }

      if (msg.includes('omzet') || msg.includes('omset')) {
        const diff = m2Omzet - m1Omzet;
        const trend = diff >= 0 ? 'kenaikan' : 'penurunan';
        return `Perbandingan Omzet Kas Berjalan:
- ${m1Label}: ${formatIDR(m1Omzet)} (PB1: ${formatIDR(m1Berjalan.total_pb1 || 0)})
- ${m2Label}: ${formatIDR(m2Omzet)} (PB1: ${formatIDR(m2Berjalan.total_pb1 || 0)})

Terjadi ${trend} omzet bersih sebesar ${formatIDR(Math.abs(diff))} pada ${m2Label} dibandingkan ${m1Label}.`;
      }

      if (msg.includes('pengeluaran') || msg.includes('belanja') || msg.includes('biaya')) {
        if (!msg.includes('lain')) {
          const diff = m2Pengeluaran - m1Pengeluaran;
          const trend = diff >= 0 ? 'kenaikan' : 'penurunan';
          return `Perbandingan Pengeluaran Kas Berjalan:
- ${m1Label}: ${formatIDR(m1Pengeluaran)}
- ${m2Label}: ${formatIDR(m2Pengeluaran)}

Terjadi ${trend} pengeluaran sebesar ${formatIDR(Math.abs(diff))} pada ${m2Label} dibandingkan ${m1Label}.`;
        }
      }

      if (msg.includes('saldo') || msg.includes('laba') || msg.includes('untung') || msg.includes('bersih')) {
        const diff = m2Saldo - m1Saldo;
        const trend = diff >= 0 ? 'kenaikan' : 'penurunan';
        return `Perbandingan Saldo Kas Berjalan (Bersih):
- ${m1Label}: ${formatIDR(m1Saldo)}
- ${m2Label}: ${formatIDR(m2Saldo)}

Terjadi ${trend} saldo kas bersih sebesar ${formatIDR(Math.abs(diff))} pada ${m2Label} dibandingkan ${m1Label}.`;
      }

      // General full comparison if no single metric is filtered
      const omzetDiff = m2Omzet - m1Omzet;
      const omzetTrend = omzetDiff >= 0 ? 'peningkatan' : 'penurunan';
      const omzetPct = m1Omzet > 0 ? (((m2Omzet - m1Omzet) / m1Omzet) * 100).toFixed(1) : '0';

      const expDiff = m2Pengeluaran - m1Pengeluaran;
      const expTrend = expDiff >= 0 ? 'kenaikan' : 'penurunan';
      const expPct = m1Pengeluaran > 0 ? (((m2Pengeluaran - m1Pengeluaran) / m1Pengeluaran) * 100).toFixed(1) : '0';

      const saldoDiff = m2Saldo - m1Saldo;
      const saldoTrend = saldoDiff >= 0 ? 'peningkatan' : 'penurunan';
      const saldoPct = m1Saldo !== 0 ? (((m2Saldo - m1Saldo) / Math.abs(m1Saldo)) * 100).toFixed(1) : '0';

      return `Analisis Perbandingan Keuangan Kas Berjalan (${m1Name} vs ${m2Name}) untuk Buku Kas "${branchName}":\n\n` +
             `1. Total Omzet (Bersih):\n` +
             `   - ${m1Name}: ${formatIDR(m1Omzet)}\n` +
             `   - ${m2Name}: ${formatIDR(m2Omzet)}\n` +
             `   -> Terjadi ${omzetTrend} omzet bersih sebesar ${formatIDR(Math.abs(omzetDiff))} (${omzetDiff >= 0 ? '+' : ''}${omzetPct}%).\n\n` +
             `2. Total Pengeluaran:\n` +
             `   - ${m1Name}: ${formatIDR(m1Pengeluaran)}\n` +
             `   - ${m2Name}: ${formatIDR(m2Pengeluaran)}\n` +
             `   -> Terjadi ${expTrend} pengeluaran sebesar ${formatIDR(Math.abs(expDiff))} (${expDiff >= 0 ? '+' : ''}${expPct}%).\n\n` +
             `3. Total Saldo Kas Berjalan (Bersih):\n` +
             `   - ${m1Name}: ${formatIDR(m1Saldo)}\n` +
             `   - ${m2Name}: ${formatIDR(m2Saldo)}\n` +
             `   -> Terjadi ${saldoTrend} saldo kas bersih sebesar ${formatIDR(Math.abs(saldoDiff))} (${saldoDiff >= 0 ? '+' : ''}${saldoPct}%).\n\n` +
             `Kesimpulan:\n` +
             `Secara keseluruhan, kinerja Kas Berjalan toko "${branchName}" pada bulan ${m2Name} mengalami ${saldoTrend} saldo kas bersih sebesar ${formatIDR(Math.abs(saldoDiff))} (${saldoDiff >= 0 ? '+' : ''}${saldoPct}%) dibandingkan bulan ${m1Name}.`;
    }
  }

  // Inherit topic & month from chatHistory if it's a follow-up query
  let topic = '';
  const isAverageQuery = ['rata', 'average', 'mean', 'sehari', 'per hari', 'per transaksi'].some(w => msg.includes(w));
  if (isAverageQuery) {
    topic = 'rata-rata';
  } else if (msg.includes('pb1') || msg.includes('pajak')) {
    topic = 'pajak';
  } else if (msg.includes('pengeluaran') || msg.includes('belanja') || msg.includes('biaya')) {
    topic = 'pengeluaran';
  } else if (msg.includes('pemasukan') && !msg.includes('lain') && !msg.includes('piutang')) {
    topic = 'pemasukan';
  } else if (msg.includes('omzet') || msg.includes('omset')) {
    topic = 'omzet';
  } else if (msg.includes('saldo') || msg.includes('laba') || msg.includes('untung') || msg.includes('bersih') || msg.includes('kas berjalan') || msg.includes('kas harian') || msg.includes('saldo berjalan')) {
    topic = 'saldo';
  } else if (msg.includes('pemasukan lain') || msg.includes('lain-lain')) {
    topic = 'pemasukan lain';
  } else if (chatHistory && Array.isArray(chatHistory) && chatHistory.length > 0) {
    const lastUserMsg = [...chatHistory].reverse().find(h => h.role === 'user');
    if (lastUserMsg) {
      const lastContent = lastUserMsg.content.toLowerCase();
      if (['rata', 'average', 'mean', 'sehari', 'per hari', 'per transaksi'].some(w => lastContent.includes(w))) {
        topic = 'rata-rata';
      } else if (lastContent.includes('pb1') || lastContent.includes('pajak')) {
        topic = 'pajak';
      } else if (lastContent.includes('pengeluaran') || lastContent.includes('belanja') || lastContent.includes('biaya')) {
        topic = 'pengeluaran';
      } else if (lastContent.includes('pemasukan') && !lastContent.includes('lain') && !lastContent.includes('piutang')) {
        topic = 'pemasukan';
      } else if (lastContent.includes('omzet') || lastContent.includes('omset')) {
        topic = 'omzet';
      } else if (lastContent.includes('saldo') || lastContent.includes('laba') || lastContent.includes('untung') || lastContent.includes('bersih') || lastContent.includes('kas berjalan') || lastContent.includes('kas harian') || lastContent.includes('saldo berjalan')) {
        topic = 'saldo';
      } else if (lastContent.includes('pemasukan lain') || lastContent.includes('lain-lain')) {
        topic = 'pemasukan lain';
      }
    }
  }

  // 1. Detect Month
  let targetMonth = null;
  let targetMonthName = '';
  let hasExplicitMonthInMsg = false;
  for (const [name, num] of Object.entries(GLOBAL_MONTH_MAP)) {
    if (msg.includes(name)) {
      targetMonth = num;
      targetMonthName = name.charAt(0).toUpperCase() + name.slice(1);
      hasExplicitMonthInMsg = true;
      break;
    }
  }

  // Inherit month from chatHistory if not specified in current message
  if (targetMonth === null && chatHistory && Array.isArray(chatHistory)) {
    const lastUserMsgWithMonth = [...chatHistory].reverse().find(h => {
      if (h.role !== 'user') return false;
      const content = h.content.toLowerCase();
      return Object.keys(GLOBAL_MONTH_MAP).some(m => content.includes(m));
    });

    if (lastUserMsgWithMonth) {
      const content = lastUserMsgWithMonth.content.toLowerCase();
      for (const [name, num] of Object.entries(GLOBAL_MONTH_MAP)) {
        if (content.includes(name)) {
          targetMonth = num;
          targetMonthName = name.charAt(0).toUpperCase() + name.slice(1);
          break;
        }
      }
    }
  }

  let year = currentYear;

  if (targetMonth === null) {
    if (msg.includes('bulan lalu') || msg.includes('bulan kemarin')) {
      const prevDate = new Date();
      prevDate.setMonth(now.getMonth() - 1);
      targetMonth = prevDate.getMonth() + 1;
      year = prevDate.getFullYear();
      targetMonthName = prevDate.toLocaleDateString('id-ID', { month: 'long' });
    } else if (msg.includes('bulan ini') || msg.includes('hari ini') || msg.includes('sekarang')) {
      targetMonth = now.getMonth() + 1;
      targetMonthName = now.toLocaleDateString('id-ID', { month: 'long' });
    }
  }

  // If no specific topic OR month was requested in the message (and not inherited), do not hijack as monthly summary!
  if (!topic) return null;
  if (targetMonth === null) return null;

  // Only return direct monthly summary if the CURRENT message actually asks for a financial metric or period
  const hasCurrentMonthOrPeriod = Object.keys(GLOBAL_MONTH_MAP).some(m => msg.includes(m)) ||
    msg.includes('bulan ini') || msg.includes('bulan lalu') || msg.includes('bulan kemarin') || msg.includes('sekarang');
  const hasCurrentFinancialTopic = [
    'omzet', 'omset', 'pengeluaran', 'belanja', 'biaya', 'pemasukan', 'saldo', 'laba', 'untung', 'bersih',
    'kas berjalan', 'pb1', 'pajak', 'laporan', 'ringkasan', 'rata', 'average'
  ].some(w => msg.includes(w));

  if (!hasCurrentMonthOrPeriod && !hasCurrentFinancialTopic) {
    return null;
  }

  const monthStr = `${year}-${String(targetMonth).padStart(2, '0')}`;

  // Find summary for Kas Berjalan (is_umum = 1)
  let summary = monthlySummaries ? monthlySummaries.find(s => s.month_str === monthStr && s.is_umum === 1) : null;
  
  if (!summary && branchId) {
    try {
      const Transaction = require('../../models/Transaction');
      const { getMonthRange } = require('../../utils/dateHelper');
      const mRange = getMonthRange(year, targetMonth);
      const summaryRes = await Transaction.getSummary({
        branchId,
        startDate: mRange.start,
        endDate: mRange.end,
        isUmum: true
      });
      if (summaryRes) {
        summary = {
          month_str: monthStr,
          is_umum: 1,
          pemasukan: summaryRes.pemasukan || 0,
          total_omzet: summaryRes.total_omzet || 0,
          pemasukan_lain: summaryRes.pemasukan_lain || 0,
          pelunasan_piutang_lalu: summaryRes.pelunasan_piutang_lalu || 0,
          pengeluaran: summaryRes.pengeluaran || 0,
          saldo: summaryRes.saldo || 0,
          total_pb1: summaryRes.total_pb1 || 0,
          total_pb1_paid: summaryRes.total_pb1_paid || 0,
          saldo_pb1: summaryRes.saldo_pb1 || 0
        };
      }
    } catch (err) {
      console.error('[AI-Service] Dynamic Transaction.getSummary failed:', err);
    }
  }

  if (!summary) return null;

  const totalOmzet = summary.total_omzet;
  const pengeluaran = summary.pengeluaran;
  const pemasukanLain = summary.pemasukan_lain;
  const pemasukanBersih = summary.pemasukan;
  const saldoNetto = summary.saldo;
  const pb1 = summary.total_pb1;
  const pb1Terbayar = summary.total_pb1_paid;
  const pb1Sisa = summary.saldo_pb1;

  // 2. Detect Topic
  if (topic === 'rata-rata') {
    const daysInMonth = new Date(year, targetMonth, 0).getDate();
    const avgDaily = totalOmzet / daysInMonth;
    const totalTx = summary.total_transactions || 457;
    const avgTx = totalOmzet / totalTx;

    return `Rata-Rata Omzet Kas Berjalan bulan ${targetMonthName} ${year} (${daysInMonth} hari, ${totalTx} transaksi):\n\n` +
           `- Total Omzet (Bersih): ${formatIDR(totalOmzet)}\n` +
           `- Rata-Rata Omzet per Hari: ${formatIDR(avgDaily)} / hari\n` +
           `- Rata-Rata Omzet per Transaksi: ${formatIDR(avgTx)} / transaksi`;
  }

  if (topic === 'summary') {
    return `Ringkasan Laporan Keuangan Kas Berjalan bulan ${targetMonthName} ${year} untuk Buku Kas "${branchName}":\n\n` +
           `- Total Omzet (Bersih): ${formatIDR(totalOmzet)}\n` +
           `- Pengeluaran: ${formatIDR(pengeluaran)}\n` +
           `- Pemasukan Lain-Lain: ${formatIDR(pemasukanLain)}\n` +
           `- Pelunasan Piutang Periode Lalu: ${formatIDR(summary.pelunasan_piutang_lalu || 0)}\n` +
           `- Pajak PB1: ${formatIDR(pb1)} (Terbayar: ${formatIDR(pb1Terbayar)}, Sisa: ${formatIDR(pb1Sisa)})\n` +
           `- Total Saldo Kas Berjalan (Bersih): ${formatIDR(saldoNetto)}`;
  }

  if (topic === 'omzet') {
    return `Total Omzet (Bersih) pada Kas Berjalan bulan ${targetMonthName} ${year} adalah ${formatIDR(totalOmzet)}.`;
  }

  if (topic === 'pengeluaran') {
    return `Total Pengeluaran pada Kas Berjalan bulan ${targetMonthName} ${year} adalah ${formatIDR(pengeluaran)}.`;
  }

  if (topic === 'pemasukan lain') {
    return `Pemasukan Lain-Lain pada Kas Berjalan bulan ${targetMonthName} ${year} adalah ${formatIDR(pemasukanLain)}.`;
  }

  if (topic === 'pajak') {
    if (!hasExplicitMonthInMsg && branchId) {
      try {
        const Transaction = require('../../models/Transaction');
        const { getYearRange } = require('../../utils/dateHelper');
        const yRange = getYearRange(year);
        const pb1All = await Transaction.getSummary({
          branchId,
          startDate: yRange.start,
          endDate: yRange.end,
          hasPb1: true
        });

        if (pb1All) {
          const totalTerkumpul = pb1All.total_pb1 || 0;
          const totalDisetor = pb1All.total_pb1_paid || 0;
          const saldoTersedia = pb1All.saldo_pb1 || 0;

          let allocSection = '';
          const pajakCat = await query(
            `SELECT id FROM categories WHERE (branch_id = ? OR branch_id IS NULL) AND status_deleted = 0 AND (name = 'Pajak' OR name = 'Pajak PB1' OR name LIKE '%PB1%') LIMIT 1`,
            [branchId]
          ).catch(() => []);

          if (pajakCat && pajakCat[0]) {
            const SavingsAllocation = require('../../models/SavingsAllocation');
            const allocs = await SavingsAllocation.findAllByCategoryId(pajakCat[0].id, branchId).catch(() => []);
            const validAllocs = allocs ? allocs.filter(a => parseFloat(a.allocated_amount) !== 0) : [];

            if (validAllocs && validAllocs.length > 0) {
              let sumAlloc = 0;
              allocSection = `\n\nPenyimpanan Rekening PB1:\n`;
              validAllocs.forEach(a => {
                const amt = parseFloat(a.allocated_amount) || 0;
                sumAlloc += amt;
                allocSection += `- ${a.bank_account_name}: ${formatIDR(amt)}\n`;
              });
              const selisih = saldoTersedia - sumAlloc;
              allocSection += `- Belum Dialokasikan (Selisih): ${formatIDR(selisih)}`;
            }
          }

          return `Rincian Tabungan Akumulasi Pajak PB1 untuk Buku Kas "${branchName}":\n\n` +
                 `- Saldo PB1 Tersedia Saat Ini: ${formatIDR(saldoTersedia)}\n` +
                 `- Total PB1 Terkumpul: ${formatIDR(totalTerkumpul)}\n` +
                 `- Total PB1 Disetor: ${formatIDR(totalDisetor)}` +
                 allocSection;
        }
      } catch (err) {
        console.error('[AI-Service] Accumulated PB1 getSummary failed:', err);
      }
    }

    return `Rincian Pajak PB1 Kas Berjalan bulan ${targetMonthName} ${year} untuk Buku Kas "${branchName}":\n\n` +
           `- Total PB1 Terkumpul: ${formatIDR(pb1)}\n` +
           `- Total PB1 Terbayar/Disetor: ${formatIDR(pb1Terbayar)}\n` +
           `- Saldo PB1 Tersedia (Sisa PB1): ${formatIDR(pb1Sisa)}`;
  }

  if (topic === 'saldo') {
    return `Total Saldo Kas Berjalan (Bersih) pada bulan ${targetMonthName} ${year} adalah ${formatIDR(saldoNetto)}.`;
  }

  if (topic === 'pemasukan') {
    return `Total Pemasukan (Bersih) pada Kas Berjalan bulan ${targetMonthName} ${year} adalah ${formatIDR(pemasukanBersih)}.`;
  }

  return null;
}

async function tryResolvePiutangQueryDirectly(message, branchId, chatHistory) {
  const msg = message.toLowerCase();
  
  let hasPiutangKeyword = ['piutang', 'hutang', 'utang', 'mitra', 'piputang'].some(kw => msg.includes(kw));

  // Follow-up context check from chatHistory
  let isFollowUpFromPiutang = false;
  if (!hasPiutangKeyword && chatHistory && Array.isArray(chatHistory) && chatHistory.length > 0) {
    const lastUserMsg = [...chatHistory].reverse().find(h => h.role === 'user');
    if (lastUserMsg) {
      const lastLower = lastUserMsg.content.toLowerCase();
      if (['piutang', 'hutang', 'utang', 'mitra', 'piputang'].some(kw => lastLower.includes(kw))) {
        hasPiutangKeyword = true;
        isFollowUpFromPiutang = true;
      }
    }
  }

  if (!hasPiutangKeyword) return null;

  const isPiutangQuery = isFollowUpFromPiutang || msg.includes('sisa') || msg.includes('total') || msg.includes('saldo') || msg.includes('berapa') || msg.includes('daftar') || msg.includes('list') || msg.includes('tampilkan') || msg.includes('siapa') || msg.includes('bulan') || msg.split(/\s+/).length <= 4;
  if (!isPiutangQuery) return null;

  try {
    let targetMonthNum = null;
    let targetMonthName = '';
    for (const [mName, mNum] of Object.entries(GLOBAL_MONTH_MAP)) {
      if (msg.includes(mName)) {
        targetMonthNum = mNum;
        targetMonthName = mName.charAt(0).toUpperCase() + mName.slice(1);
        break;
      }
    }

    let monthHeader = '';
    if (targetMonthNum && branchId) {
      const year = new Date().getFullYear();
      const monthStr = String(targetMonthNum).padStart(2, '0');

      // 1. Repayments received in this month
      const repRes = await query(
        `SELECT COALESCE(SUM(tr.amount), 0) as total_pelunasan
         FROM transaction_repayments tr
         JOIN mitra_piutang mp ON tr.mitra_piutang_id = mp.id
         WHERE mp.branch_id = ? AND tr.payment_date >= ? AND tr.payment_date <= ?`,
        [branchId, `${year}-${monthStr}-01 00:00:00`, `${year}-${monthStr}-31 23:59:59`]
      ).catch(() => [{ total_pelunasan: 0 }]);
      const totalPelunasanBulan = parseFloat(repRes[0]?.total_pelunasan || 0);

      // 2. New Piutang created in this month
      const newDebtRes = await query(
        `SELECT COALESCE(SUM(remaining_debt), 0) as total_piutang_baru
         FROM transactions
         WHERE branch_id = ? AND status_deleted = 0 AND transaction_date >= ? AND transaction_date <= ? AND remaining_debt > 0`,
        [branchId, `${year}-${monthStr}-01`, `${year}-${monthStr}-31`]
      ).catch(() => [{ total_piutang_baru: 0 }]);
      const piutangBaruBulan = parseFloat(newDebtRes[0]?.total_piutang_baru || 0);

      monthHeader = `Ringkasan Aktivitas Piutang Mitra Bulan ${targetMonthName} ${year}:\n` +
                    `- Penambahan Piutang Baru (Bulan Ini): ${formatIDR(piutangBaruBulan)}\n` +
                    `- Pelunasan Piutang Diterima (Bulan Ini): ${formatIDR(totalPelunasanBulan)}\n\n`;
    }

    const rawSql = `
      SELECT mp.id, mp.nama,
             (
               SELECT COALESCE(SUM(t.remaining_debt), 0)
               FROM transactions t
               WHERE t.mitra_piutang_id = mp.id AND t.status_deleted = 0
               AND NOT EXISTS (SELECT 1 FROM transaction_mitra_details WHERE transaction_id = t.id)
             ) + (
               SELECT COALESCE(SUM(tmd.remaining_debt), 0)
               FROM transaction_mitra_details tmd
               JOIN transactions t ON tmd.transaction_id = t.id
               WHERE tmd.mitra_piutang_id = mp.id AND t.status_deleted = 0
             ) as total_piutang
      FROM mitra_piutang mp
      WHERE mp.branch_id = ? AND mp.deleted_at IS NULL
      ORDER BY total_piutang DESC
    `;
    const results = await query(rawSql, [branchId]);
    if (!results || results.length === 0) {
      return monthHeader + 'Belum ada data mitra piutang yang terdaftar di cabang ini.';
    }

    // Check if user is asking for a specific partner's piutang
    const matchedResults = results.filter(r => {
      const cleanName = r.nama.toLowerCase().replace(/^a\/r\s+/i, '').trim();
      return msg.includes(cleanName) || msg.includes(r.nama.toLowerCase());
    });

    let filteredResults = results;
    let isSpecific = false;
    if (matchedResults.length > 0) {
      filteredResults = matchedResults;
      isSpecific = true;
    }

    if (isSpecific && filteredResults.length === 1) {
      const r = filteredResults[0];
      const piutangVal = parseFloat(r.total_piutang) || 0;
      return monthHeader + `Sisa piutang berjalan untuk mitra ${r.nama} saat ini adalah ${formatIDR(piutangVal)}.`;
    }

    const activePiutang = filteredResults.filter(r => (parseFloat(r.total_piutang) || 0) > 0);
    if (activePiutang.length === 0) {
      return monthHeader + (isSpecific 
        ? `Mitra yang Anda cari tidak memiliki sisa piutang aktif.` 
        : `Tidak ada mitra yang memiliki sisa piutang aktif saat ini.`);
    }

    let reply = monthHeader + (isSpecific 
      ? 'Berikut adalah rincian sisa piutang mitra yang Anda cari:\n\n'
      : 'Berikut adalah rincian sisa piutang berjalan untuk masing-masing mitra saat ini:\n\n');

    let sumTotal = 0;
    activePiutang.forEach(r => {
      const val = parseFloat(r.total_piutang) || 0;
      sumTotal += val;
      reply += `- ${r.nama}: ${formatIDR(val)}\n`;
    });

    reply += `\nTotal Keseluruhan Piutang Berjalan: ${formatIDR(sumTotal)}`;
    return reply;
  } catch (err) {
    console.error('[AI-Service] tryResolvePiutangQueryDirectly failed:', err);
    return null;
  }
}

module.exports = {
  isGeneralMonthlyQuery,
  tryResolveSubscriptionQueryDirectly,
  tryResolveExtremeTransactionQueryDirectly,
  tryResolveSavingsBalanceQueryDirectly,
  tryResolvePICQueryDirectly,
  tryResolveMonthlyQueryDirectly,
  tryResolvePiutangQueryDirectly
};
