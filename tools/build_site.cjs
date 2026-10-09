'use strict';
// Sites accepts a build output folder. GitHub Pages uses the root files directly.
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const output = path.join(root, 'build');
const assets = [
  'index.html', 'styles.css', 'calculator.js', 'app.js', 'sw.js',
  'manifest.webmanifest', 'icon.svg',
  'icons/apple-touch-icon.png', 'icons/icon-192.png', 'icons/icon-512.png'
];
for (const asset of assets) {
  if (!fs.lstatSync(path.join(root, asset)).isFile()) throw new Error(`Missing regular asset: ${asset}`);
}
for (const asset of assets) {
  const destination = path.join(output, asset);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(path.join(root, asset), destination);
}
console.log(`Prepared ${assets.length} public assets in build/ for Sites.`);
