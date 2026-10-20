const Product = require('../models/Product');
const { query } = require('../config/database');
const xlsx = require('xlsx');
const ExcelJS = require('exceljs');

// Get all products for the branch
const getProducts = async (req, res, next) => {
  try {
    const branchId = req.branchId || req.headers['x-branch-id'] || req.query.branch_id;
    if (!branchId) {
      return res.status(400).json({
        success: false,
        message: 'Branch ID wajib disertakan'
      });
    }

    const { include_inactive, only_deleted, category_id } = req.query;

    const products = await Product.findAll({
      branchId: parseInt(branchId),
      categoryId: category_id ? parseInt(category_id) : undefined,
      includeInactive: include_inactive === 'true' || include_inactive === '1' || req.user.role === 'owner' || req.user.role === 'master',
      onlyDeleted: only_deleted === 'true' || only_deleted === '1'
    });

    res.json({
      success: true,
      data: products
    });
  } catch (error) {
    next(error);
  }
};

// Get single product by ID
const getProductById = async (req, res, next) => {
  try {
    const { id } = req.params;
    const product = await Product.findById(parseInt(id));

    if (!product) {
      return res.status(404).json({
        success: false,
        message: 'Produk tidak ditemukan'
      });
    }

    res.json({
      success: true,
      data: product
    });
  } catch (error) {
    next(error);
  }
};

// Create product
const createProduct = async (req, res, next) => {
  try {
    const branchId = req.branchId || req.headers['x-branch-id'] || req.body.branch_id;
    if (!branchId) {
      return res.status(400).json({
        success: false,
        message: 'Branch ID wajib disertakan'
      });
    }

    const { category_id, name, description, is_active = true, brands = [] } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({
        success: false,
        message: 'Nama produk wajib diisi'
      });
    }

    const product = await Product.create({
      branchId: parseInt(branchId),
      categoryId: category_id ? parseInt(category_id) : null,
      name: name.trim(),
      description: description ? description.trim() : null,
      isActive: is_active !== false && is_active !== 0 && is_active !== '0'
    });

    // If brands are provided in body, add them
    if (Array.isArray(brands) && brands.length > 0) {
      for (const brand of brands) {
        const brandName = typeof brand === 'string' ? brand : brand.name;
        if (brandName && brandName.trim()) {
          await Product.addBrand(product.id, {
            name: brandName.trim(),
            description: brand.description || null
          });
        }
      }
    }

    const reloaded = await Product.findById(product.id);

    res.status(201).json({
      success: true,
      message: 'Produk berhasil ditambahkan ke katalog',
      data: reloaded
    });
  } catch (error) {
    next(error);
  }
};

// Update product
const updateProduct = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { category_id, name, description, is_active } = req.body;

    const existing = await Product.findById(parseInt(id));
    if (!existing) {
      return res.status(404).json({
        success: false,
        message: 'Produk tidak ditemukan'
      });
    }

    const updated = await Product.update(parseInt(id), {
      categoryId: category_id !== undefined ? (category_id ? parseInt(category_id) : null) : undefined,
      name: name !== undefined ? name.trim() : undefined,
      description: description !== undefined ? description.trim() : undefined,
      isActive: is_active !== undefined ? (is_active !== false && is_active !== 0 && is_active !== '0') : undefined
    });

    res.json({
      success: true,
      message: 'Produk berhasil diperbarui',
      data: updated
    });
  } catch (error) {
    next(error);
  }
};

// Delete product
const deleteProduct = async (req, res, next) => {
  try {
    const { id } = req.params;
    const existing = await Product.findById(parseInt(id));
    if (!existing) {
      return res.status(404).json({
        success: false,
        message: 'Produk tidak ditemukan'
      });
    }

    await Product.softDelete(parseInt(id));

    res.json({
      success: true,
      message: 'Produk berhasil dihapus'
    });
  } catch (error) {
    next(error);
  }
};

// Restore product
const restoreProduct = async (req, res, next) => {
  try {
    const { id } = req.params;
    const restored = await Product.restore(parseInt(id));
    if (!restored) {
      return res.status(404).json({
        success: false,
        message: 'Produk tidak ditemukan'
      });
    }

    res.json({
      success: true,
      message: 'Produk berhasil dipulihkan',
      data: restored
    });
  } catch (error) {
    next(error);
  }
};

