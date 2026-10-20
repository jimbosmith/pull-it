import fs from 'node:fs';
import path from 'node:path';
import { stripTypeScriptTypes } from 'node:module';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const srcDir = path.join(rootDir, 'src');
const distDir = path.join(rootDir, 'dist');

fs.mkdirSync(distDir, { recursive: true });

const files = fs.readdirSync(srcDir).filter((f) => f.endsWith('.ts'));
const cacheBust = 'v=7';

for (const file of files) {
  const srcPath = path.join(srcDir, file);
  const tsCode = fs.readFileSync(srcPath, 'utf8');
  let jsCode = stripTypeScriptTypes(tsCode, { mode: 'strip', sourceUrl: file });
  // Rewrite relative .ts imports to .js?v=3 for native browser ES modules with cache busting
  jsCode = jsCode.replace(/(from\s+['"]\.\/[^'"]+)\.ts(['"])/g, `$1.js?${cacheBust}$2`);
  const outName = file.replace(/\.ts$/, '.js');
  fs.writeFileSync(path.join(distDir, outName), jsCode, 'utf8');
}

console.log(`Built ${files.length} TypeScript modules into dist/ (${cacheBust})`);
