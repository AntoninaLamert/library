const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Music } = require('../music.js');

function fixture() {
  const audio = {
    paused: true, ended: false, currentTime: 0, playCalls: 0,
    async play() { this.playCalls++; this.paused = false; },
    pause() { this.paused = true; }
  };
  return { audio, player: new Music(audio) };
}

test('запись не запускается до начала игры и настроена на тихий повтор', async () => {
  const { audio, player } = fixture();
  assert.equal(audio.playCalls, 0);
  assert.equal(player.isPlaying, false);
  assert.equal(audio.loop, true);
  assert.equal(audio.preload, 'none');
  assert.equal(audio.volume, .16);
  await player.setPaused(true);
  await player.setPaused(false);
  assert.equal(audio.playCalls, 0);
  await player.setLocation('Читальный зал');
  assert.equal(player.isPlaying, true);
});

test('любое количество комнат не перезапускает запись и не меняет её позицию', async () => {
  const { audio, player } = fixture();
  await player.setLocation('Читальный зал');
  audio.currentTime = 42;
  for (let i = 0; i < 300; i++) await player.setLocation('Комната ' + i);
  assert.equal(audio.playCalls, 1);
  assert.equal(audio.currentTime, 42);
  assert.equal(player.currentLocation, 'Комната 299');
});

test('пауза сохраняет позицию, а возвращение продолжает запись', async () => {
  const { audio, player } = fixture();
  await player.setLocation('Архив');
  audio.currentTime = 24;
  await player.setPaused(true);
  assert.equal(audio.paused, true);
  await player.setLocation('Холл');
  assert.equal(audio.playCalls, 1);
  await player.setPaused(false);
  assert.equal(player.isPlaying, true);
  assert.equal(audio.currentTime, 24);
});

test('выключенный вручную звук не включается при возвращении или переходе', async () => {
  const { audio, player } = fixture();
  await player.setLocation('Холл');
  await player.toggle();
  await player.setPaused(true);
  await player.setPaused(false);
  await player.setLocation('Архив');
  assert.equal(player.isMuted, true);
  assert.equal(audio.paused, true);
  assert.equal(audio.playCalls, 1);
  await player.toggle();
  assert.equal(player.isPlaying, true);
});

test('выход на стартовый или финальный экран останавливает и сбрасывает запись', async () => {
  const { audio, player } = fixture();
  await player.setLocation('Архив');
  audio.currentTime = 50;
  await player.stop();
  await player.setPaused(true);
  await player.setPaused(false);
  assert.equal(player.currentLocation, null);
  assert.equal(audio.paused, true);
  assert.equal(audio.currentTime, 0);
  assert.equal(audio.playCalls, 1);
});

test('поздняя загрузка MP3 не включает музыку после паузы, отключения или выхода', async () => {
  for (const action of ['pause', 'mute', 'stop']) {
    const { audio, player } = fixture();
    let finish;
    audio.play = () => new Promise(resolve => {
      finish = () => { audio.paused = false; resolve(); };
    });
    const starting = player.setLocation('Архив');
    if (action === 'pause') await player.setPaused(true);
    if (action === 'mute') await player.toggle();
    if (action === 'stop') await player.stop();
    finish();
    await starting;
    assert.equal(audio.paused, true, action);
    assert.equal(player.isPlaying, false, action);
  }
});

test('отмена запуска при паузе ожидаема, а настоящая ошибка файла сообщается приложению', async () => {
  const { audio, player } = fixture();
  let rejectPlay;
  audio.play = () => new Promise((resolve, reject) => { rejectPlay = reject; });
  const starting = player.setLocation('Архив');
  await player.setPaused(true);
  rejectPlay(new Error('Play interrupted'));
  await assert.doesNotReject(starting);
  audio.play = async () => { throw new Error('MP3 unavailable'); };
  await assert.rejects(player.setPaused(false), /MP3 unavailable/);
});
