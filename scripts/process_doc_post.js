import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mammoth from 'mammoth';
import sharp from 'sharp';
import { execSync } from 'child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const blogContentDir = path.resolve(projectRoot, 'src/content/blog');
const publicImagesDir = path.resolve(projectRoot, 'public/images');

/**
 * Optimizes an image buffer/file into lightweight, high-clarity WebP
 */
export async function optimizeImage(inputBufferOrPath, outputFilename) {
  const outputPath = path.resolve(publicImagesDir, outputFilename);
  
  await sharp(inputBufferOrPath)
    .rotate() // auto-orient based on EXIF
    .resize({ width: 1600, withoutEnlargement: true })
    .modulate({ brightness: 1.02, saturation: 1.05 }) // subtle enhancement for travel vibrancy
    .webp({ quality: 82, effort: 6 })
    .toFile(outputPath);

  const stats = fs.statSync(outputPath);
  console.log(`📸 Image optimized & converted: ${outputFilename} (${Math.round(stats.size / 1024)} KB)`);
  return `/images/${outputFilename}`;
}

/**
 * Extracts raw text, headings, and images from a Word .docx file
 */
export async function parseDocx(docxPath) {
  const extractedImages = [];
  const options = {
    convertImage: mammoth.images.imgElement(function(image) {
      return image.read("binary").then(function(imageBuffer) {
        extractedImages.push({
          buffer: Buffer.from(imageBuffer, 'binary'),
          contentType: image.contentType
        });
        return { src: `[EXTRACTED_IMAGE_${extractedImages.length - 1}]` };
      });
    })
  };

  const result = await mammoth.convertToMarkdown({ path: docxPath }, options);
  return {
    rawMarkdown: result.value,
    warnings: result.messages,
    images: extractedImages
  };
}

/**
 * Deploys the site live to GitHub production branch for Hostinger
 */
export function deploySite() {
  console.log('🚀 Running deploy to oialens.com (Hostinger)...');
  execSync('npm run deploy', { cwd: projectRoot, stdio: 'inherit' });
}

export { projectRoot, blogContentDir, publicImagesDir };
