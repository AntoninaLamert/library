const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { parseWorld, Game, textParts } = require('../world.js');
const original = fs.readFileSync(path.join(__dirname, '../map.txt'), 'utf8');
const room = (name, exits = '', extra = '') => `ЛОКАЦИЯ\n${name}\n\nПЕРВЫЙ ВХОД\nПервый раз: ${name}.\n\nОПИСАНИЕ\nОписание: ${name}.\n\nПЕРЕХОДЫ\n${exits}\n\n${extra}\n`;

test('исходный TXT: 4 комнаты, верная геометрия и отдельное описание кота', () => {
  const world = parseWorld(original);
  assert.equal(world.locations.size, 4);
  assert.equal(world.start, 'Читальный зал');
  assert.deepEqual(world.coordinates.get('Архив'), { x: 1, y: 0 });
  assert.deepEqual(world.coordinates.get('Служебное помещение'), { x: 1, y: 1 });
  assert.deepEqual(world.coordinates.get('Холл'), { x: 0, y: 1 });
  const expectedNeighbors = {
    'Читальный зал': ['Холл', 'Архив'],
    'Холл': ['Читальный зал', 'Служебное помещение'],
    'Архив': ['Служебное помещение', 'Читальный зал'],
    'Служебное помещение': ['Холл', 'Архив']
  };
  for (const [name, neighbors] of Object.entries(expectedNeighbors)) {
    assert.deepEqual(world.locations.get(name).exits.map(exit => exit.target).sort(), [...neighbors].sort());
    const game = new Game(world);
    game.enter(name);
    for (const target of world.locations.keys()) {
      assert.equal(game.move(target), neighbors.includes(target), `${name} → ${target}`);
      game.enter(name);
    }
  }
  assert.match(world.locations.get('Холл').description, /^Просторный холл/);
  assert.doesNotMatch(world.locations.get('Холл').description, /серый кот|МАРШРУТ|ОБЪЕКТЫ/);
});
test('первый вход, повторное посещение, постепенное открытие и запрет дальнего перехода', () => {
  const game = new Game(parseWorld(original));
  assert.equal(game.firstVisit, true);
  assert.equal(game.visible.has('Служебное помещение'), false);
  assert.equal(game.move('Служебное помещение'), false);
  assert.equal(game.current, 'Читальный зал');
  assert.equal(game.move('Архив'), true);
  assert.equal(game.firstVisit, true);
  assert.equal(game.visible.has('Служебное помещение'), true);
  assert.equal(game.visible.has('Холл'), false);
  game.move('Читальный зал');
  assert.equal(game.firstVisit, false);
  assert.equal(game.visited.has('Архив'), true);
  assert.match(game.location.description, /^Большой старый/);
  assert.equal(new Game(game.world).visited.size, 1);
});
test('неизвестные разделы и повторные описания будущих сущностей не загрязняют комнату', () => {
  const world = parseWorld(room('Начало', '', 'НОВЫЙ РАЗДЕЛ\nДанные.\nПЕРСОНАЖ\nКот\nОПИСАНИЕ\nЧужое описание.\nПЕРЕХОДЫ\nюг -> Нет'));
  assert.equal(world.locations.get('Начало').description, 'Описание: Начало.');
  assert.deepEqual(world.locations.get('Начало').exits, []);
});
test('UTF-8 BOM, CRLF, пробелы, стрелка Unicode, имя прописными и необязательный первый вход', () => {
  const source = '\uFEFF' + (room('ЗАЛ', ' ВОСТОК → Комната с длинным именем ') + room('Комната с длинным именем', 'запад -> ЗАЛ')).replace(/\n/g, '\r\n');
  const world = parseWorld(source);
  assert.equal(world.start, 'ЗАЛ');
  assert.equal(world.locations.get('ЗАЛ').exits[0].direction, 'восток');
  assert.equal(parseWorld('ЛОКАЦИЯ\nОдна\nОПИСАНИЕ\nТихо.').locations.get('Одна').firstEntry, '');
});
test('односторонний переход задаёт геометрию, но не создаёт обратный выход', () => {
  const world = parseWorld(room('А') + room('Б', 'восток -> А'));
  assert.equal(world.coordinates.get('Б').x, world.coordinates.get('А').x - 1);
  const game = new Game(world);
  assert.equal(game.move('Б'), false);
  assert.deepEqual([...game.visible], ['А']);
});
test('все четыре направления, включая отрицательные координаты', () => {
  const world = parseWorld(room('Центр', 'север -> Верх\nюг -> Низ\nзапад -> Лево\nвосток -> Право') + ['Верх', 'Низ', 'Лево', 'Право'].map(name => room(name)).join(''));
  const center = world.coordinates.get('Центр');
  assert.equal(world.coordinates.get('Верх').y, center.y - 1);
  assert.equal(world.coordinates.get('Низ').y, center.y + 1);
  assert.equal(world.coordinates.get('Лево').x, center.x - 1);
  assert.equal(world.coordinates.get('Право').x, center.x + 1);
});
test('несвязанные компоненты получают координаты без наложения', () => {
  const world = parseWorld(room('А') + room('Б', 'юг -> В') + room('В'));
  assert.equal(world.coordinates.size, 3);
  assert.notDeepEqual(world.coordinates.get('А'), world.coordinates.get('Б'));
  assert.equal(world.coordinates.get('В').y, world.coordinates.get('Б').y + 1);
});
test('понятные ошибки для отсутствующей цели, дубликатов и неверных направлений', () => {
  assert.throws(() => parseWorld(room('А', 'север -> Нет')), /неизвестную локацию/);
  assert.throws(() => parseWorld(room('А') + room('А')), /определена дважды/);
  assert.throws(() => parseWorld(room('А', 'вверх -> А')), /неверный переход/);
  assert.throws(() => parseWorld(room('А', 'север -> А\nсевер -> А')), /указано дважды/);
  assert.throws(() => parseWorld(''), /нет ни одного/);
});
test('невозможные циклы и наложения комнат не рисуются как корректная карта', () => {
  assert.throws(() => parseWorld(room('А', 'восток -> Б') + room('Б', 'восток -> А')), /Противоречие/);
  assert.throws(() => parseWorld(room('А', 'восток -> Б\nюг -> В') + room('Б', 'юг -> Г') + room('В', 'восток -> Д') + room('Г') + room('Д')), /одну клетку/);
});
test('10 000 локаций: обход без рекурсии и фиксированного лимита', () => {
  const count = 10000;
  const source = Array.from({ length: count }, (_, i) => room(`Комната ${i}`, i + 1 < count ? `восток -> Комната ${i + 1}` : '')).join('');
  const world = parseWorld(source);
  assert.equal(world.locations.size, count);
  assert.equal(world.coordinates.get(`Комната ${count - 1}`).x, count - 1);
});

