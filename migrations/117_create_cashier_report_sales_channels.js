module.exports = {
  up: async ({ query }) => {
    await query(`
      CREATE TABLE IF NOT EXISTS cashier_report_sales_channels (
        id INT AUTO_INCREMENT PRIMARY KEY,
        report_id INT NOT NULL,
        sales_channel_id INT NULL DEFAULT NULL,
        sales_channel_name VARCHAR(150) NOT NULL DEFAULT '',
        payment_method_id INT NULL DEFAULT NULL,
        payment_method_name VARCHAR(150) NOT NULL DEFAULT '',
        omzet_item_index INT NULL DEFAULT NULL,
        amount DECIMAL(15,2) NOT NULL DEFAULT 0,
        pb1_amount DECIMAL(15,2) NULL DEFAULT NULL,
        sort_order INT NOT NULL DEFAULT 0,
        INDEX idx_crsc_report (report_id, sort_order),
        CONSTRAINT fk_crsc_report FOREIGN KEY (report_id) REFERENCES cashier_daily_reports(id) ON DELETE CASCADE,
        CONSTRAINT fk_crsc_sc FOREIGN KEY (sales_channel_id) REFERENCES sales_channels(id) ON DELETE SET NULL,
        CONSTRAINT fk_crsc_pm FOREIGN KEY (payment_method_id) REFERENCES payment_methods(id) ON DELETE SET NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);
    console.log('  Created cashier_report_sales_channels table');
  },

  down: async ({ query }) => {
    await query(`DROP TABLE IF EXISTS cashier_report_sales_channels;`);
    console.log('  Dropped cashier_report_sales_channels table');
  }
};
