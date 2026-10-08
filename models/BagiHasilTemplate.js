const { query } = require('../config/database');

class BagiHasilTemplate {
  static async create({ branchId, name, templateData, isDefault = false }) {
    if (isDefault) {
      // Unset other defaults for this branch
      await query(`UPDATE bagi_hasil_templates SET is_default = 0 WHERE branch_id = ?`, [branchId]);
    }

    const dataValue = typeof templateData === 'string' ? templateData : JSON.stringify(templateData);

    const result = await query(
      `INSERT INTO bagi_hasil_templates (branch_id, name, template_data, is_default)
       VALUES (?, ?, ?, ?)`,
      [branchId, name, dataValue, isDefault ? 1 : 0]
    );

    return await this.findById(result.insertId);
  }

  static async findByBranchId(branchId) {
    const rows = await query(
      `SELECT * FROM bagi_hasil_templates
       WHERE branch_id = ?
       ORDER BY is_default DESC, created_at DESC`,
      [branchId]
    );

    return rows.map(r => {
      try {
        r.template_data = typeof r.template_data === 'string' ? JSON.parse(r.template_data) : r.template_data;
      } catch (e) {
        r.template_data = [];
      }
      return r;
    });
  }

  static async findById(id) {
    const rows = await query(
      `SELECT * FROM bagi_hasil_templates WHERE id = ? LIMIT 1`,
      [id]
    );

    if (!rows[0]) return null;
    const r = rows[0];
    try {
      r.template_data = typeof r.template_data === 'string' ? JSON.parse(r.template_data) : r.template_data;
    } catch (e) {
      r.template_data = [];
    }
    return r;
  }

  static async update(id, { name, templateData, isDefault }) {
    const current = await this.findById(id);
    if (!current) return null;

    if (isDefault) {
      await query(`UPDATE bagi_hasil_templates SET is_default = 0 WHERE branch_id = ?`, [current.branch_id]);
    }

    const updates = [];
    const params = [];

    if (name !== undefined) {
      updates.push('name = ?');
      params.push(name);
    }
    if (templateData !== undefined) {
      updates.push('template_data = ?');
      params.push(typeof templateData === 'string' ? templateData : JSON.stringify(templateData));
    }
    if (isDefault !== undefined) {
      updates.push('is_default = ?');
      params.push(isDefault ? 1 : 0);
    }

    if (updates.length > 0) {
      params.push(id);
      await query(`UPDATE bagi_hasil_templates SET ${updates.join(', ')} WHERE id = ?`, params);
    }

    return await this.findById(id);
  }

  static async delete(id) {
    await query(`DELETE FROM bagi_hasil_templates WHERE id = ?`, [id]);
  }
}

module.exports = BagiHasilTemplate;
