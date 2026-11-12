import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { parseDocx, optimizeImage, deploySite, blogContentDir, publicImagesDir, projectRoot } from './process_doc_post.js';
import { execSync } from 'child_process';

const args = process.argv.slice(2);
const docFilePath = args[0];
const isNow = args.includes('--now');
const scheduleIdx = args.indexOf('--schedule');
const scheduleDate = scheduleIdx !== -1 ? args[scheduleIdx + 1] : null;

if (!docFilePath) {
  console.log('Usage: node scripts/publish_doc.js <path-to-doc> [--now] [--schedule YYYY-MM-DD]');
  process.exit(1);
}

async function run() {
  const resolvedPath = path.resolve(process.cwd(), docFilePath);
  if (!fs.existsSync(resolvedPath)) {
    console.error(`Error: File not found at ${resolvedPath}`);
    process.exit(1);
  }

  console.log(`📄 Reading and parsing: ${path.basename(resolvedPath)}...`);
  const ext = path.extname(resolvedPath).toLowerCase();
  
  let rawContent = '';
  let images = [];

  if (ext === '.docx') {
    const parsed = await parseDocx(resolvedPath);
    rawContent = parsed.rawMarkdown;
    images = parsed.images;
  } else {
    rawContent = fs.readFileSync(resolvedPath, 'utf-8');
  }

  // Derive slug and title from filename or first line
  const lines = rawContent.split('\n').map(l => l.trim()).filter(Boolean);
  let title = lines[0] ? lines[0].replace(/^#+\s*/, '') : 'Santorini Travel Guide';
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');

  console.log(`✨ Processing article: "${title}"`);

  // Optimize primary image if present
  let featuredImagePath = null;
  if (images.length > 0) {
    const imgFilename = `${slug}.webp`;
    featuredImagePath = await optimizeImage(images[0].buffer, imgFilename);
  }

  // Create clean markdown post
  const pubDate = scheduleDate ? scheduleDate : new Date().toISOString().split('T')[0];
  const postFrontmatter = `---
title: "${title.replace(/"/g, '\\"')}"
description: "${lines[1] ? lines[1].replace(/"/g, '\\"').slice(0, 155) : 'Essential tips and photography advice from Oia Lens.'}"
pubDate: ${pubDate}
author: "Oia Lens Team"
category: "Santorini Guide"
readTime: "4 min read"${featuredImagePath ? `\nimage: "${featuredImagePath}"\nimageAlt: "${title.replace(/"/g, '\\"')}"` : ''}
---

${rawContent.replace(/^#+\s*.*\n/, '')}
`;

  const targetPostPath = path.resolve(blogContentDir, `${slug}.md`);
  fs.writeFileSync(targetPostPath, postFrontmatter, 'utf-8');
  console.log(`📝 Blog post created: src/content/blog/${slug}.md`);

  // Error check & build verification
  console.log('🔍 Testing Astro build to verify zero errors...');
  execSync('npm run build', { cwd: projectRoot, stdio: 'inherit' });

  if (isNow || !scheduleDate) {
    console.log('🚀 Publishing live to oialens.com via Hostinger...');
    deploySite();
    console.log(`🎉 Article published live at: https://oialens.com/the-journal/${slug}`);
  } else {
    console.log(`⏳ Article scheduled for: ${scheduleDate}`);
  }
}

run().catch(err => {
  console.error('❌ Pipeline error:', err);
  process.exit(1);
});
