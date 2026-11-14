const fs = require('fs');
const path = require('path');

const root = __dirname;
const outputDirectory = path.join(root, 'dist');
const publishFiles = ['index.html', 'app.js', 'styles.css', 'black-logo.png'];

for (const file of publishFiles) {
  const source = path.join(root, file);
  if (!fs.existsSync(source) || !fs.statSync(source).isFile()) {
    throw new Error(`Required Netlify asset is missing: ${file}`);
  }
}

fs.rmSync(outputDirectory, { recursive: true, force: true });
fs.mkdirSync(outputDirectory, { recursive: true });

for (const file of publishFiles) {
  fs.copyFileSync(path.join(root, file), path.join(outputDirectory, file));
}

console.log(`Prepared ${publishFiles.length} Netlify assets in dist.`);
