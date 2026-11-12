import fs from 'fs';
import path from 'path';
import * as cheerio from 'cheerio';
import TurndownService from 'turndown';
import { gfm } from 'turndown-plugin-gfm';
import { execSync } from 'child_process';
import { parseDocx, optimizeImage, deploySite, blogContentDir, projectRoot } from './process_doc_post.js';

/**
 * Usage:
 *   node scripts/publish_doc.js <file> [--now] [--schedule YYYY-MM-DD] [--slug custom-slug]
 *
 * Default (no flags): converts, optimizes, validates & builds -> staged locally, NOT deployed.
 * --now               : also deploys live (GitHub production branch -> Hostinger)
 * --schedule <date>   : sets the publish date; post stays hidden until that date
 *
 * Supported inputs: .docx, Word-flavoured HTML saved as .doc/.html, .md/.txt
 */

const args = process.argv.slice(2);
const file = args[0];
const flag = (n) => args.includes(n);
const opt = (n) => (args.indexOf(n) !== -1 ? args[args.indexOf(n) + 1] : null);

if (!file) {
  console.log('Usage: node scripts/publish_doc.js <file> [--now] [--schedule YYYY-MM-DD] [--slug name]');
  process.exit(1);
}

const report = { fixed: [], warnings: [], errors: [] };

function detectFormat(buf) {
  const head = buf.slice(0, 16).toString('latin1');
  if (buf[0] === 0x50 && buf[1] === 0x4b) return 'docx';
  if (buf[0] === 0xd0 && buf[1] === 0xcf) return 'legacy-doc';
  if (/^\s*<!doctype html|^\s*<html/i.test(head + buf.slice(16, 64).toString('latin1'))) return 'html';
  return 'text';
}