// Add Brand to Product
const addBrand = async (req, res, next) => {
  try {
    const { productId } = req.params;
    const { name, description, is_active = true } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({
        success: false,
        message: 'Nama merek wajib diisi'
      });
    }

    const brand = await Product.addBrand(parseInt(productId), {
      name: name.trim(),
      description: description ? description.trim() : null,
      isActive: is_active !== false && is_active !== 0 && is_active !== '0'
    });

    res.status(201).json({
      success: true,
      message: 'Merek berhasil ditambahkan',
      data: brand
    });
  } catch (error) {
    next(error);
  }
};

// Update Brand
const updateBrand = async (req, res, next) => {
  try {
    const { brandId } = req.params;
    const { name, description, is_active } = req.body;

    const updated = await Product.updateBrand(parseInt(brandId), {
      name: name !== undefined ? name.trim() : undefined,
      description: description !== undefined ? description.trim() : undefined,
      isActive: is_active !== undefined ? (is_active !== false && is_active !== 0 && is_active !== '0') : undefined
    });

    res.json({
      success: true,
      message: 'Merek berhasil diperbarui',
      data: updated
    });
  } catch (error) {
    next(error);
  }
};

// Delete Brand
const deleteBrand = async (req, res, next) => {
  try {
    const { brandId } = req.params;
    await Product.deleteBrand(parseInt(brandId));

    res.json({
      success: true,
      message: 'Merek berhasil dihapus'
    });
  } catch (error) {
    next(error);
  }
};

// Bulk Delete Products
const bulkDeleteProducts = async (req, res, next) => {
  try {
    const branchId = req.branchId || req.headers['x-branch-id'] || req.body.branch_id;
    const { productIds, permanent = false } = req.body;

    if (!Array.isArray(productIds) || productIds.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Daftar ID produk wajib disertakan'
      });
    }

    const validIds = productIds.map(id => parseInt(id)).filter(id => !isNaN(id) && id > 0);
    if (validIds.length === 0) {
      return res.status(400).json({ success: false, message: 'ID produk tidak valid' });
    }

    const placeholders = validIds.map(() => '?').join(',');
    const params = branchId ? [...validIds, parseInt(branchId)] : [...validIds];
    const branchCondition = branchId ? ' AND branch_id = ?' : '';

    let affectedCount = 0;
    if (permanent === true || permanent === 'true' || permanent === 1) {
      const result = await query(
        `DELETE FROM products WHERE id IN (${placeholders})${branchCondition}`,
        params
      );
      affectedCount = result.affectedRows || 0;
    } else {
      const result = await query(
        `UPDATE products SET status_deleted = 1, deleted_at = NOW() WHERE id IN (${placeholders})${branchCondition}`,
        params
      );
      affectedCount = result.affectedRows || 0;
    }

    res.json({
      success: true,
      message: `Berhasil menghapus ${affectedCount} produk`,
      data: { affectedCount }
    });
  } catch (error) {
    next(error);
  }
};

// Delete all products by category (or uncategorized)
const deleteProductsByCategory = async (req, res, next) => {
  try {
    const branchId = req.branchId || req.headers['x-branch-id'] || req.query.branch_id;
    if (!branchId) {
      return res.status(400).json({ success: false, message: 'Branch ID wajib disertakan' });
    }

    const { categoryId } = req.params;
    const permanent = req.query.permanent === 'true' || req.body?.permanent === true;

    let result;
    if (categoryId === 'uncategorized' || categoryId === '0') {
      if (permanent) {
        result = await query(
          `DELETE FROM products 
           WHERE branch_id = ? AND (category_id IS NULL OR category_id NOT IN (SELECT id FROM categories WHERE status_deleted = 0))`,
          [parseInt(branchId)]
        );
      } else {
        result = await query(
          `UPDATE products SET status_deleted = 1, deleted_at = NOW() 
           WHERE branch_id = ? AND (category_id IS NULL OR category_id NOT IN (SELECT id FROM categories WHERE status_deleted = 0))`,
          [parseInt(branchId)]
        );
      }
    } else {
      const catId = parseInt(categoryId);
      if (permanent) {
        result = await query(
          `DELETE FROM products WHERE branch_id = ? AND category_id = ?`,
          [parseInt(branchId), catId]
        );
      } else {
        result = await query(
          `UPDATE products SET status_deleted = 1, deleted_at = NOW() WHERE branch_id = ? AND category_id = ?`,
          [parseInt(branchId), catId]
        );
      }
    }

    res.json({
      success: true,
      message: `Berhasil menghapus ${result.affectedRows || 0} produk`,
      data: { affectedCount: result.affectedRows || 0 }
    });
  } catch (error) {
    next(error);
  }
};

