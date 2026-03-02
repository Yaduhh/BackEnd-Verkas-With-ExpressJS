const upload = require('../middleware/upload');
const path = require('path');
const fs = require('fs');
const sharp = require('sharp');
const config = require('../config/config');

// Helper function to compress single image
const compressImage = async (filePath, originalSize) => {
  try {
    const ext = path.extname(filePath).toLowerCase();
    const nameWithoutExt = path.basename(filePath, ext);
    const dir = path.dirname(filePath);

    // Determine output format
    // Force webp for most cases; keep png if alpha channel
    let outputFormat = 'webp';
    let outputExt = '.webp';

    const metadata = await sharp(filePath).metadata();
    if (metadata.format === 'png' && metadata.hasAlpha) {
      outputFormat = 'png';
      outputExt = '.png';
    }

    // Always use a temporary file name to avoid "same file for input and output" error
    const tempPath = path.join(dir, `${nameWithoutExt}_compressed_${Date.now()}${outputExt}`);
    const isFormatChanged = outputExt !== ext;

    let sharpInstance = sharp(filePath);

    // Resize if image is too large (max width 1280px, maintain aspect ratio)
    sharpInstance = sharpInstance.resize(1280, null, {
      withoutEnlargement: true,
      fit: 'inside'
    });

    // Apply compression based on format
    if (outputFormat === 'jpeg') {
      await sharpInstance
        .jpeg({
          quality: 70,
          progressive: true,
          mozjpeg: true
        })
        .toFile(tempPath);
    } else if (outputFormat === 'webp') {
      await sharpInstance
        .webp({
          quality: 70,
          effort: 4
        })
        .toFile(tempPath);
    } else if (outputFormat === 'png') {
      await sharpInstance
        .png({
          quality: 70,
          compressionLevel: 9
        })
        .toFile(tempPath);
    }

    const compressedStats = fs.statSync(tempPath);
    const finalSize = compressedStats.size;

    // Replace original with compressed version if it's smaller
    if (finalSize < originalSize || isFormatChanged) {
      // Delete original file
      fs.unlinkSync(filePath);

      // Determine final path
      const finalPath = isFormatChanged
        ? path.join(dir, `${nameWithoutExt}${outputExt}`)
        : filePath;

      // Move temp file to final location
      fs.renameSync(tempPath, finalPath);

      return {
        path: finalPath,
        filename: path.basename(finalPath),
        mimetype: isFormatChanged ? `image/${outputFormat}` : (metadata.format === 'png' ? 'image/png' : 'image/jpeg'),
        size: finalSize,
        originalSize: originalSize,
        compressed: true
      };
    } else {
      // Compression didn't help, keep original
      fs.unlinkSync(tempPath);
      return {
        path: filePath,
        filename: path.basename(filePath),
        mimetype: metadata.format === 'png' ? 'image/png' : 'image/jpeg',
        size: originalSize,
        originalSize: originalSize,
        compressed: false
      };
    }
  } catch (error) {
    console.error('Image compression error:', error);
    // Return original file info if compression fails
    return {
      path: filePath,
      filename: path.basename(filePath),
      mimetype: 'image/jpeg', // fallback
      size: originalSize,
      originalSize: originalSize,
      compressed: false
    };
  }
};

// Single file upload (for backward compatibility)
const uploadFile = async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'No file uploaded'
      });
    }

    const filePath = req.file.path;
    const originalSize = req.file.size;
    let finalFilename = req.file.filename;
    let finalMimetype = req.file.mimetype;
    let finalSize = originalSize;
    let originalSizeForResponse = originalSize;
    let compressed = false;

    // Compress images automatically using Sharp
    const isImage = req.file.mimetype.startsWith('image/');
    if (isImage) {
      const result = await compressImage(filePath, originalSize);
      finalFilename = result.filename;
      finalMimetype = result.mimetype;
      finalSize = result.size;
      originalSizeForResponse = result.originalSize;
      compressed = result.compressed;
    }

    // Build organized path: uploads/{branchId}/{type}/{filename}
    const categoryId = req.query?.categoryId;
    const subCategoryId = req.query?.subCategoryId;

    let pathParts = ['uploads', branchId.toString(), typeFolder];
    if (categoryId) {
      pathParts.push(categoryId.toString());
      if (subCategoryId) {
        pathParts.push(subCategoryId.toString());
      }
    }
    pathParts.push(finalFilename);

    const relativePath = `/${pathParts.join('/')}`;
    const baseUrl = config.baseUrl || `${req.protocol}://${req.get('host')}`;

    res.json({
      success: true,
      message: 'File uploaded successfully',
      data: {
        filename: finalFilename,
        originalname: req.file.originalname,
        mimetype: finalMimetype,
        size: finalSize,
        originalSize: isImage ? originalSizeForResponse : undefined,
        compressed: isImage ? compressed : undefined,
        compressionRatio: isImage && compressed && originalSizeForResponse > 0
          ? Math.round((1 - finalSize / originalSizeForResponse) * 100)
          : undefined,
        path: relativePath,
        url: `${baseUrl}${relativePath}`
      }
    });
  } catch (error) {
    next(error);
  }
};

