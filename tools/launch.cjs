// Двойной щелчок по «Играть.cmd»: запуск статического предпросмотра и браузера.
const fs = require('node:fs/promises');
const { openSync, closeSync } = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const port = Number(process.env.PORT) || 4173;
const url = `http://127.0.0.1:${port}/`;

async function inspectServer(expected) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(1500) });
    if (!response.ok || await response.text() !== expected.html) return 'other';
    const world = await fetch(new URL('map.txt', url), { signal: AbortSignal.timeout(1500) });
    return world.ok && await world.text() === expected.world ? 'ready' : 'other';
  } catch { return 'offline'; }
}

async function main() {
  require('./sync-world.cjs').syncWorld(root);
  const expected = {
    html: (await fs.readFile(path.join(root, 'index.html'), 'utf8')).replace(/^\uFEFF/, ''),
    world: (await fs.readFile(path.join(root, 'map.txt'), 'utf8')).replace(/^\uFEFF/, '')
  };
  let state = await inspectServer(expected);
  if (state === 'other') throw new Error(`Адрес ${url} занят другой страницей. Закройте другой локальный сервер и запустите игру снова.`);
  if (state !== 'ready') {
    const logPath = path.join(os.tmpdir(), `after-closing-preview-${port}.log`);
    const log = openSync(logPath, 'a');
    try {
      const server = spawn(process.execPath, [path.join(__dirname, 'preview.cjs')], {
        cwd: root, detached: true, windowsHide: true,
        env: { ...process.env, PORT: String(port) }, stdio: ['ignore', log, log]
      });
      await new Promise((resolve, reject) => { server.once('spawn', resolve); server.once('error', reject); });
      server.unref();
    } finally { closeSync(log); }
    for (let attempt = 0; attempt < 30; attempt++) {
      state = await inspectServer(expected);
      if (state === 'ready') break;
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    if (state !== 'ready') throw new Error(`Не удалось запустить игру. Подробности: ${logPath}`);
  }
  console.log(`Игра готова: ${url}`);
  if (process.argv.includes('--no-open')) return;
  const browser = spawn('rundll32.exe', ['url.dll,FileProtocolHandler', url], {
    detached: true, windowsHide: true, stdio: 'ignore'
  });
  await new Promise((resolve, reject) => { browser.once('spawn', resolve); browser.once('error', reject); });
  browser.unref();
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