// Bulk Assign Category to Products (move products to a category)
const bulkAssignCategory = async (req, res, next) => {
  try {
    const branchId = req.branchId || req.headers['x-branch-id'] || req.body.branch_id;
    const { productIds, category_id } = req.body;

    if (!Array.isArray(productIds) || productIds.length === 0) {
      return res.status(400).json({ success: false, message: 'Daftar ID produk wajib disertakan' });
    }
    if (!category_id) {
      return res.status(400).json({ success: false, message: 'Kategori tujuan wajib dipilih' });
    }

    const validIds = productIds.map(id => parseInt(id)).filter(id => !isNaN(id) && id > 0);
    const placeholders = validIds.map(() => '?').join(',');
    const params = [parseInt(category_id), ...validIds];
    let branchCondition = '';
    if (branchId) {
      branchCondition = ' AND branch_id = ?';
      params.push(parseInt(branchId));
    }

    const result = await query(
      `UPDATE products SET category_id = ? WHERE id IN (${placeholders})${branchCondition}`,
      params
    );

    res.json({
      success: true,
      message: `Berhasil memindahkan ${result.affectedRows || 0} produk ke kategori tujuan`,
      data: { affectedCount: result.affectedRows || 0 }
    });
  } catch (error) {
    next(error);
  }
};

// Download Excel Template for Product & Brand Import
const downloadTemplate = async (req, res, next) => {
  try {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Verkas';
    workbook.created = new Date();

    // Sheet 1: Template Produk
    const sheet = workbook.addWorksheet('Template Produk');

    sheet.columns = [
      { header: 'No', key: 'no', width: 6 },
      { header: 'Kategori', key: 'category', width: 22 },
      { header: 'Nama Produk', key: 'product_name', width: 30 },
      { header: 'Merek / Varian (Pisahkan dengan Koma)', key: 'brands', width: 45 },
      { header: 'Keterangan', key: 'description', width: 30 }
    ];

    // Style Header Row
    const headerRow = sheet.getRow(1);
    headerRow.height = 28;
    headerRow.eachCell((cell) => {
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FF0F766E' } // Deep Emerald / Teal
      };
      cell.font = {
        name: 'Arial',
        size: 11,
        bold: true,
        color: { argb: 'FFFFFFFF' }
      };
      cell.alignment = { vertical: 'middle', horizontal: 'center' };
      cell.border = {
        top: { style: 'thin', color: { argb: 'FFD1D5DB' } },
        bottom: { style: 'medium', color: { argb: 'FF0D9488' } },
        left: { style: 'thin', color: { argb: 'FFD1D5DB' } },
        right: { style: 'thin', color: { argb: 'FFD1D5DB' } }
      };
    });

    // Sample data
    const sampleData = [
      { no: 1, category: 'Bahan Baku', product_name: 'Minyak Goreng', brands: 'Sunco, Sania, Bimoli, Filma', description: 'Minyak goreng kemasan 2 Liter' },
      { no: 2, category: 'Bahan Baku', product_name: 'Beras', brands: 'Ramos, Pandan Wangi, Rojolele', description: 'Karung 25kg' },
      { no: 3, category: 'Bahan Baku', product_name: 'Ayam Broiler', brands: 'CP Prima, Best Chicken, Segar Pasar', description: 'Ukuran 1.0 - 1.2 kg' },
      { no: 4, category: 'Packaging', product_name: 'Box Nasi', brands: 'Polos Kraft, Sablon Logo', description: 'Ukuran Medium (18x18)' },
      { no: 5, category: 'Operasional', product_name: 'Gas LPG', brands: 'Pertamina 3kg, Bright Gas 12kg', description: 'Kebutuhan dapur harian' }
    ];

    sampleData.forEach((item) => {
      const row = sheet.addRow(item);
      row.height = 22;
      row.eachCell((cell, colNumber) => {
        cell.font = { name: 'Arial', size: 10 };
        cell.alignment = {
          vertical: 'middle',
          horizontal: colNumber === 1 ? 'center' : 'left'
        };
        cell.border = {
          top: { style: 'thin', color: { argb: 'FFE5E7EB' } },
          bottom: { style: 'thin', color: { argb: 'FFE5E7EB' } },
          left: { style: 'thin', color: { argb: 'FFE5E7EB' } },
          right: { style: 'thin', color: { argb: 'FFE5E7EB' } }
        };
      });
    });

    // Fetch active categories for Sheet 2 reference
    const categories = await query(
      `SELECT id, name, type FROM categories WHERE status_deleted = 0 OR status_deleted IS NULL ORDER BY name ASC`
    );

    const refSheet = workbook.addWorksheet('Daftar Kategori');
    refSheet.columns = [
      { header: 'No', key: 'no', width: 6 },
      { header: 'Nama Kategori', key: 'name', width: 35 },
      { header: 'Tipe', key: 'type', width: 15 }
    ];

    const refHeader = refSheet.getRow(1);
    refHeader.height = 24;
    refHeader.eachCell((cell) => {
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FF334155' } // Slate
      };
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      cell.alignment = { vertical: 'middle', horizontal: 'center' };
    });

    categories.forEach((cat, idx) => {
      const r = refSheet.addRow({
        no: idx + 1,
        name: cat.name,
        type: cat.type || 'expense'
      });
      r.height = 20;
    });

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="Template_Import_Produk_Verkas.xlsx"');

    await workbook.xlsx.write(res);
    res.end();
  } catch (error) {
    next(error);
  }
};

