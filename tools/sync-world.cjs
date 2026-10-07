// Обновляет в HTML резервную копию обычного map.txt для открытия с диска.
const fs = require('node:fs');
const path = require('node:path');
const { parseWorld } = require('../world.js');
const start = '<!-- WORLD_SNAPSHOT_START -->';
const end = '<!-- WORLD_SNAPSHOT_END -->';
function snapshotMarkup(source) {
  const json = JSON.stringify(source).replace(/</g, '\\u003c');
  return `${start}\n<script id="world-snapshot" type="application/json">${json}</script>\n${end}`;
}
function syncWorld(root = path.resolve(__dirname, '..')) {
  const source = fs.readFileSync(path.join(root, 'map.txt'), 'utf8');
  parseWorld(source);
  const file = path.join(root, 'index.html');
  const html = fs.readFileSync(file, 'utf8');
  const begin = html.indexOf(start), finish = html.indexOf(end);
  if (begin < 0 || finish < begin) throw new Error('В index.html отсутствует место для резервной копии мира.');
  const updated = html.slice(0, begin) + snapshotMarkup(source) + html.slice(finish + end.length);
  if (updated !== html) fs.writeFileSync(file, updated, 'utf8');
}
if (require.main === module) syncWorld();
module.exports = { syncWorld, snapshotMarkup };
