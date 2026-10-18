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

    // Read Excel from buffer using xlsx
    const workbook = xlsx.read(req.file.buffer, { type: 'buffer' });
    const firstSheetName = workbook.SheetNames[0];
    if (!firstSheetName) {
      return res.status(400).json({
        success: false,
        message: 'File Excel kosong atau tidak memiliki sheet'
      });
    }

    const worksheet = workbook.Sheets[firstSheetName];
    const rawRows = xlsx.utils.sheet_to_json(worksheet, { defval: '' });

    if (!rawRows || rawRows.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Tidak ada data yang ditemukan di dalam file Excel'
      });
    }

    // Identify column keys
    const firstRow = rawRows[0];
    const keys = Object.keys(firstRow);

    const categoryKey = keys.find(k => /kategori|category/i.test(k));
    const productKey = keys.find(k => /nama.*produk|produk|product.*name|nama.*barang|barang/i.test(k));
    const brandKey = keys.find(k => /merek|merk|brand|varian/i.test(k));
    const descKey = keys.find(k => /keterangan|deskripsi|catatan|note|description/i.test(k));

    if (!productKey) {
      return res.status(400).json({
        success: false,
        message: 'Kolom "Nama Produk" tidak ditemukan dalam file Excel. Silakan gunakan template yang telah disediakan.'
      });
    }

    // Fetch existing categories to match category name -> category id
    const categories = await query(
      `SELECT id, name, type FROM categories WHERE status_deleted = 0 OR status_deleted IS NULL`
    );
    const categoryMap = new Map();
    for (const cat of categories) {
      if (cat.name) {
        categoryMap.set(cat.name.trim().toLowerCase(), cat.id);
      }
    }

    // Default category fallback (e.g. Bahan Baku or first available category)
    const defaultCat = categories.find(c => /bahan\s*baku/i.test(c.name)) || categories[0];

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
    for (const row of rawRows) {
      const rawProductName = (row[productKey] || '').toString().trim();
      if (!rawProductName) continue; // Skip blank product names

      const lowerProd = rawProductName.toLowerCase();
      const rawCategory = categoryKey ? (row[categoryKey] || '').toString().trim() : '';
      const rawBrands = brandKey ? (row[brandKey] || '').toString().trim() : '';
      const rawDesc = descKey ? (row[descKey] || '').toString().trim() : '';

      // Split brands by comma, semicolon, newline, slash, or pipe
      const brandList = rawBrands
        ? rawBrands.split(/[,;\n|/]+/).map(b => b.trim()).filter(Boolean)
        : [];

      if (!productsToProcess.has(lowerProd)) {
        productsToProcess.set(lowerProd, {
          name: rawProductName,
          categoryName: rawCategory,
          description: rawDesc,
          brands: new Set(brandList)
        });
      } else {
        const item = productsToProcess.get(lowerProd);
        if (!item.categoryName && rawCategory) item.categoryName = rawCategory;
        if (!item.description && rawDesc) item.description = rawDesc;
        brandList.forEach(b => item.brands.add(b));
      }
    }

    if (productsToProcess.size === 0) {
      return res.status(400).json({
        success: false,
        message: 'Tidak ada baris data produk yang valid untuk diimpor'
      });
    }

    let productsCreated = 0;
    let productsUpdated = 0;
    let brandsCreated = 0;
    let brandsSkipped = 0;

    for (const [lowerProd, item] of productsToProcess.entries()) {
      let categoryId = null;
      if (item.categoryName) {
        categoryId = categoryMap.get(item.categoryName.toLowerCase()) || null;
      }
      if (!categoryId && defaultCat) {
        categoryId = defaultCat.id;
      }

      let productId = null;
      if (existingProductMap.has(lowerProd)) {
        const existing = existingProductMap.get(lowerProd);
        productId = existing.id;
        // Update description if previously empty
        if (item.description && !existing.description) {
          await query(`UPDATE products SET description = ? WHERE id = ?`, [item.description, productId]);
        }
        // Update category if previously empty
        if (categoryId && !existing.category_id) {
          await query(`UPDATE products SET category_id = ? WHERE id = ?`, [categoryId, productId]);
        }
        productsUpdated++;
      } else {
        const insertRes = await query(
          `INSERT INTO products (branch_id, category_id, name, description, is_active, status_deleted)
           VALUES (?, ?, ?, ?, 1, 0)`,
          [parseInt(branchId), categoryId, item.name, item.description || null]
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
          const lowerBrand = brandName.toLowerCase();
          if (!existingBrandSet.has(lowerBrand)) {
            await query(
              `INSERT INTO product_brands (product_id, name, description, is_active, status_deleted)
               VALUES (?, ?, NULL, 1, 0)`,
              [productId, brandName]
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
  downloadTemplate,
  importExcel
};