// Helper: Parse and validate product Excel buffer
const parseProductExcel = async (buffer, branchId, targetCategoryId = null) => {
  const workbook = xlsx.read(buffer, { type: 'buffer' });
  const firstSheetName = workbook.SheetNames[0];
  if (!firstSheetName) {
    throw new Error('File Excel kosong atau tidak memiliki sheet');
  }

  const worksheet = workbook.Sheets[firstSheetName];
  const rawRows = xlsx.utils.sheet_to_json(worksheet, { defval: '' });
  if (!rawRows || rawRows.length === 0) {
    throw new Error('Tidak ada data yang ditemukan di dalam file Excel');
  }

  // Identify column keys
  const firstRow = rawRows[0];
  const keys = Object.keys(firstRow);

  const categoryKey = keys.find(k => /kategori|category/i.test(k));
  const productKey = keys.find(k => /nama.*produk|produk|product.*name|nama.*barang|barang/i.test(k));
  const brandKey = keys.find(k => /merek|merk|brand|varian/i.test(k));
  const descKey = keys.find(k => /keterangan|deskripsi|catatan|note|description/i.test(k));

  if (!productKey) {
    throw new Error('Kolom "Nama Produk" tidak ditemukan dalam file Excel. Silakan gunakan template yang telah disediakan.');
  }

  // Fetch existing categories
  const categories = await query(
    `SELECT id, name, type FROM categories WHERE status_deleted = 0 OR status_deleted IS NULL`
  );
  const categoryMap = new Map();
  for (const cat of categories) {
    if (cat.name) {
      categoryMap.set(cat.name.trim().toLowerCase(), cat);
    }
  }

  // Forced target category if selected by user
  let forcedCategory = null;
  if (targetCategoryId && targetCategoryId !== 'auto' && targetCategoryId !== '0') {
    forcedCategory = categories.find(c => c.id === parseInt(targetCategoryId)) || null;
  }

  // Fetch existing products in this branch
  const existingProducts = await query(
    `SELECT id, LOWER(name) as lower_name, name, category_id, description FROM products WHERE branch_id = ? AND status_deleted = 0`,
    [parseInt(branchId)]
  );
  const existingProductMap = new Map();
  for (const p of existingProducts) {
    existingProductMap.set(p.lower_name.trim(), p);
  }

  // Group rows by product name
  const productsToProcess = new Map();
  const previewItems = [];

  for (const row of rawRows) {
    const rawProductName = (row[productKey] || '').toString().trim();
    if (!rawProductName) continue; // Skip blank product names

    const warnings = [];
    let safeProductName = rawProductName;
    if (safeProductName.length > 255) {
      safeProductName = safeProductName.slice(0, 255);
      warnings.push('Nama produk melebihi 255 karakter (dipotong)');
    }

    const lowerProd = safeProductName.toLowerCase();
    const rawCategory = categoryKey ? (row[categoryKey] || '').toString().trim().slice(0, 255) : '';
    const rawBrands = brandKey ? (row[brandKey] || '').toString().trim() : '';
    const rawDesc = descKey ? (row[descKey] || '').toString().trim() : '';

    // Split brands by comma, semicolon, newline, slash, or pipe
    const brandList = rawBrands
      ? rawBrands.split(/[,;\n|/]+/).map(b => {
          const trimmed = b.trim();
          if (trimmed.length > 255) {
            warnings.push(`Merek "${trimmed.slice(0, 25)}..." dipotong 255 karakter`);
            return trimmed.slice(0, 255);
          }
          return trimmed;
        }).filter(Boolean)
      : [];

    let matchedCat = null;
    if (forcedCategory) {
      matchedCat = forcedCategory;
    } else if (rawCategory) {
      matchedCat = categoryMap.get(rawCategory.toLowerCase()) || null;
    }

    if (!matchedCat) {
      warnings.push('Kategori induk belum dipilih / tidak ditemukan');
    }

    const isExisting = existingProductMap.has(lowerProd);

    if (!productsToProcess.has(lowerProd)) {
      productsToProcess.set(lowerProd, {
        name: safeProductName,
        categoryName: matchedCat ? matchedCat.name : rawCategory,
        matchedCategoryName: matchedCat ? matchedCat.name : null,
        matchedCategoryId: matchedCat ? matchedCat.id : null,
        description: rawDesc,
        brands: new Set(brandList),
        isExisting,
        warnings
      });
    } else {
      const item = productsToProcess.get(lowerProd);
      if (!item.matchedCategoryId && matchedCat) {
        item.categoryName = matchedCat.name;
        item.matchedCategoryName = matchedCat.name;
        item.matchedCategoryId = matchedCat.id;
      }
      if (!item.description && rawDesc) item.description = rawDesc;
      brandList.forEach(b => item.brands.add(b));
      if (warnings.length > 0) item.warnings.push(...warnings);
    }
  }

  if (productsToProcess.size === 0) {
    throw new Error('Tidak ada baris data produk yang valid untuk diimpor');
  }

  let totalBrands = 0;
  let newProductsCount = 0;
  let existingProductsCount = 0;
  let missingCategoryCount = 0;

  for (const item of productsToProcess.values()) {
    const brandsArr = Array.from(item.brands);
    totalBrands += brandsArr.length;
    if (item.isExisting) {
      existingProductsCount++;
    } else {
      newProductsCount++;
    }
    if (!item.matchedCategoryId) {
      missingCategoryCount++;
    }

    previewItems.push({
      name: item.name,
      categoryName: item.matchedCategoryName || item.categoryName || 'Tanpa Kategori Induk',
      matchedCategoryName: item.matchedCategoryName,
      matchedCategoryId: item.matchedCategoryId,
      brands: brandsArr,
      description: item.description,
      isExisting: item.isExisting,
      warnings: Array.from(new Set(item.warnings))
    });
  }

  return {
    rawRowsCount: rawRows.length,
    detectedColumns: {
      category: categoryKey || null,
      product: productKey || null,
      brand: brandKey || null,
      description: descKey || null
    },
    summary: {
      totalRows: rawRows.length,
      totalProducts: productsToProcess.size,
      newProducts: newProductsCount,
      existingProducts: existingProductsCount,
      totalBrands,
      missingCategoryCount
    },
    items: previewItems,
    productsToProcess,
    existingProductMap
  };
};

