const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { parseWorld, Game, textParts } = require('../world.js');
const source = fs.readFileSync(path.join(__dirname, '../map.txt'), 'utf8');

test('двойные скобки обозначают секрет и не становятся объектом или предметом', () => {
  assert.deepEqual(textParts('[[фото]] [стол] {ключ}').filter(part => part.name).map(part => [part.type, part.name]),
    [['secret', 'фото'], ['object', 'стол'], ['item', 'ключ']]);
});

test('все семь секретов можно найти при исследовании обстановки', () => {
  const world = parseWorld(source);
  const game = new Game(world, () => .99);
  assert.equal(world.secrets.size, 7);
  assert.equal(game.foundSecrets.size, 0);
  for (const location of world.locations.values()) {
    game.enter(location.name);
    for (const object of location.objects.values()) {
      game.inspect(object.name);
      for (const part of textParts(object.description).filter(part => part.type === 'secret')) {
        game.inspect(object.name);
        assert.equal(game.findSecret(part.name), true);
        assert.ok(game.message.text.length > 100);
      }
    }
  }
  assert.equal(game.foundSecrets.size, 7);
  assert.equal(game.inventory.size, 0);
});

test('осмотр открывает находку, но счётчик растёт только после чтения; повтор не считается', () => {
  const game = new Game(parseWorld(source), () => .99);
  assert.equal(game.findSecret('пожелтевшая открытка'), false);
  assert.equal(game.inspectSecret('["Читальный зал","пожелтевшая открытка"]'), false);
  game.inspect('книжный шкаф');
  assert.equal(game.foundSecrets.size, 0);
  assert.equal(game.findSecret('пожелтевшая открытка'), true);
  assert.equal(game.message.isNew, true);
  game.inspect('книжный шкаф');
  assert.equal(game.findSecret('пожелтевшая открытка'), true);
  assert.equal(game.message.isNew, false);
  assert.equal(game.foundSecrets.size, 1);
});

test('находка сохраняется между комнатами и перечитывается без нового хода; новая игра сбрасывает её', () => {
  const world = parseWorld(source);
  const game = new Game(world, () => .99);
  game.inspect('книжный шкаф'); game.findSecret('пожелтевшая открытка');
  const id = [...game.foundSecrets.keys()][0];
  game.move('Архив');
  const turns = game.turns;
  assert.equal(game.findSecret('пожелтевшая открытка'), false);
  assert.equal(game.inspectSecret(id), true);
  assert.match(game.message.text, /1968/);
  assert.equal(game.turns, turns);
  assert.equal(game.foundSecrets.size, 1);
  assert.equal(new Game(world).foundSecrets.size, 0);
});

test('основное прохождение завершается с нулём найденных секретов', () => {
  const game = new Game(parseWorld(source), () => .99);
  game.move('Холл'); game.move('Служебное помещение');
  game.inspect('шкафчик с инструментами'); game.take('отмычка');
  game.move('Архив'); game.apply('металлический шкаф', '0'); game.take('ключ');
  game.move('Читальный зал'); game.move('Холл');
  game.apply('входная дверь', '1'); game.performAction('входная дверь', '1');
  assert.ok(game.ending);
  assert.equal(game.foundSecrets.size, 0);
  assert.equal(game.findSecret('фотография последнего вечера'), false);
});

test('одинаковые названия находок в разных комнатах считаются независимо', () => {
  const room = (name, exits) => `ЛОКАЦИЯ\n${name}\nОПИСАНИЕ\nЗдесь [[фото]].\nПЕРЕХОДЫ\n${exits}\nСЕКРЕТЫ\n[[фото]]\nИстория ${name}.\n`;
  const game = new Game(parseWorld(room('А', 'восток -> Б') + room('Б', 'запад -> А')));
  game.findSecret('фото'); game.move('Б'); game.findSecret('фото');
  assert.equal(game.foundSecrets.size, 2);
});

test('старый формат мира без секретов совместим; повторы определения объясняются', () => {
  const old = 'ЛОКАЦИЯ\nКомната\nОПИСАНИЕ\nПусто.\n';
  assert.equal(parseWorld(old).secrets.size, 0);
  assert.equal(new Game(parseWorld(old)).foundSecrets.size, 0);
  assert.throws(() => parseWorld(old + 'СЕКРЕТЫ\n[[фото]]\nИстория.\n[[фото]]\nДругая история.'), /секрет.*дважды/);
});