// Multiple files upload
const uploadFiles = async (req, res, next) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No files uploaded'
      });
    }

    const uploadedFiles = [];

    // Build organized path: uploads/{branchId}/{type}/{filename}
    const branchId = req.headers['x-branch-id'] || req.branchId || 'unknown';
    const rawType = req.query?.type || 'expense';
    const typeFolder = rawType === 'income' ? 'pemasukan' : 'pengeluaran';

    const isPb1 = req.query?.isPb1 === 'true';
    const categoryId = req.query?.categoryId;
    const subCategoryId = req.query?.subCategoryId;

    let basePathParts = ['uploads', branchId.toString(), typeFolder];
    if (isPb1) {
      basePathParts.push('pb1');
    } else if (categoryId) {
      basePathParts.push(categoryId.toString());
      if (subCategoryId) {
        basePathParts.push(subCategoryId.toString());
      }
    }
    const baseUrl = config.baseUrl || `${req.protocol}://${req.get('host')}`;

    for (const file of req.files) {
      const filePath = file.path;
      const originalSize = file.size;
      let finalFilename = file.filename;
      let finalMimetype = file.mimetype;
      let finalSize = originalSize;
      let originalSizeForResponse = originalSize;
      let compressed = false;

      const isImage = file.mimetype.startsWith('image/');
      if (isImage) {
        const result = await compressImage(filePath, originalSize);
        finalFilename = result.filename;
        finalMimetype = result.mimetype;
        finalSize = result.size;
        originalSizeForResponse = result.originalSize;
        compressed = result.compressed;
      }

      const relativePath = `/${[...basePathParts, finalFilename].join('/')}`;

      uploadedFiles.push({
        filename: finalFilename,
        originalname: file.originalname,
        mimetype: finalMimetype,
        size: finalSize,
        originalSize: isImage ? originalSizeForResponse : undefined,
        compressed: isImage ? compressed : undefined,
        compressionRatio: isImage && compressed && originalSizeForResponse > 0
          ? Math.round((1 - finalSize / originalSizeForResponse) * 100)
          : undefined,
        path: relativePath,
        url: `${baseUrl}${relativePath}`
      });
    }

    // Return files info
    res.json({
      success: true,
      message: 'Files uploaded successfully',
      data: {
        files: uploadedFiles,
        count: uploadedFiles.length
      }
    });
  } catch (error) {
    next(error);
  }
};

const getFile = async (req, res, next) => {
  try {
    // Support nested path: /uploads/branchId/type/filename
    const nestedPath = req.params[0] || req.params.filename || '';
    const filePath = path.join(__dirname, '../uploads', nestedPath);

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({
        success: false,
        message: 'File not found'
      });
    }

    res.sendFile(filePath);
  } catch (error) {
    next(error);
  }
};

// Delete file
const deleteFile = async (req, res, next) => {
  try {
    const { filename } = req.params;
    const filePath = path.join(__dirname, '../uploads', filename);

    // Check if file exists
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({
        success: false,
        message: 'File not found'
      });
    }

    // Delete file
    fs.unlinkSync(filePath);

    res.json({
      success: true,
      message: 'File deleted successfully'
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  uploadFile: [upload.single('file'), uploadFile],
  uploadFiles: [upload.array('files'), uploadFiles], // No file count limit
  getFile,
  deleteFile
};