// Preview Excel File Before Import
const previewExcel = async (req, res, next) => {
  try {
    const branchId = req.branchId || req.headers['x-branch-id'] || req.body.branch_id;
    if (!branchId) {
      return res.status(400).json({
        success: false,
        message: 'Branch ID wajib disertakan'
      });
    }

    if (!req.file || !req.file.buffer) {
      return res.status(400).json({
        success: false,
        message: 'File Excel wajib diunggah'
      });
    }

    const targetCategoryId = req.body.target_category_id || req.query.target_category_id || null;
    const result = await parseProductExcel(req.file.buffer, branchId, targetCategoryId);
    res.json({
      success: true,
      message: 'Preview data berhasil dianalisa',
      data: {
        detectedColumns: result.detectedColumns,
        summary: result.summary,
        items: result.items
      }
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: error.message || 'Gagal menganalisa file Excel'
    });
  }
};

// Import Excel File to Products & Brands
const importExcel = async (req, res, next) => {
  try {
    const branchId = req.branchId || req.headers['x-branch-id'] || req.body.branch_id;
    if (!branchId) {
      return res.status(400).json({
        success: false,
        message: 'Branch ID wajib disertakan'
      });
    }

    if (!req.file || !req.file.buffer) {
      return res.status(400).json({
        success: false,
        message: 'File Excel wajib diunggah'
      });
    }

    const targetCategoryId = req.body.target_category_id || req.query.target_category_id || null;
    const { productsToProcess, existingProductMap, summary } = await parseProductExcel(req.file.buffer, branchId, targetCategoryId);

    // Enforce that all products MUST have a parent category!
    if (summary.missingCategoryCount > 0) {
      return res.status(400).json({
        success: false,
        message: `Terdapat ${summary.missingCategoryCount} produk tanpa Kategori Induk. Produk tidak dapat diimpor tanpa Kategori Induk. Silakan tentukan Kategori Induk tujuan.`
      });
    }

    let productsCreated = 0;
    let productsUpdated = 0;
    let brandsCreated = 0;
    let brandsSkipped = 0;

    for (const [lowerProd, item] of productsToProcess.entries()) {
      const categoryId = item.matchedCategoryId;
      if (!categoryId) {
        return res.status(400).json({
          success: false,
          message: `Produk "${item.name}" tidak memiliki Kategori Induk. Semua produk wajib memiliki Kategori Induk.`
        });
      }

      let productId = null;

      if (existingProductMap.has(lowerProd)) {
        const existing = existingProductMap.get(lowerProd);
        productId = existing.id;
        // Update description if previously empty
        if (item.description && !existing.description) {
          await query(`UPDATE products SET description = ? WHERE id = ?`, [item.description, productId]);
        }
        // Update category if previously empty or changed
        if (categoryId && (!existing.category_id || existing.category_id !== categoryId)) {
          await query(`UPDATE products SET category_id = ? WHERE id = ?`, [categoryId, productId]);
        }
        productsUpdated++;
      } else {
        const insertRes = await query(
          `INSERT INTO products (branch_id, category_id, name, description, is_active, status_deleted)
           VALUES (?, ?, ?, ?, 1, 0)`,
          [parseInt(branchId), categoryId, item.name.slice(0, 255), item.description || null]
        );
        productId = insertRes.insertId;
        existingProductMap.set(lowerProd, { id: productId, lower_name: lowerProd, name: item.name, category_id: categoryId });
        productsCreated++;
      }

      // Handle brands
      if (item.brands.size > 0 && productId) {
        const existingBrands = await query(
          `SELECT id, LOWER(name) as lower_name FROM product_brands WHERE product_id = ? AND status_deleted = 0`,
          [productId]
        );
        const existingBrandSet = new Set(existingBrands.map(b => b.lower_name.trim()));

        for (const brandName of item.brands) {
          const safeBrand = brandName.slice(0, 255);
          const lowerBrand = safeBrand.toLowerCase();
          if (!existingBrandSet.has(lowerBrand)) {
            await query(
              `INSERT INTO product_brands (product_id, name, description, is_active, status_deleted)
               VALUES (?, ?, NULL, 1, 0)`,
              [productId, safeBrand]
            );
            existingBrandSet.add(lowerBrand);
            brandsCreated++;
          } else {
            brandsSkipped++;
          }
        }
      }
    }

    res.json({
      success: true,
      message: `Impor berhasil: ${productsCreated} produk baru dibuat, ${productsUpdated} produk diperbarui, dan ${brandsCreated} merek ditambahkan.`,
      data: {
        totalProducts: productsToProcess.size,
        productsCreated,
        productsUpdated,
        brandsCreated,
        brandsSkipped
      }
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getProducts,
  getProductById,
  createProduct,
  updateProduct,
  deleteProduct,
  restoreProduct,
  addBrand,
  updateBrand,
  deleteBrand,
  bulkDeleteProducts,
  deleteProductsByCategory,
  bulkAssignCategory,
  downloadTemplate,
  previewExcel,
  importExcel
};


