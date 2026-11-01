const { chatWithAI } = require('./aiController');
const { callOpenRouter } = require('./ai/aiClient');

const chatWithAssistant = async (req, res, next) => {
  try {
    req.setTimeout(180000); // 3 minutes timeout to allow slow CPU-based Gemma 4 inference
    const { message, chatHistory, branchName } = req.body;
    const branchId = req.branchId; // Enforced via getCurrentBranch middleware

    if (!message) {
      return res.status(400).json({
        success: false,
        message: 'Pesan wajib diisi'
      });
    }

    let ownerId = req.userId;
    if (req.user && req.user.role !== 'owner' && req.user.created_by) {
      ownerId = req.user.created_by;
    }

    const Subscription = require('../models/Subscription');
    const subscription = await Subscription.getActiveSubscription(ownerId);

    if (!subscription || subscription.billing_period !== 'yearly') {
      return res.status(200).json({
        success: true,
        reply: 'silahkan upgrade paket ya'
      });
    }

    // Set branchId on req.body so chatWithAI can extract it
    req.body.branchId = branchId;

    return await chatWithAI(req, res);

  } catch (error) {
    console.error('Error in integrated AI Service:', error);
    return res.status(500).json({
      success: false,
      message: 'Gagal memproses pesan dengan AI',
      error: error.message
    });
  }
};

const generateChartInsight = async (req, res) => {
  try {
    req.setTimeout(120000);
    const {
      branchName,
      periodLabel,
      cashScopeLabel,
      totalIncome = 0,
      totalExpense = 0,
      incomeCount = 0,
      expenseCount = 0,
      incomeCategories = [],
      expenseCategories = [],
      selectedCategoryDetail = null,
      customPrompt = ''
    } = req.body || {};

    const netCashflow = Number(totalIncome) - Number(totalExpense);
    const expenseRatio = Number(totalIncome) > 0
      ? ((Number(totalExpense) / Number(totalIncome)) * 100).toFixed(1)
      : (Number(totalExpense) > 0 ? '100+' : '0.0');

    const formatRp = (val) =>
      new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0 }).format(Number(val || 0));

    const incSummaryText = (incomeCategories || [])
      .slice(0, 8)
      .map((c, i) => {
        const subText = Array.isArray(c.subItems) && c.subItems.length > 0
          ? ` [Rincian: ${c.subItems.slice(0, 5).map(s => `${s.name}: ${formatRp(s.total)} (${s.percentage.toFixed(1)}%)`).join(', ')}]`
          : '';
        return `${i + 1}. ${c.name}: ${formatRp(c.total)} (${Number(c.percentage || 0).toFixed(1)}%, ${c.count} transaksi)${subText}`;
      })
      .join('\n');

    const expSummaryText = (expenseCategories || [])
      .slice(0, 10)
      .map((c, i) => {
        const subText = Array.isArray(c.subItems) && c.subItems.length > 0
          ? ` [Rincian item: ${c.subItems.slice(0, 5).map(s => `${s.name}: ${formatRp(s.total)} (${s.percentage.toFixed(1)}%)`).join(', ')}]`
          : '';
        return `${i + 1}. ${c.name}: ${formatRp(c.total)} (${Number(c.percentage || 0).toFixed(1)}%, ${c.count} transaksi)${subText}`;
      })
      .join('\n');

    const selectedCatText = selectedCategoryDetail
      ? `\nFOKUS KATEGORI YANG SEDANG DIPILIH USER:
Kategori: ${selectedCategoryDetail.name} (${selectedCategoryDetail.type === 'income' ? 'Pemasukan' : 'Pengeluaran'})
Total: ${formatRp(selectedCategoryDetail.total)} (${selectedCategoryDetail.count} transaksi)
Rincian di dalamnya:
${(selectedCategoryDetail.subItems || []).slice(0, 10).map((s, idx) => `- ${idx + 1}. ${s.name}: ${formatRp(s.total)} (${Number(s.percentage || 0).toFixed(1)}%, ${s.count}x)`).join('\n') || '- Belum ada sub-item rincian'}`
      : '';

    const systemPrompt = `Kamu adalah Analis Keuangan AI senior di aplikasi VerKas.
Tugasmu adalah memberikan insight keuangan yang tajam, jelas, mudah dipahami pemilik bisnis, dan berdasarkan angka nyata dari grafik yang ditampilkan.
Gunakan Bahasa Indonesia yang profesional namun santai, jelas, dan terstruktur dengan poin-poin singkat.
Jangan mengarang angka di luar data yang diberikan.

Struktur analisis (kecuali jika user mengajukan pertanyaan spesifik):
1. **Ringkasan Performa Kas**: Evaluasi singkat kondisi pemasukan vs pengeluaran, saldo bersih, dan rasio pengeluaran.
2. **Bedah Pemasukan**: Soroti sumber/kategori pemasukan utama dan kontribusinya.
3. **Bedah Pengeluaran & Rincian Kategori**: Soroti kategori pengeluaran terbesar beserta rincian item/produk di dalamnya yang paling menyerap biaya.
4. **Rekomendasi & Action Plan**: 2-3 saran praktis yang bisa langsung dilakukan pemilik/tim cabang.`;

    const userPrompt = `Berikut adalah data grafik keuangan cabang "${branchName || 'Cabang'}" pada periode "${periodLabel || 'Periode terpilih'}" (${cashScopeLabel || 'Kas Berjalan'}):

- Total Pemasukan: ${formatRp(totalIncome)} (${incomeCount} transaksi)
- Total Pengeluaran: ${formatRp(totalExpense)} (${expenseCount} transaksi)
- Selisih / Arus Kas Bersih: ${formatRp(netCashflow)} (${netCashflow >= 0 ? 'Surplus / Positif' : 'Defisit / Minus'})
- Rasio Pengeluaran terhadap Pemasukan: ${expenseRatio}%

KATEGORI PEMASUKAN TERATAS:
${incSummaryText || '- Belum ada data pemasukan'}

KATEGORI PENGELUARAN TERATAS (BESERTA RINCIAN KATEGORI):
${expSummaryText || '- Belum ada data pengeluaran'}
${selectedCatText}
${customPrompt ? `\nPERTANYAAN KHUSUS DARI PENGGUNA: "${customPrompt}"\nJawab pertanyaan khusus ini secara langsung dan mendalam berdasarkan data di atas!` : '\nBerikan insight lengkap dan tajam berdasarkan data grafik di atas.'}`;

    const aiReply = await callOpenRouter([
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ]);

    return res.status(200).json({
      success: true,
      reply: aiReply
    });
  } catch (error) {
    console.error('Error generating chart AI insight:', error);
    return res.status(500).json({
      success: false,
      message: 'Gagal menghasilkan insight AI dari server',
      error: error.message
    });
  }
};

module.exports = {
  chatWithAssistant,
  generateChartInsight
};
