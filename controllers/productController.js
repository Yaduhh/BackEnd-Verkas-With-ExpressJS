const Product = require('../models/Product');

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

module.exports = {
  getProducts,
  getProductById,
  createProduct,
  updateProduct,
  deleteProduct,
  restoreProduct,
  addBrand,
  updateBrand,
  deleteBrand
};
