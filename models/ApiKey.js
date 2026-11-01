const { query } = require('../config/database');
const crypto = require('crypto');

class ApiKey {
  // Generate random API key with prefix vk_live_
  static generateKey() {
    return 'vk_live_' + crypto.randomBytes(24).toString('hex');
  }

  // Find active API key by raw key string
  static async findByKey(apiKey) {
    if (!apiKey) return null;
    const results = await query(
      `SELECT k.*, u.name as owner_name, u.email as owner_email, u.role as owner_role
       FROM api_keys k
       JOIN users u ON k.owner_id = u.id
       WHERE k.api_key = ? 
         AND k.is_active = 1
         AND (k.expires_at IS NULL OR k.expires_at > NOW())
         AND u.status_deleted = false`,
      [apiKey]
    );

    if (!results || results.length === 0) return null;

    const row = results[0];
    if (typeof row.scopes === 'string') {
      try {
        row.scopes = JSON.parse(row.scopes);
      } catch (e) {
        row.scopes = [];
      }
    }
    return row;
  }

  // Create API key
  static async create({ owner_id, name, branch_id = null, scopes = null, expires_at = null, api_key = null }) {
    const key = api_key || this.generateKey();
    const scopesJson = scopes ? JSON.stringify(scopes) : JSON.stringify(['transactions:create', 'meta:read']);

    const result = await query(
      `INSERT INTO api_keys (owner_id, name, api_key, branch_id, scopes, is_active, expires_at)
       VALUES (?, ?, ?, ?, ?, 1, ?)`,
      [owner_id, name, key, branch_id, scopesJson, expires_at]
    );

    return {
      id: result.insertId,
      owner_id,
      name,
      api_key: key,
      branch_id,
      scopes: JSON.parse(scopesJson),
      is_active: 1,
      expires_at
    };
  }

  // Update last used timestamp
  static async updateLastUsed(id) {
    await query(
      'UPDATE api_keys SET last_used_at = NOW() WHERE id = ?',
      [id]
    );
  }

  // Find all keys (for master / global overview)
  static async findAll() {
    const results = await query(
      `SELECT k.id, k.owner_id, k.name, k.api_key, k.branch_id, k.scopes, k.is_active, k.last_used_at, k.expires_at, k.created_at,
              u.name as owner_name, u.email as owner_email, b.name as branch_name
       FROM api_keys k
       LEFT JOIN users u ON k.owner_id = u.id
       LEFT JOIN branches b ON k.branch_id = b.id
       ORDER BY k.created_at DESC`
    );

    return results.map(row => {
      if (typeof row.scopes === 'string') {
        try { row.scopes = JSON.parse(row.scopes); } catch (e) { row.scopes = []; }
      }
      return row;
    });
  }

  // Find all keys by owner
  static async findByOwner(ownerId) {
    const results = await query(
      `SELECT k.id, k.owner_id, k.name, k.api_key, k.branch_id, k.scopes, k.is_active, k.last_used_at, k.expires_at, k.created_at,
              b.name as branch_name
       FROM api_keys k
       LEFT JOIN branches b ON k.branch_id = b.id
       WHERE k.owner_id = ?
       ORDER BY k.created_at DESC`,
      [ownerId]
    );

    return results.map(row => {
      if (typeof row.scopes === 'string') {
        try { row.scopes = JSON.parse(row.scopes); } catch (e) { row.scopes = []; }
      }
      return row;
    });
  }

  // Revoke/Deactivate key
  static async revoke(id, ownerId = null) {
    let sql = 'UPDATE api_keys SET is_active = 0 WHERE id = ?';
    const params = [id];
    if (ownerId) {
      sql += ' AND owner_id = ?';
      params.push(ownerId);
    }
    const result = await query(sql, params);
    return result.affectedRows > 0;
  }

  // Activate/Reactivate key
  static async activate(id, ownerId = null) {
    let sql = 'UPDATE api_keys SET is_active = 1 WHERE id = ?';
    const params = [id];
    if (ownerId) {
      sql += ' AND owner_id = ?';
      params.push(ownerId);
    }
    const result = await query(sql, params);
    return result.affectedRows > 0;
  }

  // Delete key
  static async delete(id, ownerId = null) {
    let sql = 'DELETE FROM api_keys WHERE id = ?';
    const params = [id];
    if (ownerId) {
      sql += ' AND owner_id = ?';
      params.push(ownerId);
    }
    const result = await query(sql, params);
    return result.affectedRows > 0;
  }
}

module.exports = ApiKey;

