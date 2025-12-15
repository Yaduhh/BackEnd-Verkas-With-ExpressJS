require('dotenv').config();

module.exports = {
  // Server
  port: process.env.PORT || 3000,
  env: process.env.NODE_ENV || 'development',
  baseUrl: process.env.BASE_URL || (process.env.NODE_ENV === 'production' 
    ? 'https://verkas.bosgilserver.cloud' 
    : 'http://localhost:3000'),
  
  // JWT
  jwtSecret: process.env.JWT_SECRET || 'your-secret-key-change-in-production',
  jwtExpire: process.env.JWT_EXPIRE || '24h',
  
  // CORS
  corsOrigin: process.env.CORS_ORIGIN || 'http://localhost:19006',
  
  // Database
  db: {
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'verkas_db'
  },
  
  // Xendit
  xendit: {
    secretKey: process.env.XENDIT_SECRET_KEY,
    publicKey: process.env.XENDIT_PUBLIC_KEY,
    webhookToken: process.env.XENDIT_WEBHOOK_TOKEN
  }
};