const slugify = (s) =>
  s.toLowerCase().replace(/&/g, ' and ').replace(/['’]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

const yaml = (s) => String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\s+/g, ' ').trim();

function altFromFilename(name) {
  const base = name.replace(/\.[a-z]+$/i, '').replace(/\d{6,}/g, '').replace(/_+color_*/gi, '_');
  const words = base.split(/[_\-\s]+/).filter(Boolean).join(' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

// Repairs "orphan" <tr> rows (no <table>) and markdown separator rows (":---:") found in exported docs
function repairTables(html) {
  return html.replace(/<p[^>]*>\s*(<tr[\s\S]*<\/tr>)\s*<\/p>/i, (_, rows) => {
    const trs = rows.match(/<tr[\s\S]*?<\/tr>/gi) || [];
    const clean = trs.filter((r) => {
      const cells = [...r.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((m) => m[1].replace(/<hr[^>]*>/gi, '').replace(/<[^>]+>/g, '').trim());
      return !cells.every((c) => /^[:\-\s]*$/.test(c));
    });
    if (clean.length < trs.length) report.fixed.push('Removed broken markdown separator row from table');
    if (!clean.length) return '';
    const head = clean[0].replace(/<td/gi, '<th').replace(/<\/td>/gi, '</th>');
    report.fixed.push('Rebuilt malformed summary table (was missing <table> tag)');
    return `<table><thead>${head}</thead><tbody>${clean.slice(1).join('')}</tbody></table>`;
  });
}

function parseHtml(html) {
  html = repairTables(html);
  const $ = cheerio.load(html);
  const meta = {};
  $('.meta-box strong').each((_, el) => {
    const key = $(el).text().replace(':', '').trim().toLowerCase();
    const val = ($(el)[0].nextSibling?.data || '').trim();
    if (key) meta[key] = val;
  });
  $('.meta-box').remove();

  let image = null;
  let imageCaption = '';
  const img = $('img').first();
  if (img.length) {
    const src = img.attr('src') || '';
    const m = src.match(/^data:image\/[a-z+]+;base64,(.+)$/i);
    if (m) image = Buffer.from(m[1], 'base64');
    imageCaption = img.parent().find('p').first().text().replace(/^Featured Image:\s*/i, '').trim();
    img.parent().remove();
  }

  const title = $('h1').first().text().trim();
  $('h1').first().remove();

  // Turn "- item" text blocks (newline separated) into real lists
  $('p').each((_, p) => {
    const inner = $(p).html() || '';
    if (/^\s*-\s/.test(inner)) {
      const items = inner.split(/\n\s*-\s+/).map((s, i) => (i === 0 ? s.replace(/^\s*-\s+/, '') : s).trim()).filter(Boolean);
      $(p).replaceWith(`<ul>${items.map((i) => `<li>${i}</li>`).join('')}</ul>`);
      report.fixed.push('Converted plain "- " lines into a proper bullet list');
    }
  });
  $('p').each((_, p) => { if (!$(p).text().trim() && !$(p).find('hr,img').length) $(p).remove(); });

  const td = new TurndownService({ headingStyle: 'atx', bulletListMarker: '-', hr: '---' });
  td.use(gfm);
  const body = td.turndown($('body').html() || '').replace(/^(#{2,3} \d+)\\\./gm, '$1.').replace(/^-\s{2,}/gm, '- ');
  return { meta, image, imageCaption, title, body };
}

async function run() {
  const resolved = path.resolve(process.cwd(), file);
  if (!fs.existsSync(resolved)) throw new Error(`File not found: ${resolved}`);
  const buf = fs.readFileSync(resolved);
  const fmt = detectFormat(buf);
  console.log(`📄 ${path.basename(resolved)}  (detected: ${fmt})`);

  let title = '', body = '', meta = {}, imageBuf = null, imageCaption = '';

  if (fmt === 'legacy-doc') {
    throw new Error('Old binary .doc format detected. Please re-save the file as .docx (File > Save As > Word Document) and resubmit.');
  } else if (fmt === 'html') {
    const p = parseHtml(buf.toString('utf-8'));
    ({ title, body, meta, imageCaption } = p);
    imageBuf = p.image;
  } else if (fmt === 'docx') {
    const p = await parseDocx(resolved);
    const lines = p.rawMarkdown.split('\n');
    const h = lines.findIndex((l) => /^#\s/.test(l)) ;
    title = h >= 0 ? lines[h].replace(/^#\s*/, '').trim() : lines.find(Boolean) || '';
    body = lines.filter((_, i) => i !== h).join('\n').replace(/!\[[^\]]*\]\(\[EXTRACTED_IMAGE_\d+\]\)/g, '');
    imageBuf = p.images[0]?.buffer || null;
  } else {
    const lines = buf.toString('utf-8').split('\n');
    title = lines[0].replace(/^#+\s*/, '').trim();
    body = lines.slice(1).join('\n');
  }

  // ---- Validation / error checks ----
  if (!title) report.errors.push('No title (H1) found');
  if (!body || body.length < 300) report.errors.push('Article body missing or too short');
  if (!imageBuf) report.warnings.push('No image found in document - post will have no featured image');

  const wordCount = body.split(/\s+/).filter(Boolean).length;
  const readTime = `${Math.max(1, Math.round(wordCount / 220))} min read`;
  if (wordCount < 600) report.warnings.push(`Only ${wordCount} words - thin content ranks poorly (aim for 800+)`);

  const h2s = (body.match(/^## /gm) || []).length;
  if (h2s < 2) report.warnings.push('Fewer than 2 H2 headings - add more structure');

  // ---- SEO ----
  const slug = opt('--slug') || slugify(meta['target keyword'] || title.replace(/\(\d{4}\)/, '')).slice(0, 70).replace(/-$/, '');

  // Content completeness: does the title promise more items than the body contains?
  const promised = (title.match(/\b(\d{1,2})\s+(?:best|top|things|ways|tips|places)/i) || [])[1];
  const delivered = (body.match(/^#{2,3} \d+\./gm) || []).length;
  if (promised && Number(promised) !== delivered) {
    report.warnings.push(`CONTENT INCOMPLETE: title promises ${promised} items but the document contains only ${delivered}`);
  }
  let description = (meta['meta description'] || '').trim();
  if (!description) {
    description = body.replace(/[#*>\-|`\[\]]/g, '').split(/\n+/).find((l) => l.length > 80)?.slice(0, 155) || '';
    report.fixed.push('Meta description was missing - generated from first paragraph');
  }
  if (description.length > 160) {
    description = description.slice(0, 157).replace(/\s+\S*$/, '') + '...';
    report.fixed.push('Meta description trimmed to <=160 chars');
  }
  let seoTitle = title;
  if (seoTitle.length > 60) {
    seoTitle = title.replace(/^Beyond [^:]+:\s*/i, '').trim();
    report.fixed.push(`SEO title shortened for Google (${title.length} -> ${seoTitle.length} chars)`);
  }
  const category = meta['category'] || 'Santorini Guide';
  const keyword = meta['target keyword'] || '';

  // ---- Image ----
  let imagePath = null;
  let imageAlt = '';
  if (imageBuf) {
    const before = imageBuf.length;
    imagePath = await optimizeImage(imageBuf, `${slug}.webp`);
    const after = fs.statSync(path.join(projectRoot, 'public', imagePath)).size;
    report.fixed.push(`Image optimized: ${(before / 1024).toFixed(0)} KB -> ${(after / 1024).toFixed(0)} KB WebP (${Math.round((1 - after / before) * 100)}% smaller)`);
    imageAlt = `${altFromFilename(imageCaption) || title} - Santorini`;
  }

  // ---- Dates / scheduling ----
  const today = new Date().toISOString().split('T')[0];
  const sched = opt('--schedule');
  if (sched && !/^\d{4}-\d{2}-\d{2}$/.test(sched)) report.errors.push('--schedule must be YYYY-MM-DD');
  const pubDate = sched || today;

  if (report.errors.length) {
    console.error('\n❌ Errors:\n - ' + report.errors.join('\n - '));
    process.exit(1);
  }

  const fm = [
    '---',
    `title: "${yaml(title)}"`,
    `seoTitle: "${yaml(seoTitle)}"`,
    `description: "${yaml(description)}"`,
    `pubDate: ${pubDate}`,
    'author: "Oia Lens Team"',
    `category: "${yaml(category)}"`,
    `readTime: "${readTime}"`,
    keyword ? `keyword: "${yaml(keyword)}"` : null,
    imagePath ? `image: "${imagePath}"` : null,
    imagePath ? `imageAlt: "${yaml(imageAlt)}"` : null,
    '---',
    '',
  ].filter((l) => l !== null).join('\n');

  const target = path.join(blogContentDir, `${slug}.md`);
  fs.writeFileSync(target, fm + body.trim() + '\n', 'utf-8');
  console.log(`📝 Created src/content/blog/${slug}.md  (${wordCount} words, ${readTime})`);

  console.log('🔍 Building site to verify no errors...');
  execSync('npm run build', { cwd: projectRoot, stdio: 'inherit' });

  console.log('\n===== REPORT =====');
  report.fixed.forEach((f) => console.log('✔ Fixed:   ' + f));
  report.warnings.forEach((w) => console.log('⚠ Warning: ' + w));
  console.log(`URL: https://oialens.com/the-journal/${slug}/   Publish date: ${pubDate}`);

  if (flag('--now') || sched) {
    deploySite();
    console.log(sched ? `⏳ Scheduled for ${sched}` : '🎉 Live!');
  } else {
    console.log('Staged locally only (not deployed). Re-run with --now or --schedule YYYY-MM-DD.');
  }
}

run().catch((e) => { console.error('❌ ' + e.message); process.exit(1); });
