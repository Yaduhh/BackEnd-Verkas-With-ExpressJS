const { query } = require('../config/database');

let tableEnsured = false;

const formatRp = (val) => {
    const num = Number(val) || 0;
    return new Intl.NumberFormat('id-ID', {
        minimumFractionDigits: 0,
        maximumFractionDigits: 2,
    }).format(num);
};

const safeParseArray = (val) => {
    if (!val) return [];
    if (Array.isArray(val)) return val;
    if (typeof val === 'string') {
        try {
            const parsed = JSON.parse(val);
            return Array.isArray(parsed) ? parsed : [];
        } catch (e) {
            return [];
        }
    }
    return [];
};

class BranchReportLog {
    static async ensureTable() {
        if (tableEnsured) return;
        try {
            await query(`
                CREATE TABLE IF NOT EXISTS branch_report_logs (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    branch_id INT NULL,
                    owner_id INT NULL,
                    group_name VARCHAR(100) NULL,
                    month TINYINT NOT NULL,
                    year SMALLINT NOT NULL,
                    user_id INT NULL,
                    user_name VARCHAR(150) NOT NULL DEFAULT 'Sistem',
                    user_role VARCHAR(50) NOT NULL DEFAULT '',
                    action_type VARCHAR(100) NOT NULL DEFAULT 'update_report',
                    summary VARCHAR(500) NOT NULL,
                    changes JSON NULL,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    INDEX idx_brl_branch_period (branch_id, year, month, created_at),
                    INDEX idx_brl_group_period (owner_id, group_name, year, month, created_at)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
            `);
            tableEnsured = true;
        } catch (err) {
            console.error('Error ensuring branch_report_logs table:', err.message);
        }
    }

