const { query } = require('../config/database');

class BankAccount {
  static async findAll(branchId) {
    return await query(
      'SELECT * FROM bank_accounts WHERE branch_id = ? AND is_active = 1 ORDER BY name ASC',
      [branchId]
    );
  }

  static async findById(id) {
    const results = await query(
      'SELECT * FROM bank_accounts WHERE id = ?',
      [id]
    );
    return results[0] || null;
  }

  static async create({ name, branchId }) {
    const result = await query(
      'INSERT INTO bank_accounts (name, branch_id) VALUES (?, ?)',
      [name, branchId]
    );
    return await this.findById(result.insertId);
  }

  static async delete(id) {
    return await query('DELETE FROM bank_accounts WHERE id = ?', [id]);
  }
}

module.exports = BankAccount;
