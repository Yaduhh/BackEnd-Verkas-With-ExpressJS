const { pdfToPng } = require('pdf-to-png-converter');
const sharp = require('sharp');
const fs = require('fs');

/**
 * Converts a PDF file to a single JPEG image buffer (combines multiple pages vertically).
 * @param {string} pdfPath - Path to the temporary PDF file.
 * @returns {Promise<Buffer>} - JPEG image buffer.
 */
async function exportPDFToJPEG(pdfPath) {
  if (!fs.existsSync(pdfPath)) {
    throw new Error('PDF file does not exist');
  }

  // Convert PDF pages to PNG buffers at Ultra HD scale (5x = ~360 DPI)
  const pages = await pdfToPng(pdfPath, {
    viewportScale: 5.0, // Ultra HD 5x render so text & numbers are razor-sharp
    returnPageContent: true
  });

  if (!pages || pages.length === 0) {
    throw new Error('No pages rendered from PDF');
  }

  // Trim each page individually first to remove empty top/bottom space on each sheet
  const trimmedPages = await Promise.all(
    pages.map(async (page) => {
      return await sharp(page.content, { limitInputPixels: false })
        .trim({ background: '#ffffff', threshold: 10 })
        .sharpen({ sigma: 0.65, m1: 0.8, m2: 1.5 })
        .png({ compressionLevel: 1 })
        .toBuffer();
    })
  );

  const marginSize = 95;
  const jpegOptions = {
    quality: 100,
    chromaSubsampling: '4:4:4', // Prevent color subsampling blur on colored text/numbers
    mozjpeg: false
  };

  // If only 1 page, directly convert PNG to JPEG and add margins
  if (trimmedPages.length === 1) {
    return await sharp(trimmedPages[0], { limitInputPixels: false })
      .extend({
        top: marginSize,
        bottom: marginSize,
        left: marginSize,
        right: marginSize,
        background: { r: 255, g: 255, b: 255, alpha: 1 }
      })
      .jpeg(jpegOptions)
      .toBuffer();
  }

  // If multiple pages, retrieve their dimensions after trimming
  const pageMetas = await Promise.all(
    trimmedPages.map(async (buffer) => {
      const metadata = await sharp(buffer, { limitInputPixels: false }).metadata();
      return {
        buffer,
        width: metadata.width,
        height: metadata.height
      };
    })
  );

  const maxWidth = Math.max(...pageMetas.map(p => p.width));
  // Add a small spacing gap between pages so they flow naturally
  const pageGap = 60;
  const totalHeight = pageMetas.reduce((sum, p) => sum + p.height, 0) + (pageMetas.length - 1) * pageGap;

  let currentY = 0;
  const compositeArray = pageMetas.map((pageMeta) => {
    const compositeObj = {
      input: pageMeta.buffer,
      top: currentY,
      left: Math.round((maxWidth - pageMeta.width) / 2) // Center horizontally
    };
    currentY += pageMeta.height + pageGap;
    return compositeObj;
  });

  const combinedPng = await sharp({
    create: {
      width: maxWidth,
      height: totalHeight,
      channels: 4,
      background: { r: 255, g: 255, b: 255, alpha: 1 }
    },
    limitInputPixels: false
  })
    .composite(compositeArray)
    .png({ compressionLevel: 1 })
    .toBuffer();

  // Add final margins around the combined image
  return await sharp(combinedPng, { limitInputPixels: false })
    .extend({
      top: marginSize,
      bottom: marginSize,
      left: marginSize,
      right: marginSize,
      background: { r: 255, g: 255, b: 255, alpha: 1 }
    })
    .jpeg(jpegOptions)
    .toBuffer();
}

module.exports = {
  exportPDFToJPEG
};
