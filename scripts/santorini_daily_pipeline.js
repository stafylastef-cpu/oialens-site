/**
 * Oia Lens Daily Intelligence, Briefing & Publishing Pipeline
 * 
 * 1. Researches recent traveler inquiries & complaints on Santorini.
 * 2. Compiles a briefing markdown file with 5 article outlines + Instagram + Pinterest.
 * 3. Uploads the briefing to Google Drive ('Oia Lens Daily Briefings' folder).
 * 4. Sends/prepares the email review.
 * 5. On approval: generates all 5 full blog posts + images and runs `npm run deploy` to update oialens.com live on Hostinger.
 */

import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const DRIVE_FOLDER_ID = '1F66AI6bKZEk7K3u9tw4tVUboakwzM6De'; // 'Oia Lens Daily Briefings'

export function uploadToDrive(filePath) {
  try {
    console.log(`Uploading ${filePath} to Google Drive folder ${DRIVE_FOLDER_ID}...`);
    const output = execSync(`gdrive mutate upload "${filePath}" --parent ${DRIVE_FOLDER_ID}`, { encoding: 'utf-8' });
    console.log('Upload result:', output.trim());
    
    // Extract file ID
    const match = output.match(/ID:\s*([a-zA-Z0-9_-]+)/);
    if (match) {
      return `https://drive.google.com/file/d/${match[1]}/view`;
    }
  } catch (err) {
    console.error('Drive upload warning:', err.message);
  }
  return null;
}

export function deployToLive() {
  console.log('Deploying updated site to GitHub production branch for Hostinger...');
  execSync('npm run deploy', { cwd: projectRoot, stdio: 'inherit' });
}

export { projectRoot, DRIVE_FOLDER_ID };
