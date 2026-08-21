const { query } = require('../config/database');

class BankAccount {
  static async findAll(branchId, type = null) {
    let sql = `
      SELECT 
        ba.*,
        CAST(
          CASE 
            WHEN ba.type = 'operational' THEN NULL
            ELSE
              COALESCE(
                (SELECT SUM(saa.allocated_amount)
                 FROM savings_account_allocations saa
                 JOIN categories c ON saa.category_id = c.id
                 WHERE saa.bank_account_id = ba.id 
                   AND c.status_deleted = false
                   AND c.branch_id = ba.branch_id),
                0
              )
          END AS DECIMAL(15, 2)
        ) AS balance
      FROM bank_accounts ba
      WHERE ba.branch_id = ? AND ba.is_active = 1
    `;
    const params = [branchId];

    if (type) {
      sql += ' AND ba.type = ?';
      params.push(type);
    }

    sql += ' ORDER BY ba.name ASC';
    return await query(sql, params);
  }

  static async findById(id) {
    const results = await query(
      `SELECT 
        ba.*,
        CAST(
          CASE 
            WHEN ba.type = 'operational' THEN NULL
            ELSE
              COALESCE(
                (SELECT SUM(saa.allocated_amount)
                 FROM savings_account_allocations saa
                 JOIN categories c ON saa.category_id = c.id
                 WHERE saa.bank_account_id = ba.id 
                   AND c.status_deleted = false
                   AND c.branch_id = ba.branch_id),
                0
              )
          END AS DECIMAL(15, 2)
        ) AS balance
      FROM bank_accounts ba
      WHERE ba.id = ?`,
      [id]
    );
    return results[0] || null;
  }

  static async create({ name, branchId, type = 'savings' }) {
    const validTypes = ['savings', 'operational'];
    const selectedType = validTypes.includes(type) ? type : 'savings';

    const result = await query(
      'INSERT INTO bank_accounts (name, branch_id, type) VALUES (?, ?, ?)',
      [name, branchId, selectedType]
    );
    return await this.findById(result.insertId);
  }

  static async update(id, { name, type }) {
    const updates = [];
    const params = [];

    if (name !== undefined) {
      updates.push('name = ?');
      params.push(name);
    }

    if (type !== undefined) {
      const validTypes = ['savings', 'operational'];
      if (validTypes.includes(type)) {
        updates.push('type = ?');
        params.push(type);
      }
    }

    if (updates.length > 0) {
      params.push(id);
      await query(
        `UPDATE bank_accounts SET ${updates.join(', ')} WHERE id = ?`,
        params
      );
    }

    return await this.findById(id);
  }

  static async delete(id) {
    return await query('DELETE FROM bank_accounts WHERE id = ?', [id]);
  }
}

module.exports = BankAccount;