    static async create({
        branchId = null,
        ownerId = null,
        groupName = null,
        month,
        year,
        userId = null,
        userName = 'Sistem',
        userRole = '',
        actionType = 'update_report',
        summary = 'Memperbarui laporan keuangan',
        changes = [],
    }) {
        await this.ensureTable();
        const result = await query(
            `INSERT INTO branch_report_logs 
            (branch_id, owner_id, group_name, month, year, user_id, user_name, user_role, action_type, summary, changes)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                branchId ? Number(branchId) : null,
                ownerId ? Number(ownerId) : null,
                groupName || null,
                Number(month),
                Number(year),
                userId ? Number(userId) : null,
                userName || 'User',
                userRole || '',
                actionType,
                String(summary || '').slice(0, 500),
                JSON.stringify(Array.isArray(changes) ? changes : []),
            ]
        );
        return result.insertId;
    }

    static async findByBranchPeriod(branchId, month, year, limit = 100) {
        await this.ensureTable();
        const rows = await query(
            `SELECT * FROM branch_report_logs
             WHERE branch_id = ? AND month = ? AND year = ?
             ORDER BY created_at DESC, id DESC
             LIMIT ${Number(limit) || 100}`,
            [Number(branchId), Number(month), Number(year)]
        );
        return rows.map((r) => ({
            ...r,
            changes: safeParseArray(r.changes),
        }));
    }

    static async findByGroupPeriod(ownerId, groupName, month, year, limit = 100) {
        await this.ensureTable();
        const rows = await query(
            `SELECT * FROM branch_report_logs
             WHERE owner_id = ? AND group_name = ? AND month = ? AND year = ?
             ORDER BY created_at DESC, id DESC
             LIMIT ${Number(limit) || 100}`,
            [Number(ownerId), String(groupName || 'ALL'), Number(month), Number(year)]
        );
        return rows.map((r) => ({
            ...r,
            changes: safeParseArray(r.changes),
        }));
    }

    /**
     * Bandingkan data laporan sebelumnya dengan payload baru untuk menghasilkan daftar perubahan detail.
     */
    static computeManualChanges(oldReport, newPayload = {}) {
        const changes = [];
        const old = oldReport || {};

        // 1. Jumlah Hari Kerja (working_days)
        if (newPayload.working_days !== undefined) {
            const oldDays = Number(old.working_days ?? 25);
            const newDays = Number(newPayload.working_days ?? 25);
            if (oldDays !== newDays) {
                changes.push({
                    section: 'Periode & Hari Kerja',
                    label: 'Jumlah Hari Kerja',
                    oldValue: `${oldDays} Hari`,
                    newValue: `${newDays} Hari`,
                    description: `Jumlah Hari Kerja diubah dari ${oldDays} Hari menjadi ${newDays} Hari`,
                });
            }
        }

        // 2. Sales Channels (Rincian Sales Channel)
        if (Array.isArray(newPayload.sales_channels)) {
            const oldSc = safeParseArray(old.sales_channels);
            const newSc = newPayload.sales_channels;

            const oldMap = new Map();
            oldSc.forEach((sc) => {
                const name = String(sc.name || sc.channel_name || '').trim();
                if (name) oldMap.set(name.toLowerCase(), { name, amount: Number(sc.amount) || 0 });
            });

            const newMap = new Map();
            newSc.forEach((sc) => {
                const name = String(sc.name || sc.channel_name || '').trim();
                if (name) newMap.set(name.toLowerCase(), { name, amount: Number(sc.amount) || 0 });
            });

            newMap.forEach((val, key) => {
                if (!oldMap.has(key)) {
                    if (val.amount > 0) {
                        changes.push({
                            section: 'Pendapatan (Sales Channel)',
                            label: val.name,
                            oldValue: 'Rp 0',
                            newValue: `Rp ${formatRp(val.amount)}`,
                            description: `Menambahkan Sales Channel "${val.name}" sebesar Rp ${formatRp(val.amount)}`,
                        });
                    }
                } else {
                    const prev = oldMap.get(key);
                    if (Math.abs(prev.amount - val.amount) >= 1) {
                        changes.push({
                            section: 'Pendapatan (Sales Channel)',
                            label: val.name,
                            oldValue: `Rp ${formatRp(prev.amount)}`,
                            newValue: `Rp ${formatRp(val.amount)}`,
                            description: `Nominal Sales Channel "${val.name}" diubah dari Rp ${formatRp(prev.amount)} menjadi Rp ${formatRp(val.amount)}`,
                        });
                    }
                }
            });

            oldMap.forEach((prev, key) => {
                if (!newMap.has(key) && prev.amount > 0) {
                    changes.push({
                        section: 'Pendapatan (Sales Channel)',
                        label: prev.name,
                        oldValue: `Rp ${formatRp(prev.amount)}`,
                        newValue: 'Dihapus',
                        description: `Menghapus Sales Channel "${prev.name}" (sebelumnya Rp ${formatRp(prev.amount)})`,
                    });
                }
            });
        }

        // 3. Expense Adjustments, Savings Meta & Sub-Items Meta
        if (Array.isArray(newPayload.expense_adjustments)) {
            const oldAdjsAll = safeParseArray(old.expense_adjustments);
            const newAdjsAll = newPayload.expense_adjustments;

            // 3a. Catatan Alokasi Kas Simpanan (__SAVINGS_META__)
            const extractSavingsMeta = (arr) => {
                const map = new Map();
                arr.forEach((a) => {
                    if (a && (a.is_savings_meta || a.name === '__SAVINGS_META__') && a.parent_category) {
                        map.set(a.parent_category, String(a.savings_note || '').trim());
                    }
                });
                return map;
            };
            const oldSavings = extractSavingsMeta(oldAdjsAll);
            const newSavings = extractSavingsMeta(newAdjsAll);
            const allSavingsCats = new Set([...oldSavings.keys(), ...newSavings.keys()]);
            allSavingsCats.forEach((cat) => {
                const prevNote = oldSavings.get(cat) || '';
                const nextNote = newSavings.get(cat) || '';
                if (prevNote !== nextNote) {
                    changes.push({
                        section: 'Rincian Pengeluaran (Alokasi Simpanan)',
                        label: cat,
                        oldValue: prevNote || '-',
                        newValue: nextNote || '-',
                        description: `Catatan alokasi "${cat}" diubah dari "${prevNote || '-'}" menjadi "${nextNote || '-'}"`,
                    });
                }
            });

            // 3b. Status Sub-Item Produk ON/OFF (__SUB_ITEMS_META__)
            const extractSubItemsMeta = (arr) => {
                const map = new Map();
                arr.forEach((a) => {
                    if (a && (a.is_sub_items_meta || a.name === '__SUB_ITEMS_META__') && a.parent_category) {
                        const disabled = Array.isArray(a.disabled_items) ? a.disabled_items.map(String) : [];
                        map.set(a.parent_category, new Set(disabled));
                    }
                });
                return map;
            };
            const oldSubMeta = extractSubItemsMeta(oldAdjsAll);
            const newSubMeta = extractSubItemsMeta(newAdjsAll);
            const allSubCats = new Set([...oldSubMeta.keys(), ...newSubMeta.keys()]);
            allSubCats.forEach((cat) => {
                const prevOff = oldSubMeta.get(cat) || new Set();
                const nextOff = newSubMeta.get(cat) || new Set();

                const turnedOff = [...nextOff].filter((x) => !prevOff.has(x));
                const turnedOn = [...prevOff].filter((x) => !nextOff.has(x));

                if (turnedOff.length > 0) {
                    const labelItems = turnedOff.length > 4
                        ? `${turnedOff.slice(0, 4).join(', ')} (+${turnedOff.length - 4} lainnya)`
                        : turnedOff.join(', ');
                    changes.push({
                        section: 'Rincian Pengeluaran (Sub-Item)',
                        label: `${cat} — Sub-Item OFF`,
                        oldValue: 'ON',
                        newValue: 'OFF',
                        description: `Menonaktifkan (OFF) ${turnedOff.length} sub-item pada "${cat}": ${labelItems}`,
                    });
                }
                if (turnedOn.length > 0) {
                    const labelItems = turnedOn.length > 4
                        ? `${turnedOn.slice(0, 4).join(', ')} (+${turnedOn.length - 4} lainnya)`
                        : turnedOn.join(', ');
                    changes.push({
                        section: 'Rincian Pengeluaran (Sub-Item)',
                        label: `${cat} — Sub-Item ON`,
                        oldValue: 'OFF',
                        newValue: 'ON',
                        description: `Mengaktifkan (ON) ${turnedOn.length} sub-item pada "${cat}": ${labelItems}`,
                    });
                }
            });

            // 3c. Penyesuaian Pengeluaran Manual (Regular Adjustments)
            const isRegularAdj = (a) =>
                a &&
                !a.is_savings_meta &&
                a.name !== '__SAVINGS_META__' &&
                !a.is_sub_items_meta &&
                a.name !== '__SUB_ITEMS_META__' &&
                a.parent_category &&
                String(a.name || '').trim();

            const oldReg = oldAdjsAll.filter(isRegularAdj);
            const newReg = newAdjsAll.filter(isRegularAdj);

            const oldRegMap = new Map();
            oldReg.forEach((a) => {
                const key = `${a.parent_category}::${String(a.name).trim().toLowerCase()}`;
                oldRegMap.set(key, {
                    parent: a.parent_category,
                    name: String(a.name).trim(),
                    amount: Number(a.amount) || 0,
                });
            });

            const newRegMap = new Map();
            newReg.forEach((a) => {
                const key = `${a.parent_category}::${String(a.name).trim().toLowerCase()}`;
                newRegMap.set(key, {
                    parent: a.parent_category,
                    name: String(a.name).trim(),
                    amount: Number(a.amount) || 0,
                });
            });

            newRegMap.forEach((val, key) => {
                if (!oldRegMap.has(key)) {
                    changes.push({
                        section: 'Rincian Pengeluaran (Penyesuaian)',
                        label: `${val.parent} -> ${val.name}`,
                        oldValue: 'Tidak ada',
                        newValue: `Rp ${formatRp(val.amount)}`,
                        description: `Menambahkan rincian penyesuaian "${val.name}" (Rp ${formatRp(val.amount)}) pada kategori "${val.parent}"`,
                    });
                } else {
                    const prev = oldRegMap.get(key);
                    if (Math.abs(prev.amount - val.amount) >= 1) {
                        changes.push({
                            section: 'Rincian Pengeluaran (Penyesuaian)',
                            label: `${val.parent} -> ${val.name}`,
                            oldValue: `Rp ${formatRp(prev.amount)}`,
                            newValue: `Rp ${formatRp(val.amount)}`,
                            description: `Mengubah nominal penyesuaian "${val.name}" pada "${val.parent}" dari Rp ${formatRp(prev.amount)} menjadi Rp ${formatRp(val.amount)}`,
                        });
                    }
                }
            });

            oldRegMap.forEach((prev, key) => {
                if (!newRegMap.has(key)) {
                    changes.push({
                        section: 'Rincian Pengeluaran (Penyesuaian)',
                        label: `${prev.parent} -> ${prev.name}`,
                        oldValue: `Rp ${formatRp(prev.amount)}`,
                        newValue: 'Dihapus',
                        description: `Menghapus rincian penyesuaian "${prev.name}" (Rp ${formatRp(prev.amount)}) dari kategori "${prev.parent}"`,
                    });
                }
            });
        }

        // 4. Urutan Kategori Pengeluaran (expense_order)
        if (Array.isArray(newPayload.expense_order) && newPayload.expense_order.length > 0) {
            const oldOrder = safeParseArray(old.expense_order);
            const newOrder = newPayload.expense_order;
            if (oldOrder.length > 0) {
                const commonOld = oldOrder.filter((k) => newOrder.includes(k));
                const commonNew = newOrder.filter((k) => oldOrder.includes(k));
                if (commonOld.length > 1 && JSON.stringify(commonOld) !== JSON.stringify(commonNew)) {
                    changes.push({
                        section: 'Rincian Pengeluaran (Urutan)',
                        label: 'Urutan Kategori Pengeluaran',
                        oldValue: commonOld.slice(0, 4).join(' -> ') + (commonOld.length > 4 ? ' ...' : ''),
                        newValue: commonNew.slice(0, 4).join(' -> ') + (commonNew.length > 4 ? ' ...' : ''),
                        description: 'Mengubah urutan baris kategori pada Rincian Pengeluaran',
                    });
                }
            }
        }

        // 5. Status Kategori Aktif/Nonaktif (disabled_categories - Laporan Gabungan/Grup)
        if (Array.isArray(newPayload.disabled_categories)) {
            const oldDis = new Set(safeParseArray(old.disabled_categories).map(String));
            const newDis = new Set(newPayload.disabled_categories.map(String));

            const newlyDisabled = [...newDis].filter((x) => !oldDis.has(x));
            const newlyEnabled = [...oldDis].filter((x) => !newDis.has(x));

            newlyDisabled.forEach((cat) => {
                changes.push({
                    section: 'Filter Kategori',
                    label: cat,
                    oldValue: 'ON',
                    newValue: 'OFF',
                    description: `Menonaktifkan (OFF) kategori "${cat}"`,
                });
            });
            newlyEnabled.forEach((cat) => {
                changes.push({
                    section: 'Filter Kategori',
                    label: cat,
                    oldValue: 'OFF',
                    newValue: 'ON',
                    description: `Mengaktifkan kembali (ON) kategori "${cat}"`,
                });
            });
        }

        // 6. Bagi Hasil & Subsidi (bagi_hasil)
        if (Array.isArray(newPayload.bagi_hasil)) {
            const oldBh = safeParseArray(old.bagi_hasil);
            const newBh = newPayload.bagi_hasil;

            const maxLen = Math.max(oldBh.length, newBh.length);
            for (let i = 0; i < maxLen; i++) {
                const prev = oldBh[i];
                const next = newBh[i];

                if (!prev && next) {
                    const title = String(next.title || `Pihak #${i + 1}`).trim();
                    const pct = Number(next.percentage) || 0;
                    const amt = Number(next.amount) || 0;
                    changes.push({
                        section: 'Bagi Hasil',
                        label: title,
                        oldValue: 'Tidak ada',
                        newValue: `${pct}% (Rp ${formatRp(amt)})`,
                        description: `Menambahkan pihak Bagi Hasil "${title}" (${pct}% = Rp ${formatRp(amt)})`,
                    });
                } else if (prev && !next) {
                    const title = String(prev.title || `Pihak #${i + 1}`).trim();
                    const pct = Number(prev.percentage) || 0;
                    const amt = Number(prev.amount) || 0;
                    changes.push({
                        section: 'Bagi Hasil',
                        label: title,
                        oldValue: `${pct}% (Rp ${formatRp(amt)})`,
                        newValue: 'Dihapus',
                        description: `Menghapus pihak Bagi Hasil "${title}"`,
                    });
                } else if (prev && next) {
                    const prevTitle = String(prev.title || '').trim();
                    const nextTitle = String(next.title || '').trim();
                    const prevPct = Number(prev.percentage) || 0;
                    const nextPct = Number(next.percentage) || 0;
                    const prevAmt = Number(prev.amount) || 0;
                    const nextAmt = Number(next.amount) || 0;
                    const displayTitle = nextTitle || prevTitle || `Pihak #${i + 1}`;

                    if (prevTitle !== nextTitle || prevPct !== nextPct || Math.abs(prevAmt - nextAmt) >= 1) {
                        changes.push({
                            section: 'Bagi Hasil',
                            label: displayTitle,
                            oldValue: `${prevTitle || '-'} (${prevPct}% = Rp ${formatRp(prevAmt)})`,
                            newValue: `${nextTitle || '-'} (${nextPct}% = Rp ${formatRp(nextAmt)})`,
                            description: `Mengubah Bagi Hasil "${displayTitle}" dari ${prevPct}% (Rp ${formatRp(prevAmt)}) menjadi ${nextPct}% (Rp ${formatRp(nextAmt)})`,
                        });
                    }

                    // Compare subItems (Rincian Penerima & Subsidi)
                    const oldSubs = Array.isArray(prev.subItems) ? prev.subItems : [];
                    const newSubs = Array.isArray(next.subItems) ? next.subItems : [];
                    const subMax = Math.max(oldSubs.length, newSubs.length);

                    for (let j = 0; j < subMax; j++) {
                        const sPrev = oldSubs[j];
                        const sNext = newSubs[j];

                        if (!sPrev && sNext) {
                            const sTitle = String(sNext.title || `Penerima #${j + 1}`).trim();
                            const sPct = Number(sNext.percentage) || 0;
                            const sAmt = Number(sNext.amount) || 0;
                            const sSub = Number(sNext.subsidi) || 0;
                            changes.push({
                                section: `Bagi Hasil (${displayTitle})`,
                                label: sTitle,
                                oldValue: 'Tidak ada',
                                newValue: `${sPct}% = Rp ${formatRp(sAmt)}${sSub > 0 ? ` + Subsidi Rp ${formatRp(sSub)}` : ''}`,
                                description: `Menambahkan penerima "${sTitle}" pada ${displayTitle} (${sPct}% = Rp ${formatRp(sAmt)}${sSub > 0 ? `, Subsidi Rp ${formatRp(sSub)}` : ''})`,
                            });
                        } else if (sPrev && !sNext) {
                            const sTitle = String(sPrev.title || `Penerima #${j + 1}`).trim();
                            changes.push({
                                section: `Bagi Hasil (${displayTitle})`,
                                label: sTitle,
                                oldValue: `${Number(sPrev.percentage) || 0}% (Rp ${formatRp(sPrev.amount)})`,
                                newValue: 'Dihapus',
                                description: `Menghapus penerima "${sTitle}" dari ${displayTitle}`,
                            });
                        } else if (sPrev && sNext) {
                            const sPrevTitle = String(sPrev.title || '').trim();
                            const sNextTitle = String(sNext.title || '').trim();
                            const sLabel = sNextTitle || sPrevTitle || `Penerima #${j + 1}`;

                            const sPrevPct = Number(sPrev.percentage) || 0;
                            const sNextPct = Number(sNext.percentage) || 0;
                            const sPrevAmt = Number(sPrev.amount) || 0;
                            const sNextAmt = Number(sNext.amount) || 0;

                            if (sPrevTitle !== sNextTitle || sPrevPct !== sNextPct || Math.abs(sPrevAmt - sNextAmt) >= 1) {
                                changes.push({
                                    section: `Bagi Hasil (${displayTitle})`,
                                    label: sLabel,
                                    oldValue: `${sPrevTitle || '-'} (${sPrevPct}% = Rp ${formatRp(sPrevAmt)})`,
                                    newValue: `${sNextTitle || '-'} (${sNextPct}% = Rp ${formatRp(sNextAmt)})`,
                                    description: `Mengubah rincian penerima "${sLabel}" (${displayTitle}) dari ${sPrevPct}% (Rp ${formatRp(sPrevAmt)}) menjadi ${sNextPct}% (Rp ${formatRp(sNextAmt)})`,
                                });
                            }

                            const sPrevSub = Number(sPrev.subsidi) || 0;
                            const sNextSub = Number(sNext.subsidi) || 0;
                            if (Math.abs(sPrevSub - sNextSub) >= 1) {
                                changes.push({
                                    section: `Bagi Hasil — Subsidi (${displayTitle})`,
                                    label: `Subsidi ${sLabel}`,
                                    oldValue: `Rp ${formatRp(sPrevSub)}`,
                                    newValue: `Rp ${formatRp(sNextSub)}`,
                                    description: `Mengubah Subsidi "${sLabel}" (${displayTitle}) dari Rp ${formatRp(sPrevSub)} menjadi Rp ${formatRp(sNextSub)} (Total: Rp ${formatRp(sNextAmt + sNextSub)})`,
                                });
                            }

                            const sPrevActive = sPrev.is_active !== false && sPrev.is_active !== 'false' && sPrev.is_active !== 0;
                            const sNextActive = sNext.is_active !== false && sNext.is_active !== 'false' && sNext.is_active !== 0;
                            if (sPrevActive !== sNextActive) {
                                changes.push({
                                    section: `Bagi Hasil (${displayTitle})`,
                                    label: `Status Cetak ${sLabel}`,
                                    oldValue: sPrevActive ? 'PRINT' : 'HIDE',
                                    newValue: sNextActive ? 'PRINT' : 'HIDE',
                                    description: `Mengubah status cetak "${sLabel}" (${displayTitle}) dari ${sPrevActive ? 'PRINT' : 'HIDE'} menjadi ${sNextActive ? 'PRINT' : 'HIDE'}`,
                                });
                            }
                        }
                    }
                }
            }
        }

        // 7. Nilai Stok Awal & Stok Akhir
        if (newPayload.stok_awal !== undefined) {
            const oldStokAwal = Number(old.stok_awal) || 0;
            const newStokAwal = Number(newPayload.stok_awal) || 0;
            if (Math.abs(oldStokAwal - newStokAwal) >= 1) {
                changes.push({
                    section: 'Nilai Stok Persediaan',
                    label: 'Stok Awal',
                    oldValue: `Rp ${formatRp(oldStokAwal)}`,
                    newValue: `Rp ${formatRp(newStokAwal)}`,
                    description: `Mengubah Nilai Stok Awal dari Rp ${formatRp(oldStokAwal)} menjadi Rp ${formatRp(newStokAwal)}`,
                });
            }
        }

        if (newPayload.stok_akhir !== undefined) {
            const oldStokAkhir = Number(old.stok_akhir) || 0;
            const newStokAkhir = Number(newPayload.stok_akhir) || 0;
            if (Math.abs(oldStokAkhir - newStokAkhir) >= 1) {
                changes.push({
                    section: 'Nilai Stok Persediaan',
                    label: 'Stok Akhir',
                    oldValue: `Rp ${formatRp(oldStokAkhir)}`,
                    newValue: `Rp ${formatRp(newStokAkhir)}`,
                    description: `Mengubah Nilai Stok Akhir dari Rp ${formatRp(oldStokAkhir)} menjadi Rp ${formatRp(newStokAkhir)}`,
                });
            }
        }

        return changes;
    }

    /**
     * Bandingkan angka sistem (Omzet & Pengeluaran) lama di DB vs hasil kalkulasi transaksi terbaru.
     */
    static computeSystemSyncChanges(oldReport, { omzetTotal, pengeluaranTotal }) {
        if (!oldReport) return [];
        const changes = [];
        const oldOmzet = Number(oldReport.omzet_total) || 0;
        const newOmzet = Number(omzetTotal) || 0;
        const oldExp = Number(oldReport.pengeluaran_total) || 0;
        const newExp = Number(pengeluaranTotal) || 0;

        if (Math.abs(oldOmzet - newOmzet) >= 1) {
            changes.push({
                section: 'Kalkulasi Kas Sistem',
                label: 'Total Pendapatan / Omzet',
                oldValue: `Rp ${formatRp(oldOmzet)}`,
                newValue: `Rp ${formatRp(newOmzet)}`,
                description: `Total Pendapatan berubah dari Rp ${formatRp(oldOmzet)} menjadi Rp ${formatRp(newOmzet)} mengikuti pembaruan transaksi kas`,
            });
        }

        if (Math.abs(oldExp - newExp) >= 1) {
            changes.push({
                section: 'Kalkulasi Kas Sistem',
                label: 'Total Biaya Pengeluaran',
                oldValue: `Rp ${formatRp(oldExp)}`,
                newValue: `Rp ${formatRp(newExp)}`,
                description: `Total Pengeluaran berubah dari Rp ${formatRp(oldExp)} menjadi Rp ${formatRp(newExp)} mengikuti pembaruan transaksi kas`,
            });
        }

        if (changes.length > 0) {
            const oldProfit = oldOmzet - oldExp;
            const newProfit = newOmzet - newExp;
            if (Math.abs(oldProfit - newProfit) >= 1) {
                changes.push({
                    section: 'Kalkulasi Kas Sistem',
                    label: 'Saldo Kas / Profit',
                    oldValue: `Rp ${formatRp(oldProfit)}`,
                    newValue: `Rp ${formatRp(newProfit)}`,
                    description: `Saldo Kas (Profit) berubah dari Rp ${formatRp(oldProfit)} menjadi Rp ${formatRp(newProfit)}`,
                });
            }
        }

        return changes;
    }
}

module.exports = BranchReportLog;
