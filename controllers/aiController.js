const path = require('path');
const { query } = require('../config/database');
const { DB_SCHEMA } = require('../config/dbSchema');
const Transaction = require('../models/Transaction');

// Import modular utilities
const { logResourceUsage, callOpenRouter } = require('./ai/aiClient');
const { formatIDR, formatIDRClean, formatDatesToLocal, getMonthRange, formatMonthIndo } = require('./ai/aiFormatter');
const { sanitizeAndSandboxSQL } = require('./ai/aiSqlSandbox');
const {
  isGeneralMonthlyQuery,
  tryResolveSubscriptionQueryDirectly,
  tryResolveExtremeTransactionQueryDirectly,
  tryResolveSavingsBalanceQueryDirectly,
  tryResolvePICQueryDirectly,
  tryResolveMonthlyQueryDirectly,
  tryResolvePiutangQueryDirectly
} = require('./ai/aiDirectResolver');

// Server-side active branch tracker to clear chat history on branch switch
const lastActiveBranch = new Map();

// Main controller handler
const chatWithAI = async (req, res) => {
  try {
    const { message, chatHistory, branchId, branchName } = req.body;
    logResourceUsage(`Request Start: "${message}"`);

    if (!message) {
      return res.status(400).json({
        success: false,
        message: 'Pesan wajib diisi'
      });
    }

    if (!branchId) {
      return res.status(400).json({
        success: false,
        message: 'branchId wajib disertakan'
      });
    }

    // Intercept casual greetings to prevent database querying/LLM hallucinations on simple hi/hello
    const cleanMsg = message.trim().toLowerCase().replace(/[.,\/#!$%\^&\*;:{}=\-_`~()?]/g, "");
    const casualGreetings = ['halo', 'hi', 'hello', 'hey', 'pagi', 'siang', 'sore', 'malam', 'tes', 'test', 'assalamualaikum', 'ping', 'oi'];
    if (casualGreetings.includes(cleanMsg)) {
      return res.status(200).json({
        success: true,
        reply: `Halo! Saya Asisten Keuangan Verkas untuk cabang ${branchName || 'Kas Berjalan'}. Ada yang bisa saya bantu menganalisis buku kas Anda hari ini?`
      });
    }

    // Programmatic filter for obvious out-of-domain queries
    const outOfDomainKeywords = [
      'presiden', 'menteri', 'resep', 'cuaca', 'bumi', 'matahari', 'planet', 'negara',
      'sejarah', 'belajar coding', 'membuat website', 'berita hari ini', 'gempa', 'politik'
    ];
    const isOutOfDomain = outOfDomainKeywords.some(kw => cleanMsg.includes(kw));
    if (isOutOfDomain) {
      return res.status(200).json({
        success: true,
        reply: `Maaf, sebagai Asisten Keuangan Verkas, saya hanya dapat membantu Anda menganalisis buku kas, transaksi keuangan, dan operasional aplikasi Verkas.`
      });
    }

    const now = new Date();
    const formattedToday = now.toLocaleDateString('id-ID', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
    const formattedTodayIso = now.toISOString().split('T')[0];

    const sqlGeneratorPrompt = `Kamu adalah pakar kueri database MySQL. Tugasmu adalah membuat satu kueri SQL SELECT (HANYA kueri SELECT) yang aman untuk mengambil data yang dibutuhkan untuk menjawab pertanyaan pengguna.

DEFINISI KONTEKS KEUANGAN APLIKASI:
- 'Kas Berjalan' (atau Kas Harian/Operasional/Umum) ditandai dengan \`is_umum = 1\`.
- 'Kas Simpanan' (atau Kas Tabungan/Cadangan/Pribadi) ditandai dengan \`is_umum = 0\`.
- 'Piutang' berkaitan dengan nominal pinjaman pelanggan yang harus ditagih, tercatat pada tabel \`mitra_piutang\` dan rinciannya di \`transaction_mitra_details\`.
- 'Total Omzet' (Pemasukan Utama): Transaksi bertipe 'income' yang memiliki kategori mengandung kata 'omzet' atau 'omset' (yaitu: \`c.name LIKE '%omzet%'\` atau \`c.name LIKE '%omset%'\`).
- 'Pemasukan Lain-Lain': Transaksi bertipe 'income' yang BUKAN merupakan Omzet (kategori tidak mengandung 'omzet'/'omset') DAN BUKAN pelunasan piutang (yaitu \`is_debt_payment = 0\` atau \`is_debt_payment IS NULL\`).
- 'Pemasukan' (Penerimaan/Pemasukan/Omset/Income) WAJIB menggunakan filter \`type = 'income'\`. 'Pengeluaran' (Belanja/Biaya/Pengeluaran/Expense) WAJIB menggunakan filter \`type = 'expense'\`. Saat mencari transaksi terbesar/terkecil/terbaru/detail dari pemasukan atau pengeluaran, kamu WAJIB menyertakan filter tipe ini agar data tidak tercampur.
- 'Total Saldo' (Saldo Bersih / Laba Bersih / Netto): Selisih antara total pemasukan dan total pengeluaran (yaitu menggunakan rumus: \`SUM(CASE WHEN type = 'income' THEN amount ELSE -amount END)\`).
- ATURAN DEFAULT: Jika pengguna bertanya tentang transaksi, pengeluaran, pemasukan, saldo, atau keuangan secara umum TANPA secara spesifik menyebutkan kata 'Simpanan' (atau variasi ejaan/misspelling/sinonimnya seperti 'simpanan', 'simpaan', 'tabungan', 'cadangan', 'pribadi'), maka asumsikan kueri mengarah ke **Kas Berjalan** (\`is_umum = 1\`). Namun jika pengguna secara spesifik menyebutkan kata 'Simpanan' (atau ejaan lainnya seperti 'simpaan', 'tabungan', 'cadangan'), kueri harus menggunakan filter atau logika untuk **Kas Simpanan** (\`is_umum = 0\`).
    
    INFORMASI WAKTU SEKARANG:
- Tanggal hari ini: ${formattedToday} (Format YYYY-MM-DD: ${formattedTodayIso})
- Tahun saat ini: ${now.getFullYear()}
- Gunakan tahun ${now.getFullYear()} untuk setiap pertanyaan berbasis bulan/waktu sekarang (misal: "bulan Juni ini" berarti Juni ${now.getFullYear()}).
- CATATAN PENTING DATA BULANAN: Hari ini adalah tanggal 1 Juli 2026, yang berarti bulan berjalan saat ini (Juli 2026) baru berjalan 1 hari dan belum memiliki data transaksi yang lengkap. Jika pengguna bertanya tentang laporan, pengeluaran terbesar, omzet, atau kategori keuangan TANPA menyebutkan nama bulan secara spesifik, kamu WAJIB memprioritaskan kueri untuk menyaring data pada periode Juni 2026 (yaitu: DATE(t.transaction_date) BETWEEN '2026-06-01' AND '2026-06-30') agar kueri menghasilkan data transaksi yang relevan.

Tabel dan Kolom yang tersedia (tabel ini sudah ter-filter otomatis per cabang):
${DB_SCHEMA}

Aturan Penting:
1. Hasilkan HANYA kueri SQL SELECT mentah yang valid. Jangan gunakan pembungkus markdown (seperti \`\`\`sql), jangan berikan teks penjelasan, jangan tambahkan karakter lain.
2. Kueri harus aman dan HANYA mengambil data relevan.
3. Gunakan filter \`branch_id\` jika diperlukan, tapi abaikan jika tabel di atas sudah ter-filter otomatis.
4. JANGAN gunakan subquery yang tidak didukung atau kolom fiktif.
5. Gunakan format tanggal yang benar.
6. Untuk mencari data laporan manual (seperti bagi hasil, stok awal/akhir, working_days), kueri tabel \`branch_reports\` dengan menyaring kolom \`month\` dan \`year\` yang sesuai.
7. ATURAN PENJUMLAHAN PAJAK PB1 RIIL (KARTU DASHBOARD PB1): PB1 yang terkumpul dihitung dari data transaksi pemasukan berjenis 'income' yang pembayarannya menggunakan metode pembayaran kena pajak (is_taxable = 1).
   Rumus PB1 Riil per Transaksi adalah: (Total Nilai Transaksi Bersih yang Kena Pajak) * 10 / 110.
   Contoh Kueri PB1 Riil Kas Berjalan Periode Juni 2026:
   SELECT ROUND(COALESCE(SUM(tid.amount_app), 0) * 10 / 110) as total_pb1
   FROM transaction_income_details tid
   JOIN transactions t ON tid.transaction_id = t.id
   JOIN payment_methods pm ON tid.payment_method_id = pm.id
   WHERE t.branch_id = 13 AND t.status_deleted = 0 AND pm.is_taxable = 1 AND DATE(t.transaction_date) BETWEEN '2026-06-01' AND '2026-06-30' AND t.is_umum = 1;
   Gunakan rumus ini jika pengguna bertanya tentang PB1 yang ditarik/terkumpul.
8. PENTING UNTUK PERTANYAAN LANJUTAN (FOLLOW-UP): Perhatikan riwayat obrolan (chat history) dengan sangat teliti. 
   - Jika user mengajukan pertanyaan lanjutan seperti "jumlahnya berapa", "nominalnya berapa", "siapa saja", dsb. yang merujuk pada topik/kategori/mitra yang dibahas sebelumnya (misalnya merujuk pada kategori "Operasional" yang baru saja diidentifikasi sebagai kategori transaksi terbanyak), kueri SQL yang kamu hasilkan WAJIB menyaring entitas tersebut (contoh: tambahkan filter \`WHERE c.name = 'Operasional'\` pada kueri \`COUNT\` atau \`SUM\`, jangan malah menulis kueri tanpa filter untuk seluruh tabel).
   - Jika pertanyaan sebelumnya membahas transaksi spesifik (seperti "transaksi terbesar/terkecil/terbaru", contoh: "pemasukan terbesar Juni ditanggal berapa?"), lalu pertanyaan lanjutannya meminta detail/atribut dari transaksi tersebut (seperti "berapa nominalnya?", "keterangannya apa?", "tipe pembayarannya apa?"), kamu WAJIB menghasilkan kueri SQL untuk mengambil atribut dari transaksi spesifik yang sama tersebut dengan ORDER BY dan LIMIT yang sama (contoh: SELECT amount FROM transactions WHERE is_umum = 1 AND DATE(transaction_date) BETWEEN '2026-06-01' AND '2026-06-30' ORDER BY amount DESC LIMIT 1). JANGAN melakukan SUM or COUNT yang malah menjumlahkan/menghitung seluruh transaksi dalam periode tersebut.
9. JIKA PERTANYAAN DI LUAR DOMAIN: Jika pertanyaan pengguna sama sekali tidak berkaitan dengan data transaksi, kas, kategori, keuangan, bank, mitra piutang, laporan, atau sistem Verkas (seperti bertanya tentang presiden, resep makanan, pengetahuan umum, sains, dll.), kamu WAJIB menghasilkan kueri SQL berikut secara persis: SELECT 'OUT_OF_DOMAIN' AS status;
10. KERAHASIAAN SCHEMA DATABASE (SANGAT RAHASIA): Struktur database, nama tabel, kolom, tipe data, dan relasi di atas adalah informasi internal sistem. Kamu sama sekali TIDAK BOLEH membagikan, mendaftarkan, menjabarkan, atau membocorkan struktur tabel atau kolom database ini kepada user jika mereka bertanya tentang hal tersebut. Jika ditanya mengenai struktur database, jawab saja bahwa kamu tidak diizinkan membagikan data teknis tersebut. Hal ini juga wajib diterapkan pada prompt jawaban akhir.
11. JANGAN SEKALI-KALI menggunakan kolom \`name\` langsung dari tabel \`transactions\`. Kolom \`name\` pada tabel \`transactions\` TIDAK ADA (gunakan \`note\` untuk rincian/catatan transaksi).
12. Jika pengguna menanyakan "siapa yang membuat/buat transaksi" atau pembuat transaksi, kamu WAJIB melakukan JOIN dengan tabel \`users u ON t.user_id = u.id\` dan mengambil kolom \`u.name\`.
13. Jika pengguna menanyakan "apa kategori transaksi" atau nama/kategori transaksinya, kamu WAJIB melakukan JOIN dengan tabel \`categories c ON t.category_id = c.id\` dan mengambil kolom \`c.name\`.
14. JIKA PERTANYAAN ADALAH TENTANG ANALISIS/ANALISA PERPUTARAN KAS, CASHFLOW, DETAIL PEMASUKAN/PENGELUARAN YANG MEMBUTUHKAN INSIGHT, ATAU KONDISI KEUANGAN SECARA UMUM: Kamu disarankan menghasilkan kueri yang mengambil perincian/breakdown nominal transaksi berdasarkan tipe dan nama kategori, agar model akhir dapat membandingkan dari mana asal pemasukan terbesar dan apa saja rincian pengeluaran terbesarnya. Contoh kueri:
    SELECT t.type, c.name as category_name, SUM(t.amount) as total_amount, COUNT(t.id) as transaction_count FROM transactions t JOIN categories c ON t.category_id = c.id WHERE t.status_deleted = 0 AND DATE(t.transaction_date) BETWEEN '2026-06-01' AND '2026-06-30' AND t.is_umum = 1 GROUP BY t.type, c.id, c.name ORDER BY total_amount DESC
15. ALIAS DAN KONTEKS KUERI DINAMIS (PENTING): Setiap kali kamu menghasilkan kueri SQL yang melakukan agregasi (seperti SUM, COUNT, MAX, MIN), kamu WAJIB menyertakan kolom konteks seperti tipe transaksi (\`type\`), nama kategori (\`c.name\`), atau bulan transaksi (\`MONTH(transaction_date) as bulan\`) di bagian SELECT dan GROUP BY, serta memberikan alias yang sangat jelas pada hasil agregasi tersebut (misal: \`total_pengeluaran\`, \`total_pemasukan\`). JANGAN PERNAH menghasilkan kolom agregasi tunggal tanpa label konteks (seperti HANYA \`SELECT SUM(amount) FROM...\`) karena hal itu membuat model akhir bingung mengenali tipe data dan periode dari angka tersebut.
16. DIALECT MYSQL/MARIADB (PENTING): Database yang digunakan adalah MySQL / MariaDB. Kamu DILARANG KERAS menggunakan fungsi-fungsi dari PostgreSQL atau DBMS lain (seperti DATE_PART, DATE_TRUNC, AGE, dll.). Gunakan fungsi bawaan MySQL yang valid seperti MONTH(transaction_date), YEAR(transaction_date), DATE_FORMAT(transaction_date, '%m'), EXTRACT(MONTH FROM transaction_date), dll.

Contoh Kueri SQL yang benar:
- Mencari total pengeluaran Kas Berjalan pada periode tertentu:
  SELECT SUM(amount) FROM transactions WHERE type = 'expense' AND is_umum = 1 AND DATE(transaction_date) BETWEEN '2026-06-01' AND '2026-06-30'

- Mencari total saldo (saldo bersih / netto) Kas Berjalan pada periode tertentu:
  SELECT SUM(CASE WHEN type = 'income' THEN amount ELSE -amount END) FROM transactions WHERE is_umum = 1 AND DATE(transaction_date) BETWEEN '2026-06-01' AND '2026-06-30'

- Mencari total pemasukan lain-lain Kas Berjalan pada periode tertentu (bukan omzet dan bukan pelunasan piutang):
  SELECT SUM(t.amount) FROM transactions t JOIN categories c ON t.category_id = c.id WHERE t.type = 'income' AND t.is_umum = 1 AND (c.name NOT LIKE '%omzet%' AND c.name NOT LIKE '%omset%') AND (t.is_debt_payment = 0 OR t.is_debt_payment IS NULL) AND DATE(t.transaction_date) BETWEEN '2026-06-01' AND '2026-06-30'

- Mencari total pemasukan Kas Simpanan pada periode tertentu:
  SELECT SUM(amount) FROM transactions WHERE type = 'income' AND is_umum = 0 AND DATE(transaction_date) BETWEEN '2026-06-01' AND '2026-06-30'

- Mencari pemasukan terbesar Kas Berjalan bulan Juni:
  SELECT amount, note, transaction_date FROM transactions WHERE type = 'income' AND is_umum = 1 AND DATE(transaction_date) BETWEEN '2026-06-01' AND '2026-06-30' ORDER BY amount DESC LIMIT 1

- Mencari detail pemasukan terbesar Kas Berjalan bulan Juni beserta nama pembuat dan nama kategorinya:
  SELECT t.amount, t.note, t.transaction_date, u.name as creator_name, c.name as category_name FROM transactions t LEFT JOIN users u ON t.user_id = u.id LEFT JOIN categories c ON t.category_id = c.id WHERE t.type = 'income' AND t.is_umum = 1 AND DATE(t.transaction_date) BETWEEN '2026-06-01' AND '2026-06-30' ORDER BY t.amount DESC LIMIT 1

- Mencari pengeluaran terbesar Kas Berjalan bulan Juni:
  SELECT amount, note, transaction_date FROM transactions WHERE type = 'expense' AND is_umum = 1 AND DATE(transaction_date) BETWEEN '2026-06-01' AND '2026-06-30' ORDER BY amount DESC LIMIT 1

- Mencari sisa piutang aktif/berjalan mitra tertentu (menjumlahkan seluruh sisa hutang transaksi mitra tersebut):
  SELECT mp.nama, (SELECT COALESCE(SUM(t.remaining_debt), 0) FROM transactions t WHERE t.mitra_piutang_id = mp.id AND t.status_deleted = 0 AND NOT EXISTS (SELECT 1 FROM transaction_mitra_details WHERE transaction_id = t.id)) + (SELECT COALESCE(SUM(tmd.remaining_debt), 0) FROM transaction_mitra_details tmd JOIN transactions t ON tmd.transaction_id = t.id WHERE tmd.mitra_piutang_id = mp.id AND t.status_deleted = 0) as total_piutang FROM mitra_piutang mp WHERE mp.nama = 'Mitra A' AND mp.deleted_at IS NULL

- Mencari sisa piutang aktif/berjalan untuk setiap/semua mitra (akumulasi sisa piutang seluruh mitra):
  SELECT mp.nama, (SELECT COALESCE(SUM(t.remaining_debt), 0) FROM transactions t WHERE t.mitra_piutang_id = mp.id AND t.status_deleted = 0 AND NOT EXISTS (SELECT 1 FROM transaction_mitra_details WHERE transaction_id = t.id)) + (SELECT COALESCE(SUM(tmd.remaining_debt), 0) FROM transaction_mitra_details tmd JOIN transactions t ON tmd.transaction_id = t.id WHERE tmd.mitra_piutang_id = mp.id AND t.status_deleted = 0) as total_piutang FROM mitra_piutang mp WHERE mp.deleted_at IS NULL ORDER BY total_piutang DESC

- Mencari total keseluruhan piutang berjalan/aktif toko (jumlah sisa piutang seluruh mitra):
  SELECT SUM(total_piutang) as total_piutang_berjalan FROM (SELECT (SELECT COALESCE(SUM(t.remaining_debt), 0) FROM transactions t WHERE t.mitra_piutang_id = mp.id AND t.status_deleted = 0 AND NOT EXISTS (SELECT 1 FROM transaction_mitra_details WHERE transaction_id = t.id)) + (SELECT COALESCE(SUM(tmd.remaining_debt), 0) FROM transaction_mitra_details tmd JOIN transactions t ON tmd.transaction_id = t.id WHERE tmd.mitra_piutang_id = mp.id AND t.status_deleted = 0) as total_piutang FROM mitra_piutang mp WHERE mp.deleted_at IS NULL) as sub

- Mencari total pelunasan piutang (Repayments) yang masuk dari seluruh/semua mitra:
  SELECT SUM(amount) as total_pelunasan FROM transaction_repayments

- Mencari riwayat pelunasan piutang mitra beserta tanggal pembayarannya:
  SELECT tr.amount, tr.payment_date, tr.note, mp.nama as mitra_nama FROM transaction_repayments tr JOIN mitra_piutang mp ON tr.mitra_piutang_id = mp.id ORDER BY tr.id DESC

- Mencari daftar kategori transaksi beserta induknya:
  SELECT c.name, p.name as parent_name FROM categories c LEFT JOIN categories p ON c.parent_id = p.id
  
- Mencari total pemasukan dan pengeluaran dari suatu kategori/kategori induk (misal Bahan Baku) pada periode tertentu:
  SELECT SUM(CASE WHEN t.type = 'income' THEN t.amount ELSE 0 END) as total_pemasukan, SUM(CASE WHEN t.type = 'expense' THEN t.amount ELSE 0 END) as total_pengeluaran FROM transactions t JOIN categories c ON t.category_id = c.id WHERE (c.name = 'Bahan Baku' OR c.parent_id = (SELECT id FROM categories WHERE name = 'Bahan Baku' LIMIT 1)) AND DATE(t.transaction_date) BETWEEN '2026-06-01' AND '2026-06-30' AND t.is_umum = 1
  
- Mencari daftar metode pembayaran / sumber transaksi beserta induknya:
  SELECT pm.name, parent.name as parent_name FROM payment_methods pm LEFT JOIN payment_methods parent ON pm.parent_id = parent.id
  
- Mencari data laporan manual (stok, bagi hasil, hari kerja) pada periode tertentu:
  SELECT stok_awal, stok_akhir, working_days, bagi_hasil, sales_channels, expense_adjustments FROM branch_reports WHERE month = 6 AND year = 2026
  
- Mencari saldo masing-masing/setiap kas simpanan:
  SELECT cat.name, SUM(CASE WHEN t.type = 'income' OR (t.is_umum = 1 AND t.type = 'expense') THEN amount_val ELSE -amount_val END) as saldo FROM (SELECT id, type, is_umum, amount as amount_val, category_id, transaction_date FROM transactions WHERE status_deleted = 0 UNION ALL SELECT t.id, t.type, t.is_umum, tsd.amount as amount_val, tsd.category_id, t.transaction_date FROM transaction_savings_details tsd JOIN transactions t ON tsd.transaction_id = t.id WHERE t.status_deleted = 0) as t JOIN categories cat ON t.category_id = cat.id WHERE cat.parent_id IS NOT NULL AND (cat.name LIKE '%Simpanan%' OR cat.name = 'Packaging') GROUP BY cat.id, cat.name`;

    console.log(`[AI-Service] Generating SQL query for user prompt: "${message}"`);

    let aiSqlResponse = 'SELECT 1';
    const isGeneral = isGeneralMonthlyQuery(message, chatHistory);
    if (isGeneral) {
      console.log(`[AI-Service] Bypassing SQL generator (general monthly report query matched): "${message}"`);
    } else {
      try {
        process.stdout.write('[AI-Service] Generating SQL: ');

        // Build payload for OpenRouter
        const openRouterMessages = [
          { role: 'system', content: sqlGeneratorPrompt }
        ];

        // Append chat history to context so it supports conversational follow-ups
        if (chatHistory && Array.isArray(chatHistory)) {
          chatHistory.forEach(h => {
            openRouterMessages.push({ role: h.role, content: h.content });
          });
        }

        openRouterMessages.push({
          role: 'user',
          content: `Pertanyaan User: "${message}"\n\nHasilkan kueri SQL SELECT mentah saja tanpa markdown atau penjelasan:`
        });

        const response = await callOpenRouter(openRouterMessages);
        process.stdout.write(response);
        console.log(); // Add newline after response prints

        // Robust extraction of SQL query to handle chatty models (like Gemma)
        const markdownMatch = response.match(/```sql([\s\S]*?)```/i);
        if (markdownMatch) {
          aiSqlResponse = markdownMatch[1].trim();
        } else {
          const sqlMatch = response.match(/\bSELECT\b[\s\S]+/i);
          if (sqlMatch) {
            aiSqlResponse = sqlMatch[0].replace(/```/g, '').trim();
          } else {
            aiSqlResponse = response.replace(/```sql/gi, '').replace(/```/g, '').trim();
          }
        }
        console.log(`[AI-Service] Raw SQL generated: ${aiSqlResponse}`);
      } catch (err) {
        console.error('[AI-Service] Failed to generate SQL via OpenRouter:', err);
      }
    }

    // Execute sandboxed SQL
    let queryResult = null;
    let generatedSql = aiSqlResponse;
    if (generatedSql && generatedSql.toUpperCase() !== 'SELECT 1') {
      let sandboxedSql = '';
      try {
        sandboxedSql = sanitizeAndSandboxSQL(generatedSql, branchId);
        console.log(`[AI-Service] Executing Sandboxed SQL: ${sandboxedSql}`);
        queryResult = await query(sandboxedSql);
      } catch (err) {
        console.error('[AI-Service] SQL Execution Error:', err);
        queryResult = { error: 'Kueri SQL tidak dapat dijalankan secara aman.' };
      }

      // Direct intercept for out-of-domain query
      if (queryResult && Array.isArray(queryResult) && queryResult[0] && queryResult[0].status === 'OUT_OF_DOMAIN') {
        console.log(`[AI-Service] SQL Generator detected OUT_OF_DOMAIN query: "${message}"`);
        return res.status(200).json({
          success: true,
          reply: `Maaf, sebagai Asisten Keuangan Verkas, saya hanya dapat membantu Anda menganalisis buku kas, transaksi keuangan, dan operasional aplikasi Verkas.`
        });
      }
      try {
        const fs = require('fs');
        fs.appendFileSync(path.join(__dirname, 'sql_debug.log'),
          `\n[${new Date().toISOString()}] USER PROMPT: "${message}"\nGENERATED SQL: ${generatedSql}\nSANDBOXED SQL: ${sandboxedSql}\nQUERY RESULT: ${JSON.stringify(queryResult)}\n`
        );
      } catch (logErr) {
        console.error('Failed to write debug log:', logErr);
      }
    }

    // Fetch user access branches, counts, and subscription info directly from the database based on branchId
    let accessibleBranches = [];
    let totalBranchesCount = 0;
    let activeSubscription = null;
    let subscriptionPlans = [];
    try {
      // Fetch all active subscription plans (packages) - globally available
      subscriptionPlans = await query(`
        SELECT name, description, max_branches, max_admin, price_monthly, price_yearly, features
        FROM subscription_plans
        WHERE is_active = true
        ORDER BY price_monthly ASC
      `).catch(() => []);

      const [currentBranch] = await query('SELECT owner_id FROM branches WHERE id = ? AND status_deleted = false', [branchId]);
      if (currentBranch && currentBranch.owner_id) {
        const ownerId = currentBranch.owner_id;

        // Fetch unique accessible branches (owner + team member branches)
        accessibleBranches = await query(`
          SELECT DISTINCT id, name FROM (
            SELECT id, name FROM branches WHERE owner_id = ? AND status_deleted = false
            UNION
            SELECT b.id, b.name 
            FROM branches b
            JOIN owner_teams t ON b.team_id = t.id
            JOIN owner_team_members tm ON t.id = tm.team_id
            WHERE tm.user_id = ? AND tm.status = 'active' AND b.status_deleted = false
          ) as unique_branches
          ORDER BY name ASC
        `, [ownerId, ownerId]);

        // Fetch total branches count
        const [individualRes] = await query('SELECT COUNT(*) as count FROM branches WHERE owner_id = ? AND status_deleted = false', [ownerId]);
        const [teamRes] = await query(`
          SELECT COUNT(*) as count FROM branches 
          WHERE team_id IN (
            SELECT team_id FROM owner_team_members WHERE user_id = ? AND status = 'active'
          ) AND status_deleted = false
        `, [ownerId]);

        const individualCount = individualRes?.count || 0;
        const teamCount = teamRes?.count || 0;
        totalBranchesCount = individualCount + teamCount;

        // Fetch active subscription for the owner
        const [subRes] = await query(`
          SELECT s.status, s.start_date, s.end_date, 
                 p.name as plan_name, p.max_branches, p.max_admin, p.price_monthly, p.price_yearly
          FROM subscriptions s
          JOIN subscription_plans p ON s.plan_id = p.id
          WHERE s.user_id = ? AND s.status = 'active'
          ORDER BY s.created_at DESC
          LIMIT 1
        `, [ownerId]);
        if (subRes) {
          activeSubscription = subRes;
        }

        console.log(`[AI-Service] Branches queried. Unique count: ${accessibleBranches.length}, Double-counted total (matches UI): ${totalBranchesCount}`);
        console.log(`[AI-Service] Subscription found: ${activeSubscription ? activeSubscription.plan_name : 'None'}, Active packages: ${subscriptionPlans.length}`);
      }
    } catch (dbErr) {
      console.error('[AI-Service] Failed to query branches/subscription context:', dbErr);
    }

    // Direct resolver for Verkas developer
    const cleanMsgDev = message.trim().toLowerCase().replace(/\s+/g, '');
    const isDevQuery = ['develop', 'pembuat', 'bikin', 'create', 'developer', 'creator'].some(kw => cleanMsgDev.includes(kw)) &&
      ['verkas', 'aplikasi', 'system', 'saas', 'bot'].some(kw => cleanMsgDev.includes(kw));
    if (isDevQuery) {
      return res.status(200).json({
        success: true,
        reply: `Verkas mah dibuat sama Vega Anggara Saputra, developer paling kece badai se-Indonesia! 😎`
      });
    }

    // Intercept casual thank you (strictly match whole words or exact terms)
    const words = cleanMsg.split(/\s+/);
    const thanksKeywords = ['terima kasih', 'terimakasih', 'makasih', 'suwun', 'thanks', 'thank you', 'nuhun', 'thankyou', 'thank', 'makasi'];
    const isStrictThanks = thanksKeywords.some(kw => cleanMsg.includes(kw)) || words.some(w => ['ok', 'oke', 'sip', 'siap'].includes(w));
    if (isStrictThanks) {
      return res.status(200).json({
        success: true,
        reply: `Sama-sama! Senang bisa membantu Anda. Jika ada hal lain seputar buku kas atau data transaksi yang ingin dianalisis, silakan tanyakan saja ya!`
      });
    }

    // Intercept ambiguous/vague queries that need clarification
    const msg = message.toLowerCase();
    const isAmbiguousAnalysis = 
      // Must contain analysis words or specific cash flow/turnover topics
      ((['analisa', 'analisis', 'perkembangan', 'laporan'].some(w => msg.includes(w)) || 
        (['perputaran', 'aliran', 'arus', 'cashflow', 'turnover'].some(w => msg.includes(w)) && msg.includes('kas'))) && 
       // Must NOT contain period keywords
       !['juni', 'juli', 'mei', 'april', 'bulan ini', 'bulan lalu', 'kemarin', 'semua', 'tahunan', 'mingguan', 'harian', 'simpanan', 'simpaan', 'tabungan', 'cadangan', 'terakhir', 'lalu', 'sebelumnya', 'bulan', 'minggu', 'tahun', 'periode'].some(m => msg.includes(m)) &&
       // Must NOT contain PIC/admin/user keywords
       !['admin', 'pic', 'tim', 'siapa', 'orang', 'staff', 'staf', 'owner', 'user', 'pembuat', 'buat'].some(w => msg.includes(w)));
      
    if (isAmbiguousAnalysis) {
      console.log(`[AI-Service] Intercepted vague query for clarification: "${message}"`);
      return res.status(200).json({
        success: true,
        reply: `Saya bisa membantu Anda menganalisis kas atau laporan keuangan toko. Untuk memastikan analisisnya tepat dan sesuai kebutuhan Anda, periode mana yang ingin Anda bedah?\n\n- Juni 2026 (Bulan Lalu - Data Lengkap)\n- Juli 2026 (Bulan Ini - Sedang Berjalan)\n- Perbandingan tren antara Juni vs Juli 2026`
      });
    }

    // Direct resolver for Verkas packages / subscriptions
    const subResolution = tryResolveSubscriptionQueryDirectly(message, subscriptionPlans, activeSubscription);
    if (subResolution) {
      console.log(`[AI-Service] Resolved subscription query directly: "${message}"`);
      const finalReply = subResolution;
      return res.status(200).json({
        success: true,
        reply: finalReply
      });
    }

    // Direct resolver for savings account balances
    const savingsResolution = await tryResolveSavingsBalanceQueryDirectly(message, branchId, chatHistory);
    if (savingsResolution) {
      console.log(`[AI-Service] Resolved savings balance query directly: "${message}"`);
      return res.status(200).json({
        success: true,
        reply: savingsResolution
      });
    }

    // Direct resolver for extreme transactions (largest/smallest)
    const extremeTxResolution = await tryResolveExtremeTransactionQueryDirectly(message, branchId);
    if (extremeTxResolution) {
      console.log(`[AI-Service] Resolved extreme transaction query directly: "${message}"`);
      return res.status(200).json({
        success: true,
        reply: extremeTxResolution
      });
    }

    // Direct resolver for partner piutang balances
    const piutangResolution = await tryResolvePiutangQueryDirectly(message, branchId, chatHistory);
    if (piutangResolution) {
      console.log(`[AI-Service] Resolved piutang query directly: "${message}"`);
      return res.status(200).json({
        success: true,
        reply: piutangResolution
      });
    }

    // Gather baseline summaries
    const monthlySummaries = [];
    for (let i = 0; i < 4; i++) {
      const d = new Date();
      d.setDate(1);
      d.setMonth(now.getMonth() - i);
      const year = d.getFullYear();
      const month = d.getMonth() + 1;
      const monthRange = getMonthRange(year, month);
      const startOfMonth = `${monthRange.start} 00:00:00`;

      const rawOmzetQuery = `
        SELECT COALESCE(SUM(
          CASE 
            WHEN (t.is_debt_payment = 1 OR t.is_debt_payment = true) THEN COALESCE(t.paid_amount, 0)
            ELSE t.amount 
          END
        ), 0) as raw_omzet
        FROM transactions t
        LEFT JOIN categories c ON t.category_id = c.id
        WHERE t.branch_id = ? 
          AND t.status_deleted = 0 
          AND DATE(t.transaction_date) BETWEEN ? AND ? 
          AND t.is_umum = ?
          AND t.type = 'income'
          AND (c.name LIKE '%omzet%' OR c.name LIKE '%omset%')
          AND c.name NOT LIKE '%lain-lain%'
      `;

      const pelunasanQuery = `
        SELECT COALESCE(SUM(t.amount), 0) as pelunasan_piutang_lalu
        FROM transactions t
        JOIN transaction_repayments tr ON t.id = tr.income_transaction_id
        JOIN transactions t_parent ON tr.transaction_id = t_parent.id
        WHERE t.branch_id = ? 
          AND t.status_deleted = 0 
          AND DATE(t.transaction_date) BETWEEN ? AND ? 
          AND t.is_umum = ?
          AND t.type = 'income'
          AND DATE(t_parent.transaction_date) < ?
      `;

      // 1. Fetch Kas Simpanan (is_umum = 0)
      const summarySimpanan = await Transaction.getSummary({
        branchId,
        startDate: monthRange.start,
        endDate: monthRange.end,
        isUmum: false
      }).catch((err) => {
        console.error('[AI-Service] Transaction.getSummary (is_umum = 0) failed:', err);
        return { pemasukan: 0, pelunasan_piutang_lalu: 0, pengeluaran: 0, total_pb1: 0, total_pb1_paid: 0, saldo: 0, saldo_pb1: 0 };
      });

      const [pelunasanSimpananRes] = await query(pelunasanQuery, [
        branchId, monthRange.start, monthRange.end, 0, startOfMonth
      ]).catch(() => [{ pelunasan_piutang_lalu: 0 }]);

      const [countSimpanan] = await query(
        `SELECT COUNT(*) as count FROM transactions WHERE branch_id = ? AND DATE(transaction_date) BETWEEN ? AND ? AND is_umum = 0 AND status_deleted = 0`,
        [branchId, monthRange.start, monthRange.end]
      ).catch(() => [{ count: 0 }]);

      const [omzetSimpananRes] = await query(rawOmzetQuery, [branchId, monthRange.start, monthRange.end, 0]).catch(() => [{ raw_omzet: 0 }]);

      // 2. Fetch Kas Berjalan (is_umum = 1)
      const summaryBerjalan = await Transaction.getSummary({
        branchId,
        startDate: monthRange.start,
        endDate: monthRange.end,
        isUmum: true
      }).catch((err) => {
        console.error('[AI-Service] Transaction.getSummary (is_umum = 1) failed:', err);
        return { pemasukan: 0, pelunasan_piutang_lalu: 0, pengeluaran: 0, total_pb1: 0, total_pb1_paid: 0, saldo: 0, saldo_pb1: 0 };
      });

      // Log query results to sql_debug.log
      const fs = require('fs');
      fs.appendFileSync(path.join(__dirname, 'sql_debug.log'),
        `\n[DEBUG QUERY RESULTS] Month: ${year}-${month}\n` +
        `  - summaryBerjalan: ${JSON.stringify(summaryBerjalan)}\n` +
        `  - summarySimpanan: ${JSON.stringify(summarySimpanan)}\n`
      );

      const [pelunasanBerjalanRes] = await query(pelunasanQuery, [
        branchId, monthRange.start, monthRange.end, 1, startOfMonth
      ]).catch(() => [{ pelunasan_piutang_lalu: 0 }]);

      const [countBerjalan] = await query(
        `SELECT COUNT(*) as count FROM transactions WHERE branch_id = ? AND DATE(transaction_date) BETWEEN ? AND ? AND is_umum = 1 AND status_deleted = 0`,
        [branchId, monthRange.start, monthRange.end]
      ).catch(() => [{ count: 0 }]);

      const [omzetBerjalanRes] = await query(rawOmzetQuery, [branchId, monthRange.start, monthRange.end, 1]).catch(() => [{ raw_omzet: 0 }]);

      monthlySummaries.push({
        month_str: `${year}-${String(month).padStart(2, '0')}`,
        is_umum: 1,
        pemasukan: summaryBerjalan?.pemasukan || 0,
        pelunasan_piutang_lalu: summaryBerjalan?.pelunasan_piutang_lalu || 0,
        pengeluaran: summaryBerjalan?.pengeluaran || 0,
        total_pb1: summaryBerjalan?.total_pb1 || 0,
        total_pb1_paid: summaryBerjalan?.total_pb1_paid || 0,
        raw_omzet: omzetBerjalanRes?.raw_omzet || 0,
        total_transactions: countBerjalan?.count || 0
      });

      monthlySummaries.push({
        month_str: `${year}-${String(month).padStart(2, '0')}`,
        is_umum: 0,
        pemasukan: summarySimpanan?.pemasukan || 0,
        pelunasan_piutang_lalu: summarySimpanan?.pelunasan_piutang_lalu || 0,
        pengeluaran: summarySimpanan?.pengeluaran || 0,
        total_pb1: summarySimpanan?.total_pb1 || 0,
        total_pb1_paid: summarySimpanan?.total_pb1_paid || 0,
        raw_omzet: omzetSimpananRes?.raw_omzet || 0,
        total_transactions: countSimpanan?.count || 0
      });
    }

    // Fetch Mitra Receivables
    const mitraSummary = await query(
      `SELECT mp.nama as name,
              (
                SELECT COALESCE(SUM(t.amount), 0)
                FROM transactions t
                WHERE t.mitra_piutang_id = mp.id AND t.status_deleted = 0
                AND NOT EXISTS (SELECT 1 FROM transaction_mitra_details WHERE transaction_id = t.id)
              ) + (
                SELECT COALESCE(SUM(tmd.amount), 0)
                FROM transaction_mitra_details tmd
                JOIN transactions t ON tmd.transaction_id = t.id
                WHERE tmd.mitra_piutang_id = mp.id AND t.status_deleted = 0
              ) as total_piutang,
              (
                SELECT COALESCE(SUM(t.paid_amount), 0)
                FROM transactions t
                WHERE t.mitra_piutang_id = mp.id AND t.status_deleted = 0
                AND NOT EXISTS (SELECT 1 FROM transaction_mitra_details WHERE transaction_id = t.id)
              ) + (
                SELECT COALESCE(SUM(tmd.paid_amount), 0)
                FROM transaction_mitra_details tmd
                JOIN transactions t ON tmd.transaction_id = t.id
                WHERE tmd.mitra_piutang_id = mp.id AND t.status_deleted = 0
              ) as total_terbayar,
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
              ) as sisa_piutang
       FROM mitra_piutang mp
       WHERE mp.branch_id = ? AND mp.deleted_at IS NULL`,
      [branchId]
    ).catch(() => []);

    // Fetch PIC (Team Members - Owner/Co-owners)
    const teamMembers = await query(
      `SELECT u.name, u.email, tm.role
       FROM owner_team_members tm
       JOIN users u ON tm.user_id = u.id
       JOIN branches b ON tm.team_id = b.team_id
       WHERE b.id = ? AND tm.status = 'active'
       ORDER BY tm.role DESC`,
      [branchId]
    ).catch(() => []);

    // Fetch assigned branch PICs (from branch_pics relation shown in UI)
    const branchPics = await query(
      `SELECT u.name, u.email
       FROM branch_pics bp
       JOIN users u ON bp.user_id = u.id
       WHERE bp.branch_id = ? AND u.status_deleted = 0
       ORDER BY u.name ASC`,
      [branchId]
    ).catch(() => []);

    // Direct resolver for PIC / Team Members / Admins of the branch
    const picResolution = tryResolvePICQueryDirectly(message, branchPics, teamMembers, branchName);
    if (picResolution) {
      console.log(`[AI-Service] Resolved PIC/team query directly: "${message}"`);
      return res.status(200).json({
        success: true,
        reply: picResolution
      });
    }

    // Try to resolve general monthly queries directly in JavaScript for 100% precision and zero latency
    const directResolution = tryResolveMonthlyQueryDirectly(message, monthlySummaries, branchName, chatHistory);
    if (directResolution) {
      console.log(`[AI-Service] Resolved query directly via JS helper: "${message}"`);
      const finalReply = directResolution;
      return res.status(200).json({
        success: true,
        reply: finalReply
      });
    }

    // Sanitize chat history to avoid branch switching context poisoning
    let sanitizedChatHistory = chatHistory;

    // Limit chat history to only the last 4 messages to prevent context poisoning/leaks from old conversations
    if (sanitizedChatHistory && Array.isArray(sanitizedChatHistory) && sanitizedChatHistory.length > 4) {
      console.log(`[AI-Service] Limiting chat history from ${sanitizedChatHistory.length} to last 4 messages to prevent context drift.`);
      sanitizedChatHistory = sanitizedChatHistory.slice(-4);
    }

    // Check using global state map (Map-based branch switch detection)
    const userId = req.userId || (req.user && req.user.id) || 'default_user';
    const prevBranchId = lastActiveBranch.get(userId);
    if (prevBranchId && String(prevBranchId) !== String(branchId)) {
      console.log(`[AI-Service] Detected branch switch via session Map (from ${prevBranchId} to ${branchId}). Clearing history.`);
      sanitizedChatHistory = [];
    }
    lastActiveBranch.set(userId, branchId);

    // Backup check 1: Clean history if assistant messages do not contain the current branch name (to purge old poisoned Condet messages)
    if (sanitizedChatHistory && sanitizedChatHistory.length > 0) {
      const hasAssistantMsgWithoutBranch = sanitizedChatHistory.some(h => {
        if (h.role === 'assistant') {
          return !h.content.toLowerCase().includes(branchName.toLowerCase());
        }
        return false;
      });

      if (hasAssistantMsgWithoutBranch) {
        console.log(`[AI-Service] Detected assistant messages in history missing branch prefix. Purging history.`);
        sanitizedChatHistory = [];
      }
    }

    // Backup check 2: Check using other branch name keywords in history
    if (sanitizedChatHistory && sanitizedChatHistory.length > 0 && accessibleBranches && accessibleBranches.length > 0) {
      const otherBranchNames = accessibleBranches
        .map(b => b.name)
        .filter(name => name && name.toLowerCase() !== branchName.toLowerCase());

      const hasOtherBranch = sanitizedChatHistory.some(h => {
        const contentLower = (h.content || '').toLowerCase();
        return otherBranchNames.some(otherName => contentLower.includes(otherName.toLowerCase()));
      });

      if (hasOtherBranch) {
        console.log(`[AI-Service] Detected branch switch in chat history content. Clearing history.`);
        sanitizedChatHistory = [];
      }
    }

    // Load Verkas guide
    let verkasGuide = '';
    const msgLower = message.toLowerCase();
    const needsGuide = ['cara', 'bagaimana', 'tutorial', 'fitur', 'halaman', 'screen', 'menu', 'upload', 'lampiran', 'buat', 'tambah', 'edit', 'mitra', 'piutang'].some(word => msgLower.includes(word));
    if (needsGuide) {
      try {
        const fs = require('fs');
        verkasGuide = fs.readFileSync(path.join(__dirname, '../config/verkas_guide.txt'), 'utf8');
      } catch (err) {
        console.error('[AI-Service] Failed to load verkas_guide.txt:', err);
      }
    }

    // Assemble final system prompt
    let systemPrompt = `Kamu adalah Asisten Keuangan Verkas yang pintar, ramah, dan profesional.
Aplikasi Verkas ini dikembangkan/di-develop oleh Vega Anggara Saputra (seorang developer yang sangat kece). Jika ada yang bertanya tentang siapa pengembang, pembuat, atau developer Verkas, jawablah dengan bangga bahwa pembuatnya adalah Vega Anggara Saputra.
Tugasmu adalah membantu pemilik toko/bisnis menganalisis dan memahami buku kas serta kondisi keuangan mereka.`;

    if (needsGuide && verkasGuide) {
      systemPrompt += `\n\n### PANDUAN PENGGUNAAN FITUR APLIKASI VERKAS (INTEGRITAS):
Berikut adalah petunjuk operasional cara menambah, mengedit, mengunggah lampiran, atau melakukan transaksi di aplikasi Verkas. Gunakan ini untuk memandu pengguna langkah demi langkah jika mereka bertanya tentang tutorial/cara operasional aplikasi:
${verkasGuide}\n`;
    }

    systemPrompt += `

DEFINISI KONTEKS KEUANGAN APLIKASI (DISINKRONKAN DENGAN DASHBOARD UTAMA):
1. "KAS BERJALAN": Buku kas operasional aktif untuk mencatat transaksi keuangan harian toko (ditandai di database dengan is_umum = 1 atau true). PENTING: Jika pengguna bertanya tentang transaksi, pengeluaran, pemasukan, atau saldo secara umum tanpa menyebutkan secara spesifik 'Simpanan' (atau variasi ejaan/sinonim seperti 'simpaan', 'tabungan', 'cadangan'), selalu jadikan data **Kas Berjalan** sebagai default jawabanmu.
2. "KAS SIMPANAN": Buku kas untuk tabungan, investasi, atau cadangan dana yang dipisahkan dari operasional harian (ditandai di database dengan is_umum = 0 or false).
3. "PIUTANG": Nominal pinjaman/piutang yang diberikan kepada pelanggan atau mitra bisnis. Sisa piutang adalah sisa nominal utang pelanggan yang belum dibayar.
4. RUMUS PERHITUNGAN KARTU DASHBOARD (WAJIB DIPAHAMI & DIIKUTI SECARA PRESISI):
   - "Total Omzet (Bersih)": Nilai omzet penjualan kotor dikurangi Pajak PB1 (Omzet Kotor - PB1).
   - "Pemasukan Lain-Lain": Semua pemasukan di luar omzet penjualan utama dan pelunasan piutang (Total Pemasukan - Omzet Kotor - Pelunasan Piutang).
   - "Pelunasan Piutang Periode Lalu": Nominal setoran/pelunasan hutang lama dari pelanggan/mitra.
   - "Pajak PB1": Pajak pembangunan 10% yang terkumpul dari metode pembayaran kena pajak (dihitung dari total_pb1, dengan total_pb1_paid adalah yang sudah disetor dan saldo_pb1 adalah sisa PB1 yang belum disetor).
   - "Total Pengeluaran": Semua biaya belanja operasional, gaji, bahan baku, dll.
   - "Total Saldo Kas Berjalan (Bersih)": Sisa kas setelah semua omzet dan pengeluaran dikurangi PB1 (Pemasukan Bersih - Pengeluaran).
5. "AKSES HISTORIS & PERIODE": Hari ini adalah tanggal Rabu, 1 Juli 2026 (Juli 2026). Kamu memiliki akses penuh ke data transaksi historis dari bulan-bulan sebelumnya (seperti Juni 2026, Mei 2026, April 2026, dll.) baik dari data baseline bulanan yang disediakan di bawah ini maupun dengan menjalankan kueri SQL dinamis ke database. JANGAN PERNAH beralasan atau menolak menjawab pertanyaan tentang bulan-bulan lalu (seperti Juni 2026 or sebelumnya) dengan mengatakan kamu hanya memiliki akses ke bulan berjalan (Juli 2026) karena itu tidak benar.

Berikut adalah baseline ringkasan keuangan bulanan Buku Kas "${branchName || 'Kas Berjalan'}":
`;

    monthlySummaries.forEach(m => {
      const typeLabel = (m.is_umum === 1) ? 'KAS BERJALAN' : 'KAS SIMPANAN';
      const totalOmzet = m.raw_omzet - m.total_pb1;
      const pemasukanLain = m.pemasukan - m.raw_omzet - m.pelunasan_piutang_lalu;
      const pemasukanBersih = m.pemasukan - m.total_pb1;
      const saldoNetto = pemasukanBersih - m.pengeluaran;

      systemPrompt += `Periode ${formatMonthIndo(m.month_str)} [Folder: ${typeLabel}]:\n`;
      systemPrompt += `  - Total Omzet: Rp ${formatIDRClean(totalOmzet)}\n`;
      systemPrompt += `  - Pemasukan Lain-Lain: Rp ${formatIDRClean(pemasukanLain)}\n`;
      systemPrompt += `  - Pelunasan Piutang Periode Lalu: Rp ${formatIDRClean(m.pelunasan_piutang_lalu)}\n`;
      systemPrompt += `  - Pajak PB1: Rp ${formatIDRClean(m.total_pb1)}\n`;
      systemPrompt += `  - Pajak PB1 Terbayar: Rp ${formatIDRClean(m.total_pb1_paid)}\n`;
      systemPrompt += `  - Sisa Pajak PB1: Rp ${formatIDRClean(m.total_pb1 - m.total_pb1_paid)}\n`;
      systemPrompt += `  - Total Pengeluaran: Rp ${formatIDRClean(m.pengeluaran)}\n`;
      systemPrompt += `  - Total Saldo Kas Harian/Berjalan (Bersih): Rp ${formatIDRClean(saldoNetto)}\n`;
      systemPrompt += `  - Jumlah Transaksi Terdaftar: ${m.total_transactions} transaksi\n\n`;
    });

    // Append Mitra Receivables ONLY if asked
    const hasMitraQuery = msgLower.includes('mitra') || msgLower.includes('piutang');
    if (hasMitraQuery && mitraSummary.length > 0) {
      systemPrompt += `\n### SALDO PIUTANG MITRA PELANGGAN (SEMUA WAKTU):\n`;
      mitraSummary.forEach(m => {
        systemPrompt += `- Mitra "${m.name}": Sisa Piutang Hacktif: Rp ${formatIDRClean(m.sisa_piutang)} (Total utang: Rp ${formatIDRClean(m.total_piutang)}, terbayar: Rp ${formatIDRClean(m.total_terbayar)})\n`;
      });
    }

    if (teamMembers && teamMembers.length > 0) {
      systemPrompt += `\n### TIM PIC / ADMIN YANG BERTANGGUNG JAWAB DI CABANG INI:\n`;
      teamMembers.forEach(t => {
        systemPrompt += `- Tim/Admin "${t.name}" (${t.email}) - Peran: ${t.role === 'owner' ? 'Owner' : 'Co-Owner'}\n`;
      });
    }

    systemPrompt += `\nBuku kas aktif yang sedang dibuka oleh pengguna saat ini adalah: "${branchName || 'Kas Berjalan'}".`;

    if (activeSubscription) {
      systemPrompt += `\n\n### STATUS LANGGANAN AKTIF PENGGUNA INI:\n`;
      systemPrompt += `- Paket Langganan saat ini: "${activeSubscription.plan_name}"\n`;
      systemPrompt += `- Tanggal Berakhir Sesi Paket: ${new Date(activeSubscription.end_date).toLocaleDateString('id-ID', { year: 'numeric', month: 'long', day: 'numeric' })}\n`;
    }

    if (subscriptionPlans && subscriptionPlans.length > 0) {
      systemPrompt += `\n\n### DAFTAR PAKET LANGGANAN VERKAS YANG TERSEDIA:\n`;
      subscriptionPlans.forEach(p => {
        systemPrompt += `- Paket "${p.name}": ${p.description || ''} (Maks Cabang: ${p.max_branches}, Maks Staf/Admin: ${p.max_admin}, Harga Bulanan: Rp ${formatIDRClean(p.price_monthly)}, Harga Tahunan: Rp ${formatIDRClean(p.price_yearly)})\n`;
      });
    }

    if (generatedSql && generatedSql.toUpperCase() !== 'SELECT 1') {
      systemPrompt += `\n### HASIL KUERI DATABASE DINAMIS UNTUK PERTANYAAN USER:\n`;
      systemPrompt += `Kueri SQL dijalankan: ${generatedSql}\n`;
      systemPrompt += `Hasil data (JSON): ${JSON.stringify(formatDatesToLocal(queryResult), null, 2)}\n`;
    }

    systemPrompt += `\nAturan Penting Balasan:
1. Jawablah pertanyaan pengguna secara cerdas, ramah, dan ringkas berdasarkan data baseline dan hasil kueri database dinamis di atas. Jika pengguna meminta "analisis" (analisa) atau penjelasan, berikan analisis perputaran kas (turnover) atau kondisi keuangan yang mendalam, cerdas, dan informatif (misal: dengan membandingkan pemasukan vs pengeluaran dan memberikan kesimpulan bisnis), jangan hanya mengulang satu angka nominal saja secara malas.
2. Gunakan bahasa Indonesia yang santun, bersahabat, profesional, dan mudah dipahami.
3. DILARANG KERAS MENGGUNAKAN SIMBOL BINTANG (*): JANGAN PERNAH menyertakan karakter bintang satu (*) maupun bintang dua (**) dalam balasan akhir kepada pengguna. JANGAN gunakan bintang untuk list, JANGAN gunakan bintang untuk menebalkan (bold) teks, dan JANGAN gunakan format markdown bintang apa pun karena merusak tampilan UI. Gunakan format TEKS POLOS (PLAIN TEXT) saja untuk semua tulisan.
4. CARA PENULISAN LIST: Untuk menyajikan daftar atau rincian, gunakan pemisah baris baru (enter) dan gunakan bullet list biasa memakai tanda minus (-) atau angka (1, 2, dst) TANPA tanda bintang sama sekali di depannya.
5. Jika kueri database dinamis memberikan hasil kosong atau null, sampaikan bahwa transaksi tidak ditemukan dengan sopan.
6. Kamu HANYA memiliki akses baca (read-only) terhadap data. Kamu tidak memiliki izin atau kemampuan untuk menambah (create/add), mengedit (edit/update), atau menghapus (delete) data apapun (seperti transaksi, kategori, atau buku kas). Jika pengguna memintamu mengubah data, jelaskan dengan ramah bahwa peranmu hanya untuk membaca dan menganalisis laporan keuangan saja.
7. JAWAB HANYA DOMAIN KEUANGAN & VERKAS (MUTLAK): Kamu dilarang keras menjawab pertanyaan umum di luar data keuangan toko, kas, piutang, transaksi, atau panduan Verkas. Jika ditanya tentang pengetahuan umum, presiden, resep, sains, geografi, atau obrolan di luar bisnis Verkas, kamu wajib menolak secara halus dengan kalimat: "Maaf, saya hanya dapat membantu Anda menganalisis buku kas, transaksi keuangan, dan operasional aplikasi Verkas."
8. FORMAT TANGGAL: Selalu sajikan tanggal dalam format bahasa Indonesia yang mudah dibaca dan sopan (contoh: "20 Juni 2026" atau "1 Juni 2026"). JANGAN sekali-kali menampilkan tanggal dalam format mentah database seperti YYYY-MM-DD (contoh: "2026-06-20" or "2026-06-01").
9. HINDARI MENAMPILKAN ID DATABASE: JANGAN PERNAH menyertakan database ID (seperti ID Buku Kas/Cabang, ID Kategori, ID Transaksi, dll) di balasan akhirmu agar balasan terlihat bersih dan profesional, kecuali jika pengguna meminta ID tersebut secara spesifik.
10. FORMAT RUPIAH / NOMINAL UANG: Kamu WAJIB menulis setiap nominal uang dalam format Rupiah yang benar dengan pemisah ribuan titik (.) dan pemisah desimal koma (,) jika nominal tersebut memiliki nilai desimal/sen (contoh: Rp 533.817.384,75 atau Rp 2.155.314.631,25). Jika nominalnya adalah bilangan bulat tanpa nilai desimal, kamu juga WAJIB menyertakan desimal bulat ",00" di belakangnya (contoh: Rp 148.740.600,00 atau Rp 71.000,00) agar semua angka konsisten memiliki koma desimal di belakangnya sesuai tampilan dashboard. JANGAN salah meletakkan posisi titik ribuan (misal: jangan menulis 53.381.738.475 jika aslinya 533.817.384,75).
11. JANGAN KONTRAKTIF: JANGAN PERNAH menyatakan bahwa kategori atau transaksi tidak ditemukan jika hasil kueri database dinamis di atas telah sukses mengembalikan data nominal (seperti total pengeluaran atau pemasukan bernilai lebih dari 0). Jika ada data nominal yang ditemukan, langsung laporkan saja data tersebut sebagai hasil kategori yang dicari tanpa memberikan pernyataan membingungkan bahwa kategori tersebut "tidak ditemukan".
12. DEFAULT & KETERANGAN KAS BERJALAN: Jika pengguna menanyakan pemasukan, pengeluaran, omzet, atau saldo secara umum (seperti: "pemasukan lain-lain bulan juni", "pengeluaran bulan juni"), kamu WAJIB menggunakan data Kas Berjalan sebagai default jawabanmu. Kamu juga WAJIB menuliskan secara eksplisit keterangan "pada Kas Berjalan" or "di Buku Kas Berjalan" di dalam balasan akhirmu agar pengguna mengetahui dengan jelas sumber buku kas data tersebut (kecuali jika pengguna secara khusus menyebutkan nama kategori transaksi atau Kas Simpanan tertentu).
13. PERIODE KOSONG (BULAN INI / HARI INI): Jika pengguna menanyakan data keuangan untuk "bulan ini" (Juli 2026) atau "hari ini" namun data pada periode tersebut masih kosong/Rp 0 (karena baru memasuki awal bulan atau hari baru), kamu WAJIB menyajikan data tersebut secara jujur sebagai Rp 0 (contoh: "laba bersih Juli 2026 masih Rp 0 karena belum ada transaksi yang tercatat"). JANGAN PERNAH memetakan nominal kueri dari bulan lalu (seperti Juni 2026) ke dalam deklarasi "bulan ini/Juli 2026" seolah-olah itu adalah data bulan ini! Jika kamu menampilkan data Juni, sebutkan secara eksplisit bahwa data tersebut adalah periode Juni 2026.
14. PRIORITASKAN HASIL KUERI BARU & KOREKSI DIRI: Jika hasil kueri database dinamis terbaru mengembalikan data riil yang berbeda atau bertentangan dengan jawabanmu di riwayat obrolan sebelumnya (misalnya di riwayat sebelumnya kueri database error dan kamu terpaksa menebak November, lalu sekarang kueri database sukses dijalankan dan menunjukkan bulan Juni), kamu WAJIB memprioritaskan data terbaru dari hasil kueri database dinamis yang sukses tersebut dan mengoreksi jawaban lamamu secara sopan (contoh: "Mohon maaf atas kekeliruan sebelumnya, berdasarkan data transaksi terbaru di database...").
15. PERUBAHAN CABANG BUKU KAS: Jika di dalam riwayat obrolan (chat history) terdapat data nominal dari Buku Kas/cabang lain (misal: "BOSGIL CONDET"), kamu WAJIB mengabaikan seluruh angka dari riwayat obrolan tersebut. Fokus HANYA pada data Buku Kas aktif saat ini yaitu "${branchName || 'Kas Berjalan'}" yang terera di baseline summaries terbaru!
16. PERBEDAAN OMZET BERSIH & KOTOR:
    - Omzet Bersih: Nilai "Total Omzet" yang tampil di dashboard/baseline summaries (sudah dikurangi Pajak PB1).
    - Omzet Kotor: Jumlah total sebelum dikurangi Pajak PB1 (dihitung dari: Omzet Bersih + Pajak PB1).
    Jika pengguna bertanya apakah omzet tersebut sudah bersih atau termasuk pajak, jelaskan secara jujur perbedaan angka bersih dan kotor tersebut secara dinamis berdasarkan data baseline summaries bulan terkait. JANGAN PERNAH menyebut Omzet Kotor sebagai Omzet Bersih! JANGAN PERNAH menghitung sendiri nilai Omzet dengan mengalikan Pajak PB1 dengan 10! Selalu baca langsung nilai "Total Omzet" yang tertulis di baseline summaries secara bulat.
17. JIKA PENGGUNA MEMINTA SALDO MASING-MASING KAS SIMPANAN: Kamu WAJIB menyajikan daftar nama kas simpanan beserta masing-masing saldonya secara jelas berdasarkan hasil kueri database dinamis (misalnya menggunakan format list - Nama Kas Simpanan: Nominal). JANGAN hanya menyebutkan total saldonya saja, sebutkan rincian masing-masing kas simpanan dan nominalnya.
18. KOMUNIKASI 2 ARAH & KLARIFIKASI: Jika kueri pengguna masih sangat umum atau "ngambang" (misal: "analisa perputaran kas", "analisa cashflow", dll) tanpa menyebutkan periode atau perbandingan yang jelas, kamu WAJIB menawarkan komunikasi dua arah. Sebutkan pilihan periode yang tersedia (misalnya Juni 2026 atau Juli berjalan) dan tanyakan dengan ramah periode mana yang ingin mereka analisis, atau apakah mereka ingin membandingkan tren antar bulan agar hasil analisis menjadi sangat akurat.`;

    console.log('[AI-Service] Generating final chat reply...');
    const finalPromptText = `Pesan dari pengguna: "${message}"

PENTING UNTUK JAWABANMU (ATURAN MUTLAK):
1. Hasil kueri database dinamis saat ini adalah: ${JSON.stringify(formatDatesToLocal(queryResult))}
2. SESUAIKAN KEDALAMAN JAWABAN: Jika pengguna hanya bertanya nominal singkat, jawablah secara singkat, padat, dan langsung. Namun, jika pengguna meminta "analisis", "analisa", atau penjelasan mendalam (seperti "analisa perputaran kas berjalan gua"), kamu WAJIB memberikan analisis yang cerdas dan profesional berdasarkan data kueri (seperti membandingkan perbandingan pemasukan vs pengeluaran, perputaran kas, atau cashflow) tanpa memotong penjelasan terlalu pendek. JANGAN menulis intro/outro panjang lebar atau mengulang-ulang penjelasan batasan sistem.
3. JANGAN PERNAH menyebutkan ID database internal berupa angka (seperti ID Cabang: 13, ID Transaksi, dll) kepada pengguna. Cukup sebutkan nama Buku Kas secara ramah (misal: "BOSGIL CONDET") tanpa menyertakan angka ID-nya.
4. JANGAN PERNAH memanipulasi, mengubah, merekayasa, atau mengarang (halusinasi) angka nominal keuangan! Semua angka nominal yang kamu sebutkan wajib berbasis data riil dari database dinamis atau baseline bulanan secara persis tanpa rekayasa.
5. JANGAN PERNAH menyebutkan istilah teknis database kepada user seperti "kueri database", "SQL", "null", "array kosong", "SELECT 1", atau "database dinamis". Terjemahkan ini ke bahasa bisnis biasa (misal: jika null/kosong, katakan "belum ada data transaksi yang tercatat", atau "saldonya masih kosong/Rp 0").
6. BATASAN OPRASIONAL (HANYA BACA / READ-ONLY): Kamu HANYA diizinkan untuk MEMBACA dan MENGANALISIS data keuangan pada Buku Kas aktif yang sedang dibuka (Nama: "${branchName}"). Kamu DILARANG KERAS berpura-pura bisa membuat (create), mengedit (update), atau menghapus (delete) transaksi/kategori di database! Jika pengguna memintamu menulis/mengubah data, tolak secara halus dan jelaskan bahwa kamu adalah asisten analisis yang hanya bisa membaca data, lalu berikan panduan cara melakukannya secara manual di aplikasi jika dibutuhkan.
7. BATASAN RUANG LINGKUP BUKU KAS: Kamu DILARANG membahas data buku kas (cabang) selain Buku Kas aktif saat ini yaitu "${branchName}" untuk mencegah kebocoran data antar cabang.
8. Jika hasil kueri database bernilai null atau kosong, namun data yang ditanyakan ada di data baseline summaries di atas (seperti total omzet, saldo, pb1, pengeluaran bulan Juni), GUNAKAN data dari baseline summaries tersebut untuk menjawab secara akurat. Jangan katakan tidak ada data jika data baseline memuat nominalnya!
9. Jika ditanya tentang bulan berjalan (Juli 2026) yang datanya memang kosong di database, katakan secara jujur bahwa bulan Juli baru berjalan dan belum memiliki transaksi tercatat (saldonya Rp 0).
10. JAWAB SECARA DIRECT: JANGAN PERNAH menyalin, mengulang, atau menulis kembali teks "Pertanyaan User:", "Pesan dari pengguna:", atau pertanyaan pengguna di awal jawabanmu. Langsung berikan jawaban akhir saja.
11. Jawab dengan bahasa Indonesia yang santai, bersahabat, ringkas, dan to-the-point tanpa menggunakan tanda bintang markdown (**) secara berlebihan.
12. PERIODE JUNI 2026 MEMILIKI DATA AKTIF: Hari ini adalah Juli 2026. Data transaksi untuk periode Juni 2026 sudah lengkap dan terisi di baseline summaries di atas. Harap baca data "Periode Juni 2026" dengan teliti untuk menjawab pertanyaan tentang Juni.
13. JIKA PENGGUNA MEMINTA SALDO MASING-MASING KAS SIMPANAN: Sebutkan rincian nama kas simpanan dan masing-masing nominal saldonya secara jelas berdasarkan hasil kueri database dinamis (misalnya: tabungan, cadangan, dll beserta nominalnya).
14. KOMUNIKASI 2 ARAH & KLARIFIKASI: Jika kueri pengguna masih umum atau "ngambang" tanpa menyebutkan periode yang jelas, kamu WAJIB menawarkan komunikasi dua arah. Tawarkan pilihan periode (seperti Juni 2026 atau Juli berjalan) atau analisis perbandingan tren antar bulan secara ramah.`;

    let innerReplyText = 'Maaf, saya tidak dapat memproses pesan tersebut.';
    try {
      process.stdout.write('[AI-Service] Final reply: ');
      const fs = require('fs');
      fs.appendFileSync(path.join(__dirname, 'sql_debug.log'), `\n=== FINAL PROMPT SENT TO LLM ===\n${finalPromptText}\n================================\n`);

      const openRouterMessages = [
        { role: 'system', content: systemPrompt }
      ];

      if (sanitizedChatHistory && Array.isArray(sanitizedChatHistory)) {
        sanitizedChatHistory.forEach(h => {
          openRouterMessages.push({ role: h.role, content: h.content });
        });
      }

      openRouterMessages.push({
        role: 'user',
        content: finalPromptText
      });

      const response = await callOpenRouter(openRouterMessages);
      process.stdout.write(response);
      console.log();
      innerReplyText = response;
    } catch (err) {
      console.error('[AI-Service] Failed to generate reply via OpenRouter:', err);
    }

    // Clean markdown stars and enforce proper Rupiah format programmatically
    let cleanedReplyText = innerReplyText
      .replace(/\*\*/g, '')
      .replace(/^\s*\*\s+/gm, '- ')
      .replace(/\*/g, '');

    // Programmatic Rupiah formatter to fix LLM's bad dot placements/decimals
    cleanedReplyText = cleanedReplyText.replace(/Rp\.?\s*([0-9.,]+)/gi, (match, p1) => {
      console.log(`[DEBUG REGEX] Match found: "${match}", p1: "${p1}"`);
      let cleanDigits = p1.replace(/[.,]+$/, ''); // strip trailing punctuation dots/commas
      cleanDigits = cleanDigits.replace(/[.,]0{1,2}$/, ''); // strip any trailing zero decimals (e.g. .0 or .00)

      // Find if there is a decimal separator at the end (e.g., .25 or ,25)
      let decimalIndex = -1;
      const lastDot = cleanDigits.lastIndexOf('.');
      const lastComma = cleanDigits.lastIndexOf(',');
      const lastSep = Math.max(lastDot, lastComma);

      if (lastSep !== -1) {
        const charsAfter = cleanDigits.length - 1 - lastSep;
        if (charsAfter === 1 || charsAfter === 2) {
          decimalIndex = lastSep;
        }
      }

      let parsedNumString = '';
      if (decimalIndex !== -1) {
        const beforeDecimal = cleanDigits.substring(0, decimalIndex).replace(/[.,]/g, '');
        const afterDecimal = cleanDigits.substring(decimalIndex + 1);
        parsedNumString = beforeDecimal + '.' + afterDecimal;
      } else {
        parsedNumString = cleanDigits.replace(/[.,]/g, '');
      }

      const num = parseFloat(parsedNumString);
      console.log(`[DEBUG REGEX] parsedNumString: "${parsedNumString}", num: ${num}, formatIDR(num): "${formatIDR(num)}"`);
      if (!isNaN(num)) {
        return formatIDR(num);
      }
      return match;
    });

    logResourceUsage('Request Complete');

    let finalReply = cleanedReplyText || 'Maaf, saya tidak dapat memproses pesan tersebut.';

    return res.status(200).json({
      success: true,
      reply: finalReply
    });
  } catch (error) {
    console.error('Error in AI Service controller:', error);
    return res.status(500).json({
      success: false,
      message: 'Gagal memproses pesan dengan AI',
      error: error.message
    });
  }
};

module.exports = {
  chatWithAI
};
