const { query } = require('../config/database');

class Product {
  // Find all products for a branch with their brands
  static async findAll({ branchId, categoryId, includeInactive = false, onlyDeleted = false } = {}) {
    if (!branchId) return [];

    const parsedBranchId = parseInt(branchId);

    let sql = `
      SELECT p.*,
        c.name AS category_name,
        c.code AS category_code,
        (
          SELECT COUNT(*)
          FROM transaction_product_items tpi
          JOIN transactions t ON tpi.transaction_id = t.id
          WHERE tpi.product_id = p.id
            AND t.branch_id = p.branch_id
            AND t.status_deleted = 0
        ) AS transaction_count,
        (
          SELECT COUNT(*)
          FROM product_brands pb
          WHERE pb.product_id = p.id
            AND pb.status_deleted = 0
        ) AS brand_count
      FROM products p
      LEFT JOIN categories c ON p.category_id = c.id
      WHERE p.branch_id = ?
    `;
    const params = [parsedBranchId];

    if (categoryId) {
      sql += ' AND (p.category_id = ? OR c.parent_id = ?)';
      params.push(parseInt(categoryId), parseInt(categoryId));
    }

    if (onlyDeleted) {
      sql += ' AND p.status_deleted = 1';
    } else {
      sql += ' AND p.status_deleted = 0';
    }

    if (!includeInactive && !onlyDeleted) {
      sql += ' AND p.is_active = 1';
    }

    sql += ' ORDER BY p.name ASC';
    const products = await query(sql, params);

    // Fetch brands for each product
    if (products.length > 0) {
      const productIds = products.map(p => p.id);
      let brandSql = `
        SELECT pb.*
        FROM product_brands pb
        WHERE pb.product_id IN (${productIds.map(() => '?').join(',')})
      `;
      const brandParams = [...productIds];

      if (onlyDeleted) {
        brandSql += ' AND pb.status_deleted = 1';
      } else {
        brandSql += ' AND pb.status_deleted = 0';
      }

      if (!includeInactive && !onlyDeleted) {
        brandSql += ' AND pb.is_active = 1';
      }

      brandSql += ' ORDER BY pb.name ASC';
      const allBrands = await query(brandSql, brandParams);

      const brandsByProduct = {};
      for (const brand of allBrands) {
        if (!brandsByProduct[brand.product_id]) {
          brandsByProduct[brand.product_id] = [];
        }
        brandsByProduct[brand.product_id].push(brand);
      }

      for (const p of products) {
        p.brands = brandsByProduct[p.id] || [];
      }
    }

    return products;
  }

  // Find by ID
  static async findById(id) {
    const results = await query(
      `SELECT p.*,
        c.name AS category_name,
        c.code AS category_code,
        (
          SELECT COUNT(*)
          FROM transaction_product_items tpi
          JOIN transactions t ON tpi.transaction_id = t.id
          WHERE tpi.product_id = p.id
            AND t.branch_id = p.branch_id
            AND t.status_deleted = 0
        ) AS transaction_count,
        (
          SELECT COUNT(*)
          FROM product_brands pb
          WHERE pb.product_id = p.id
            AND pb.status_deleted = 0
        ) AS brand_count
       FROM products p
       LEFT JOIN categories c ON p.category_id = c.id
       WHERE p.id = ?`,
      [id]
    );

    if (!results[0]) return null;
    const product = results[0];

    const brands = await query(
      `SELECT * FROM product_brands WHERE product_id = ? AND status_deleted = 0 ORDER BY name ASC`,
      [id]
    );
    product.brands = brands;

    return product;
  }

