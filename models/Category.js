const { query } = require('../config/database');

class Category {
  // Find by ID
  static async findById(id) {
    const results = await query(
      `SELECT c.*, u.name as user_name 
       FROM categories c 
       LEFT JOIN users u ON c.user_id = u.id 
       WHERE c.id = ? AND c.status_deleted = false`,
      [id]
    );
    return results[0] || null;
  }
  
  // Find all (with filters)
  static async findAll({ type, userId, branchId, includeDeleted = false, onlyDeleted = false, isFolder } = {}) {
    let sql = `
      SELECT c.*, u.name as user_name 
      FROM categories c 
      LEFT JOIN users u ON c.user_id = u.id 
      WHERE 1=1
    `;
    const params = [];
    
    if (!includeDeleted && !onlyDeleted) {
      sql += ' AND c.status_deleted = false';
    } else if (onlyDeleted) {
      sql += ' AND c.status_deleted = true';
    }
    
    if (type) {
      sql += ' AND c.type = ?';
      params.push(type);
    }
    
    // Branch ID filter (if provided, show branch-specific + global categories)
    // If isFolder filter is used, only show exact branch match (no NULL)
    if (branchId !== undefined && branchId !== null) {
      if (isFolder !== undefined) {
        // For folder filter, only show exact branch match
        sql += ' AND c.branch_id = ?';
        params.push(branchId);
      } else {
        // For normal categories, show branch-specific + global
        sql += ' AND (c.branch_id = ? OR c.branch_id IS NULL)';
        params.push(branchId);
      }
    }
    
    // Jangan filter berdasarkan userId untuk kategori - kategori berdasarkan branch
    // if (userId !== undefined) {
    //   sql += ' AND (c.user_id = ? OR c.is_default = true)';
    //   params.push(userId);
    // }
    
    // Filter by is_folder (if provided)
    if (isFolder !== undefined) {
      sql += ' AND c.is_folder = ?';
      params.push(isFolder);
    }
    
    sql += ' ORDER BY c.is_default DESC, c.name ASC';
    
    return await query(sql, params);
  }
  
  // Create category
  static async create({ name, type, userId = null, branchId = null, isDefault = false, isFolder = false }) {
    const result = await query(
      `INSERT INTO categories (name, type, user_id, branch_id, is_default, is_folder, status_deleted)
       VALUES (?, ?, ?, ?, ?, ?, false)`,
      [name, type, userId, branchId, isDefault, isFolder]
    );
    return await this.findById(result.insertId);
  }
  
  // Update category
  static async update(id, { name, type, is_folder }) {
    const updates = [];
    const params = [];
    
    if (name !== undefined) {
      updates.push('name = ?');
      params.push(name);
    }
    if (type !== undefined) {
      updates.push('type = ?');
      params.push(type);
    }
    if (is_folder !== undefined) {
      updates.push('is_folder = ?');
      params.push(is_folder);
    }
    
    if (updates.length === 0) return await this.findById(id);
    
    params.push(id);
    await query(
      `UPDATE categories SET ${updates.join(', ')} WHERE id = ? AND status_deleted = false`,
      params
    );
    return await this.findById(id);
  }
  
  // Soft delete (cannot delete default categories)
  static async softDelete(id) {
    // Check if default category
    const category = await this.findById(id);
    if (category && category.is_default) {
      throw new Error('Cannot delete default category');
    }
    
    const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
    await query(
      'UPDATE categories SET status_deleted = true, deleted_at = ? WHERE id = ?',
      [now, id]
    );
    return { id, deleted_at: now };
  }
  
  // Restore
  static async restore(id) {
    await query(
      'UPDATE categories SET status_deleted = false, deleted_at = NULL WHERE id = ?',
      [id]
    );
    return await this.findById(id);
  }
  
  // Hard delete (permanent)
  static async hardDelete(id) {
    // Check if default category
    const category = await this.findById(id);
    if (category && category.is_default) {
      throw new Error('Cannot delete default category');
    }
    
    await query('DELETE FROM categories WHERE id = ?', [id]);
    return { id, deleted: true };
  }
}

module.exports = Category;

