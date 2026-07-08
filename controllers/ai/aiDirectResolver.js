// Direct Resolvers that resolve specific user requests programmatically for speed and accuracy
const { query } = require('../../config/database');
const { formatIDR } = require('./aiFormatter');

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
  const months = ['januari', 'februari', 'maret', 'april', 'mei', 'juni', 'juli', 'agustus', 'september', 'oktober', 'november', 'desember', 'jan', 'feb', 'mar', 'apr', 'jun', 'jul', 'agu', 'sep', 'okt', 'nov', 'des'];

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

  // Exclude detailed/sorting/extreme queries that need SQL query execution
  const hasDetailedOrSorted = ['besar', 'banyak', 'kecil', 'detail', 'apa saja', 'daftar', 'list', 'nama', 'kategori', 'terbesar', 'terbanyak', 'terkecil', 'paling'].some(w => msg.includes(w));
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

  const monthMap = {
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

  let foundMonth = false;
  for (const [name, num] of Object.entries(monthMap)) {
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

function tryResolveMonthlyQueryDirectly(message, monthlySummaries, branchName, chatHistory) {
  const msg = message.toLowerCase();

  const comparativeKeywords = ['bandingkan', 'banding', 'perbandingan', 'selisih', 'vs', 'perkembangan', 'tren', 'analisis', 'analisa', 'kenapa', 'mengapa', 'sebab', 'alasan'];
  const isComparative = comparativeKeywords.some(kw => msg.includes(kw));

  const isSavingsQuery = ['simpanan', 'simpaan', 'tabungan', 'cadangan', 'pribadi'].some(w => msg.includes(w));
  if (isSavingsQuery) return null;

  // 1b. Detect if requesting 3-month trend/analysis
  const isThreeMonths = msg.includes('3 bulan') || msg.includes('tiga bulan');
  if (isThreeMonths) {
    // Get the 3 most recent months (index 0 = current month, 1 = last month, 2 = 2 months ago)
    const activeSummaries = monthlySummaries
      .filter(s => s.is_umum === 1)
      .slice(0, 3)
      .reverse(); // May, June, July

    if (activeSummaries.length >= 3) {
      let reply = '';
      const formatMonthLabel = (monthStr) => {
        const [y, m] = monthStr.split('-');
        const months = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
        return `${months[parseInt(m) - 1]} ${y}`;
      };

      const summariesData = activeSummaries.map(s => {
        const label = formatMonthLabel(s.month_str);
        const omzet = s.raw_omzet - s.total_pb1;
        const pengeluaran = s.pengeluaran;
        const saldo = (s.pemasukan - s.total_pb1) - s.pengeluaran;
        return {
          label,
          omzet,
          raw_omzet: s.raw_omzet,
          pengeluaran,
          saldo
        };
      });

      // Omzet trend
      if (msg.includes('omzet') || msg.includes('omset') || msg.includes('pemasukan')) {
        reply = 'Analisis Omzet Kas Berjalan (3 Bulan Terakhir):\n';
        summariesData.forEach(d => {
          reply += `- ${d.label}: ${formatIDR(d.omzet)} (Kotor: ${formatIDR(d.raw_omzet)})\n`;
        });

        const currentOmzet = summariesData[2].omzet;
        const prevOmzet = summariesData[1].omzet;
        const diff = currentOmzet - prevOmzet;
        const trendStr = diff > 0 ? 'kenaikan' : 'penurunan';

        reply += `\nAnalisis Tren:\nBuku kas "${branchName}" mencatatkan omzet bersih sebesar ${formatIDR(currentOmzet)} pada ${summariesData[2].label}. Dibandingkan dengan periode ${summariesData[1].label} (${formatIDR(prevOmzet)}), terjadi ${trendStr} sebesar ${formatIDR(Math.abs(diff))}.`;
        return reply;
      }

      // Pengeluaran trend
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

      // Default to general cash flow / balance trend
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

  // 1. Detect if comparing June and July (month-over-month)
  const isComparingJuneJuly = (msg.includes('juni') && msg.includes('juli')) ||
    (msg.includes('bulan ini') && (msg.includes('bulan kemarin') || msg.includes('bulan lalu'))) ||
    (msg.includes('dengan') && msg.includes('bulan ini') && msg.includes('bulan lalu')) ||
    (msg.includes('dan') && msg.includes('bulan ini') && msg.includes('bulan lalu'));

  if (isComparingJuneJuly) {
    const junBerjalan = monthlySummaries.find(s => s.month_str === '2026-06' && s.is_umum === 1);
    const julBerjalan = monthlySummaries.find(s => s.month_str === '2026-07' && s.is_umum === 1);

    if (junBerjalan && julBerjalan) {
      const junOmzet = junBerjalan.raw_omzet - junBerjalan.total_pb1;
      const julOmzet = julBerjalan.raw_omzet - julBerjalan.total_pb1;

      const junPengeluaran = junBerjalan.pengeluaran;
      const julPengeluaran = julBerjalan.pengeluaran;

      const junSaldo = (junBerjalan.pemasukan - junBerjalan.total_pb1) - junBerjalan.pengeluaran;
      const julSaldo = (julBerjalan.pemasukan - julBerjalan.total_pb1) - julBerjalan.pengeluaran;

      // Omzet comparison
      if (msg.includes('omzet') || msg.includes('omset')) {
        const diff = julOmzet - junOmzet;
        const trend = diff > 0 ? 'kenaikan' : 'penurunan';
        return `Perbandingan Omzet Kas Berjalan:
- Juni 2026 (Bulan Lalu): ${formatIDR(junOmzet)} (Kotor: ${formatIDR(junBerjalan.raw_omzet)}, PB1: ${formatIDR(junBerjalan.total_pb1)})
- Juli 2026 (Bulan Ini): ${formatIDR(julOmzet)} (Kotor: ${formatIDR(julBerjalan.raw_omzet)}, PB1: ${formatIDR(julBerjalan.total_pb1)})

Terjadi ${trend} omzet bersih sebesar ${formatIDR(Math.abs(diff))} pada bulan ini (Juli 2026) dibandingkan bulan lalu (Juni 2026).`;
      }

      // Pengeluaran comparison
      if (msg.includes('pengeluaran') || msg.includes('belanja') || msg.includes('biaya')) {
        if (!msg.includes('lain')) {
          const diff = julPengeluaran - junPengeluaran;
          const trend = diff > 0 ? 'kenaikan' : 'penurunan';
          return `Perbandingan Pengeluaran Kas Berjalan:
- Juni 2026 (Bulan Lalu): ${formatIDR(junPengeluaran)}
- Juli 2026 (Bulan Ini): ${formatIDR(julPengeluaran)}

Terjadi ${trend} pengeluaran sebesar ${formatIDR(Math.abs(diff))} pada bulan ini (Juli 2026) dibandingkan bulan lalu (Juni 2026).`;
        }
      }

      // Saldo / Laba / Keuntungan comparison
      if (msg.includes('saldo') || msg.includes('laba') || msg.includes('untung') || msg.includes('bersih')) {
        const diff = julSaldo - junSaldo;
        const trend = diff > 0 ? 'kenaikan' : 'penurunan';
        return `Perbandingan Saldo Kas Berjalan (Bersih):
- Juni 2026 (Bulan Lalu): ${formatIDR(junSaldo)}
- Juli 2026 (Bulan Ini): ${formatIDR(julSaldo)}

Terjadi ${trend} saldo kas bersih sebesar ${formatIDR(Math.abs(diff))} pada bulan ini (Juli 2026) dibandingkan bulan lalu (Juni 2026).`;
      }
    }
  }

  // Skip direct resolution if it's other complex/comparative query
  if (isComparative) return null;

  // Inherit topic from chatHistory if it's a follow-up query
  let topic = '';
  if (msg.includes('pengeluaran') || msg.includes('belanja') || msg.includes('biaya')) {
    topic = 'pengeluaran';
  } else if (msg.includes('pemasukan') && !msg.includes('lain') && !msg.includes('piutang')) {
    topic = 'pemasukan';
  } else if (msg.includes('omzet') || msg.includes('omset')) {
    topic = 'omzet';
  } else if (msg.includes('saldo') || msg.includes('laba') || msg.includes('untung') || msg.includes('bersih') || msg.includes('kas berjalan') || msg.includes('kas harian') || msg.includes('saldo berjalan')) {
    topic = 'saldo';
  } else if (msg.includes('pemasukan lain') || msg.includes('lain-lain')) {
    topic = 'pemasukan lain';
  } else if (msg.includes('pb1') || msg.includes('pajak')) {
    topic = 'pajak';
  } else if (chatHistory && Array.isArray(chatHistory) && chatHistory.length > 0) {
    const lastUserMsg = [...chatHistory].reverse().find(h => h.role === 'user');
    if (lastUserMsg) {
      const lastContent = lastUserMsg.content.toLowerCase();
      if (lastContent.includes('pengeluaran') || lastContent.includes('belanja') || lastContent.includes('biaya')) {
        topic = 'pengeluaran';
      } else if (lastContent.includes('pemasukan') && !lastContent.includes('lain') && !lastContent.includes('piutang')) {
        topic = 'pemasukan';
      } else if (lastContent.includes('omzet') || lastContent.includes('omset')) {
        topic = 'omzet';
      } else if (lastContent.includes('saldo') || lastContent.includes('laba') || lastContent.includes('untung') || lastContent.includes('bersih') || lastContent.includes('kas berjalan') || lastContent.includes('kas harian') || lastContent.includes('saldo berjalan')) {
        topic = 'saldo';
      } else if (lastContent.includes('pemasukan lain') || lastContent.includes('lain-lain')) {
        topic = 'pemasukan lain';
      } else if (lastContent.includes('pb1') || lastContent.includes('pajak')) {
        topic = 'pajak';
      }
    }
  }

  if (!topic) return null;

  // 1. Detect Month
  const monthMap = {
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

  let targetMonth = null;
  let targetMonthName = '';
  for (const [name, num] of Object.entries(monthMap)) {
    if (msg.includes(name)) {
      targetMonth = num;
      targetMonthName = name.charAt(0).toUpperCase() + name.slice(1);
      break;
    }
  }

  const now = new Date();
  let year = now.getFullYear();

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
    } else {
      // If the context suggests month-level follow-up but no specific month, fallback to June (last complete month)
      targetMonth = 6;
      targetMonthName = 'Juni';
    }
  }

  const monthStr = `${year}-${String(targetMonth).padStart(2, '0')}`;

  // Find summary for Kas Berjalan (is_umum = 1)
  const summary = monthlySummaries.find(s => s.month_str === monthStr && s.is_umum === 1);
  if (!summary) return null;

  const totalOmzet = summary.raw_omzet - summary.total_pb1;
  const omzetKotor = summary.raw_omzet;
  const pengeluaran = summary.pengeluaran;
  const pemasukanLain = summary.pemasukan - summary.raw_omzet - summary.pelunasan_piutang_lalu;
  const pemasukanBersih = summary.pemasukan - summary.total_pb1;
  const saldoNetto = pemasukanBersih - summary.pengeluaran;
  const pb1 = summary.total_pb1;
  const pb1Terbayar = summary.total_pb1_paid;
  const pb1Sisa = pb1 - pb1Terbayar;

  // 2. Detect Topic
  if (topic === 'omzet') {
    return `Total Omzet (Bersih) pada Kas Berjalan bulan ${targetMonthName} ${year} adalah ${formatIDR(totalOmzet)}.
Omzet Kotor (sebelum dikurangi Pajak PB1) adalah ${formatIDR(omzetKotor)} (Pajak PB1: ${formatIDR(pb1)}).`;
  }

  if (topic === 'pengeluaran') {
    return `Total Pengeluaran pada Kas Berjalan bulan ${targetMonthName} ${year} adalah ${formatIDR(pengeluaran)}.`;
  }

  if (topic === 'pemasukan lain') {
    return `Pemasukan Lain-Lain pada Kas Berjalan bulan ${targetMonthName} ${year} adalah ${formatIDR(pemasukanLain)}.`;
  }

  if (topic === 'pajak') {
    return `Pajak PB1 pada Kas Berjalan bulan ${targetMonthName} ${year} adalah ${formatIDR(pb1)} (Terbayar: ${formatIDR(pb1Terbayar)}, Sisa: ${formatIDR(pb1Sisa)}).`;
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
  
  const hasPiutangKeyword = ['piutang', 'hutang', 'utang'].some(kw => msg.includes(kw));
  if (!hasPiutangKeyword) return null;

  const isPiutangQuery = msg.includes('sisa') || msg.includes('total') || msg.includes('saldo') || msg.includes('berapa') || msg.includes('daftar') || msg.includes('list') || msg.includes('tampilkan') || msg.includes('siapa') || msg.split(/\s+/).length <= 3;
  if (!isPiutangQuery) return null;

  try {
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
      return 'Belum ada data mitra piutang yang terdaftar di cabang ini.';
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

    const wantsTotalOverall = msg.includes('total') || msg.includes('jumlah') || msg.includes('seluruh') || msg.includes('semua');

    if (wantsTotalOverall && !isSpecific) {
      const total = results.reduce((sum, r) => sum + (parseFloat(r.total_piutang) || 0), 0);
      return `Total keseluruhan piutang berjalan mitra di cabang ini saat ini adalah ${formatIDR(total)}.`;
    }

    if (isSpecific && filteredResults.length === 1) {
      const r = filteredResults[0];
      const piutangVal = parseFloat(r.total_piutang) || 0;
      return `Sisa piutang untuk mitra ${r.nama} saat ini adalah ${formatIDR(piutangVal)}.`;
    }

    const activePiutang = filteredResults.filter(r => (parseFloat(r.total_piutang) || 0) > 0);
    if (activePiutang.length === 0) {
      return isSpecific 
        ? `Mitra yang Anda cari tidak memiliki sisa piutang aktif.` 
        : `Tidak ada mitra yang memiliki sisa piutang aktif saat ini.`;
    }

    let reply = isSpecific 
      ? 'Berikut adalah rincian sisa piutang mitra yang Anda cari:\n\n'
      : 'Berikut adalah rincian sisa piutang berjalan untuk masing-masing mitra:\n\n';

    let sumTotal = 0;
    activePiutang.forEach(r => {
      const val = parseFloat(r.total_piutang) || 0;
      sumTotal += val;
      reply += `- ${r.nama}: ${formatIDR(val)}\n`;
    });

    if (activePiutang.length > 1 && !isSpecific) {
      reply += `\nTotal Keseluruhan Piutang: ${formatIDR(sumTotal)}`;
    }

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
