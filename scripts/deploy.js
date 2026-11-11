import { execSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const distPath = path.resolve(projectRoot, 'dist');

console.log('🚀 [1/3] Building Astro production site...');
execSync('npm run build', { cwd: projectRoot, stdio: 'inherit' });

console.log('📦 [2/3] Preparing production branch commit in dist/...');
try {
  execSync('git init', { cwd: distPath, stdio: 'ignore' });
  execSync('git checkout -B production', { cwd: distPath, stdio: 'ignore' });
  execSync('git add -A', { cwd: distPath, stdio: 'ignore' });
  execSync('git commit -m "Auto-deploy updated Santorini articles and site build"', { cwd: distPath, stdio: 'ignore' });
  
  // Ensure remote is set
  try {
    execSync('git remote add origin https://github.com/stafylastef-cpu/oialens-site.git', { cwd: distPath, stdio: 'ignore' });
  } catch (e) {
    execSync('git remote set-url origin https://github.com/stafylastef-cpu/oialens-site.git', { cwd: distPath, stdio: 'ignore' });
  }

  console.log('🌐 [3/3] Pushing live build to GitHub production branch...');
  execSync('git push -f origin production', { cwd: distPath, stdio: 'inherit' });
  console.log('✅ Deployment complete! Hostinger will now pull and update your live site.');
} catch (error) {
  console.error('❌ Deployment error:', error.message);
  process.exit(1);
}