  // Create new product
  static async create({ branchId, categoryId = null, name, description = null, isActive = true }) {
    if (!branchId) {
      throw new Error('branch_id is required');
    }
    const trimmedName = name.trim();
    // Check for duplicate product name in this branch
    const existing = await query(
      `SELECT id, name FROM products WHERE branch_id = ? AND LOWER(name) = LOWER(?) AND status_deleted = 0 LIMIT 1`,
      [parseInt(branchId), trimmedName]
    );
    if (existing.length > 0) {
      throw new Error(`Produk "${existing[0].name}" sudah terdaftar di katalog cabang ini. Silakan pilih produk tersebut untuk menambahkan merek.`);
    }

    const parsedCategoryId = categoryId ? parseInt(categoryId) : null;
    const result = await query(
      `INSERT INTO products (branch_id, category_id, name, description, is_active, status_deleted)
       VALUES (?, ?, ?, ?, ?, 0)`,
      [parseInt(branchId), parsedCategoryId, trimmedName, description ? description.trim() : null, isActive ? 1 : 0]
    );
    return await this.findById(result.insertId);
  }

  // Update product
  static async update(id, { categoryId, name, description, isActive }) {
    const updates = [];
    const params = [];

    if (categoryId !== undefined) {
      updates.push('category_id = ?');
      params.push(categoryId ? parseInt(categoryId) : null);
    }
    if (name !== undefined) {
      const trimmedName = name.trim();
      const existing = await query(
        `SELECT id, name FROM products WHERE branch_id = (SELECT branch_id FROM products WHERE id = ?) AND LOWER(name) = LOWER(?) AND id != ? AND status_deleted = 0 LIMIT 1`,
        [id, trimmedName, id]
      );
      if (existing.length > 0) {
        throw new Error(`Produk "${existing[0].name}" sudah terdaftar di katalog cabang ini.`);
      }
      updates.push('name = ?');
      params.push(trimmedName);
    }
    if (description !== undefined) {
      updates.push('description = ?');
      params.push(description ? description.trim() : null);
    }
    if (isActive !== undefined) {
      updates.push('is_active = ?');
      params.push(isActive ? 1 : 0);
    }

    if (updates.length > 0) {
      params.push(id);
      await query(
        `UPDATE products SET ${updates.join(', ')} WHERE id = ?`,
        params
      );
    }

    return await this.findById(id);
  }

  // Soft delete product
  static async softDelete(id) {
    await query(
      `UPDATE products SET status_deleted = 1, deleted_at = NOW() WHERE id = ?`,
      [id]
    );
    return true;
  }

  // Restore soft deleted product
  static async restore(id) {
    await query(
      `UPDATE products SET status_deleted = 0, deleted_at = NULL WHERE id = ?`,
      [id]
    );
    return await this.findById(id);
  }

  // Brand Management: Add brand to product
  static async addBrand(productId, { name, description = null, isActive = true }) {
    const result = await query(
      `INSERT INTO product_brands (product_id, name, description, is_active, status_deleted)
       VALUES (?, ?, ?, ?, 0)`,
      [parseInt(productId), name.trim(), description ? description.trim() : null, isActive ? 1 : 0]
    );
    const rows = await query('SELECT * FROM product_brands WHERE id = ?', [result.insertId]);
    return rows[0] || null;
  }

  // Brand Management: Update brand
  static async updateBrand(brandId, { name, description, isActive }) {
    const updates = [];
    const params = [];

    if (name !== undefined) {
      updates.push('name = ?');
      params.push(name.trim());
    }
    if (description !== undefined) {
      updates.push('description = ?');
      params.push(description ? description.trim() : null);
    }
    if (isActive !== undefined) {
      updates.push('is_active = ?');
      params.push(isActive ? 1 : 0);
    }

    if (updates.length > 0) {
      params.push(brandId);
      await query(
        `UPDATE product_brands SET ${updates.join(', ')} WHERE id = ?`,
        params
      );
    }

    const rows = await query('SELECT * FROM product_brands WHERE id = ?', [brandId]);
    return rows[0] || null;
  }

  // Brand Management: Soft delete brand
  static async deleteBrand(brandId) {
    await query(
      `UPDATE product_brands SET status_deleted = 1, deleted_at = NOW() WHERE id = ?`,
      [brandId]
    );
    return true;
  }
}

module.exports = Product;
