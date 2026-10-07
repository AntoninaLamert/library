const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadSource } = require('../world-loader.js');
const { parseWorld } = require('../world.js');
const { snapshotMarkup } = require('../tools/sync-world.cjs');

test('открытие HTML с диска использует сохранённый TXT без fetch', async () => {
  const result = await loadSource({protocol:'file:', fallback:'карта', fetchText: () => { throw new Error('fetch не должен вызываться'); }});
  assert.deepEqual(result, {source:'карта', offline:true});
});
test('по HTTP актуальный TXT имеет приоритет над сохранённым', async () => {
  const result = await loadSource({protocol:'http:', fallback:'старая карта', fetchText:async () => 'новая карта'});
  assert.deepEqual(result, {source:'новая карта', offline:false});
});
test('Failed to fetch, таймаут и недоступный TXT не блокируют запуск', async () => {
  for (const error of [new TypeError('Failed to fetch'), new Error('HTTP 404'), new Error('Timeout')]) {
    assert.deepEqual(await loadSource({protocol:'https:', fallback:'копия', fetchText:async () => { throw error; }}), {source:'копия', offline:true});
  }
});
test('ошибка структуры загруженного TXT не подменяется старым миром', async () => {
  const result = await loadSource({protocol:'https:', fallback:'старый мир', fetchText:async () => 'неправильный файл'});
  assert.equal(result.offline, false);
  assert.throws(() => parseWorld(result.source));
});
test('сохранённый мир совпадает с map.txt и проходит обычный парсер', () => {
  const dir = path.resolve(__dirname, '..');
  const html = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
  const source = JSON.parse(html.match(/<script id="world-snapshot" type="application\/json">([\s\S]*?)<\/script>/)[1]);
  assert.equal(source, fs.readFileSync(path.join(dir, 'map.txt'), 'utf8'));
  assert.ok(parseWorld(source));
});
test('текст мира не может закрыть HTML-скрипт или исполнить разметку', () => {
  const source = 'ОПИСАНИЕ\n</script><script>alert(1)</script> & <объект>';
  const html = snapshotMarkup(source);
  assert.equal((html.match(/<\/script>/g) || []).length, 1);
  assert.equal(JSON.parse(html.match(/application\/json">([\s\S]*?)<\/script>/)[1]), source);
});