test('исходный TXT: объекты и предметы относятся только к своим локациям', () => {
  const world = parseWorld(original);
  for (const location of world.locations.values()) assert.equal(location.objects.size, 3);
  assert.equal(world.locations.get('Читальный зал').items.size, 0);
  assert.equal(world.locations.get('Холл').items.size, 0);
  assert.equal(world.locations.get('Служебное помещение').items.get('отмычка').description.startsWith('Тонкая металлическая'), true);
  assert.match(world.locations.get('Архив').items.get('ключ').description, /число 1/);
  assert.doesNotMatch(world.locations.get('Холл').objects.get('входная дверь').description, /ПЕРСОНАЖ|Кот|РЕЗУЛЬТАТ/);
});
test('осмотр заменяет единственное сообщение; взятие и возврат не дублируют предмет', () => {
  const game = new Game(parseWorld(original));
  assert.equal(game.inventory.size, 0);
  assert.equal(game.message, null);
  game.inspect('книжный шкаф');
  assert.match(game.message.text, /энциклопедиями/);
  game.inspect('старое кресло');
  assert.match(game.message.text, /подлокотниками/);
  assert.doesNotMatch(game.message.text, /энциклопедиями/);
  assert.equal(game.move('Холл'), true);
  game.move('Служебное помещение');
  assert.equal(game.message, null);
  assert.equal(game.take('отмычка'), false);
  game.inspect('шкафчик с инструментами');
  assert.equal(game.foundItems.size, 1);
  assert.equal(game.take('отмычка'), true);
  assert.equal(game.take('отмычка'), false);
  assert.equal(game.inventory.size, 1);
  assert.equal(game.message.receipt.name, 'отмычка');
  assert.equal(game.move('Холл'), true);
  game.move('Служебное помещение');
  assert.equal(game.firstVisit, false);
  assert.equal(game.foundItems.size, 1);
  game.inspect('шкафчик с инструментами');
  assert.equal(game.take('отмычка'), false);
  assert.equal(game.inventory.size, 1);
  assert.equal(game.message.receipt, null);
  const fresh = new Game(game.world);
  assert.equal(fresh.inventory.size, 0);
  assert.equal(fresh.foundItems.size, 0);
});
test('предмет из будущего результата нельзя получить преждевременно', () => {
  const game = new Game(parseWorld(original));
  game.move('Архив');
  game.inspect('металлический шкаф');
  assert.equal(game.foundItems.size, 0);
  assert.equal(game.take('ключ'), false);
  assert.equal(game.inspect('шкафчик с инструментами'), false);
  assert.equal(game.inspectItem('нет такого предмета'), false);
});
test('несколько предметов в одном сообщении, повторные ссылки и одинаковые имена в разных комнатах', () => {
  const entities = 'ОБЪЕКТЫ\n[ящик]\nЗдесь {жетон}, {лента} и снова {жетон}.\nПРЕДМЕТЫ\n{жетон}\nКруглый жетон.\n{лента}\nКрасная лента.';
  const world = parseWorld(room('Одна', 'восток -> Другая', entities) + room('Другая', 'запад -> Одна', entities.replace('Круглый', 'Квадратный')));
  const game = new Game(world);
  game.inspect('ящик');
  assert.equal(game.foundItems.size, 2);
  assert.equal(game.take('жетон'), true);
  assert.equal(game.take('лента'), true);
  assert.equal(game.take('жетон'), false);
  assert.match(game.message.text, /\{лента\}/);
  game.move('Другая');
  game.inspect('ящик');
  assert.equal(game.take('жетон'), true);
  assert.equal(game.inventory.size, 3);
  const tokens = [...game.inventory.values()].filter(item => item.name === 'жетон');
  assert.notEqual(tokens[0].id, tokens[1].id);
  assert.equal(game.inspectItem(tokens[0].id), true);
  assert.equal(game.message.text, 'Круглый жетон.');
  assert.equal(game.inspectItem(tokens[1].id), true);
  assert.equal(game.message.text, 'Квадратный жетон.');
});
test('найденный, но не взятый предмет сохраняет состояние между переходами', () => {
  const game = new Game(parseWorld(original));
  assert.equal(game.move('Холл'), true);
  game.move('Служебное помещение');
  game.inspect('шкафчик с инструментами');
  const found = [...game.foundItems];
  assert.equal(game.move('Холл'), true);
  assert.deepEqual([...game.foundItems], found);
  assert.equal(game.take('отмычка'), false);
  game.move('Служебное помещение');
  game.inspect('шкафчик с инструментами');
  assert.equal(game.take('отмычка'), true);
});
test('предмет в основном описании, Unicode-имена и абзацы', () => {
  const game = new Game(parseWorld('ЛОКАЦИЯ\nБерег\nОПИСАНИЕ\nНа песке {½ монеты «№2»}.\nПРЕДМЕТЫ\n{½ монеты «№2»}\nПервая строка.\n\nВторой абзац.'));
  assert.equal(game.take('½ монеты «№2»'), true);
  assert.equal(game.message.text, 'Первая строка.\n\nВторой абзац.');
});
test('маркеры разбираются без HTML и без привязки к конкретным названиям', () => {
  const source = '<img src=x> [Ящик №5 (левый)]\n{钥匙 🔑} и текст.';
  const parts = textParts(source);
  assert.equal(parts.map(part => part.text).join(''), source);
  assert.equal(parts.find(part => part.type === 'object').name, 'Ящик №5 (левый)');
  assert.equal(parts.find(part => part.type === 'item').name, '钥匙 🔑');
});
test('повторные определения в одной локации сообщают об ошибке; неизвестные разделы отделяются', () => {
  assert.throws(() => parseWorld(room('А', '', 'ОБЪЕКТЫ\n[ящик]\nПервый.\n[ящик]\nДругой.')), /объект.*дважды/);
  assert.throws(() => parseWorld(room('А', '', 'ПРЕДМЕТЫ\n{ключ}\nПервый.\n{ключ}\nДругой.')), /предмет.*дважды/);
  const world = parseWorld(room('А', '', 'ОБЪЕКТЫ\n[ящик]\nПусто.\nБУДУЩИЙ РАЗДЕЛ\nДанные.\nПРЕДМЕТЫ\n{ключ}\nМаленький.\nДРУГОЙ РАЗДЕЛ\nДанные.'));
  assert.equal(world.locations.get('А').objects.get('ящик').description, 'Пусто.');
  assert.equal(world.locations.get('А').items.get('ключ').description, 'Маленький.');
});
test('сотни объектов и предметов без фиксированного лимита', () => {
  const count = 300;
  const objects = Array.from({ length: count }, (_, i) => `[тайник ${i}]\nВнутри {находка ${i}}.`).join('\n');
  const items = Array.from({ length: count }, (_, i) => `{находка ${i}}\nОписание находки ${i}.`).join('\n');
  const game = new Game(parseWorld(room('Остров', '', `ОБЪЕКТЫ\n${objects}\nПРЕДМЕТЫ\n${items}`)));
  for (let i = 0; i < count; i++) {
    assert.equal(game.inspect(`тайник ${i}`), true);
    assert.equal(game.take(`находка ${i}`), true);
  }
  assert.equal(game.inventory.size, count);
});
