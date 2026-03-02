const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Create uploads directory if it doesn't exist
const uploadsDir = path.join(__dirname, '../uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Configure storage
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    // Ambil branchId dari header yang dikirim frontend
    const branchId = req.headers['x-branch-id'] || req.branchId || 'unknown';
    // Ambil type dari query param: ?type=income atau ?type=expense
    const rawType = req.query?.type || 'expense';
    const typeFolder = rawType === 'income' ? 'pemasukan' : 'pengeluaran';

    const isPb1 = req.query?.isPb1 === 'true';
    const categoryId = req.query?.categoryId;
    const subCategoryId = req.query?.subCategoryId;

    let pathParts = [branchId.toString(), typeFolder];
    if (isPb1) {
      pathParts.push('pb1');
    } else if (categoryId) {
      pathParts.push(categoryId.toString());
      if (subCategoryId) {
        pathParts.push(subCategoryId.toString());
      }
    }

    const dir = path.join(uploadsDir, ...pathParts);
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    // Generate unique filename: timestamp-userId-originalname
    const userId = req.userId || 'unknown';
    const timestamp = Date.now();
    const ext = path.extname(file.originalname);
    const name = path.basename(file.originalname, ext).replace(/[^a-zA-Z0-9]/g, '_');
    cb(null, `${timestamp}-${userId}-${name}${ext}`);
  }
});

// File filter - allow images, videos, documents, PDFs
const fileFilter = (req, file, cb) => {
  const allowedMimes = [
    'image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp',
    'video/mp4', 'video/mpeg', 'video/quicktime', 'video/x-msvideo',
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'text/plain'
  ];

  if (allowedMimes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('File type not allowed. Allowed types: images, videos, PDF, Word, Excel, PowerPoint, and text files.'), false);
  }
};

// Configure multer
const upload = multer({
  storage: storage,
  fileFilter: fileFilter,
  limits: {
    fileSize: 500 * 1024 * 1024,
    files: undefined
  }
});

module.exports = upload;
