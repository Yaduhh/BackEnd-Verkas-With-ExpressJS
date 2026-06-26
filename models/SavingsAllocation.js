const { query, transaction: dbTransaction } = require('../config/database');

class SavingsAllocation {
  static async findAllByCategoryId(categoryId, branchId = null) {
    let sql = `
      SELECT 
        ba.id as bank_account_id,
        ba.name as bank_account_name,
        COALESCE(saa.allocated_amount, 0.00) as allocated_amount,
        saa.id as allocation_id
      FROM bank_accounts ba
      LEFT JOIN savings_account_allocations saa ON ba.id = saa.bank_account_id AND saa.category_id = ?
      WHERE ba.is_active = 1
    `;
    const params = [categoryId];
    
    if (branchId) {
      sql += ' AND ba.branch_id = ?';
      params.push(branchId);
    }
    
    sql += ' ORDER BY ba.name ASC';
    return await query(sql, params);
  }

  static async updateAllocations(categoryId, allocations) {
    // allocations is an array: [{ bank_account_id: number, allocated_amount: number }]
    return await dbTransaction(async (conn) => {
      // 1. Delete all existing allocations for this category
      await conn.execute(
        'DELETE FROM savings_account_allocations WHERE category_id = ?',
        [categoryId]
      );

      // 2. Insert new allocations (only if allocated_amount > 0 to save space, or all of them)
      const validAllocations = allocations.filter(a => parseFloat(a.allocated_amount) !== 0);
      
      for (const allocation of validAllocations) {
        await conn.execute(
          `INSERT INTO savings_account_allocations (category_id, bank_account_id, allocated_amount)
           VALUES (?, ?, ?)`,
          [categoryId, allocation.bank_account_id, allocation.allocated_amount]
        );
      }
      
      return true;
    });
  }
}

module.exports = SavingsAllocation;
