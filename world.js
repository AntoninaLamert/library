/* Чистая логика мира. Не зависит от DOM, названий комнат или размера карты. */
(function (root) {
  'use strict';

  const DIRECTIONS = Object.freeze({
    север: { x: 0, y: -1 }, юг: { x: 0, y: 1 },
    запад: { x: -1, y: 0 }, восток: { x: 1, y: 0 }
  });

  function sectionName(line) {
    const value = line.trim().replace(/:$/, '');
    // Отдельная строка ПРОПИСНЫМИ БУКВАМИ — заголовок раздела.
    return /^[\p{Lu}\d][\p{Lu}\d\s_—–-]*$/u.test(value) && /\p{Lu}/u.test(value)
      ? value.replace(/\s+/g, ' ') : null;
  }

  function textParts(text) {
    const parts = [];
    const references = /\[\[([^\[\]\r\n]+)\]\]|\[([^\[\]\r\n]+)\]|\{([^{}\r\n]+)\}/gu;
    let offset = 0;
    for (const match of text.matchAll(references)) {
      if (match.index > offset) parts.push({ type: 'text', text: text.slice(offset, match.index) });
      parts.push({ type: match[1] !== undefined ? 'secret' : match[2] !== undefined ? 'object' : 'item', name: (match[1] ?? match[2] ?? match[3]).trim(), text: match[0] });
      offset = match.index + match[0].length;
    }
    if (offset < text.length) parts.push({ type: 'text', text: text.slice(offset) });
    return parts;
  }

  function parseEntities(text, type, location) {
    const entries = new Map();
    const marker = type === 'secret' ? /^\[\[([^\[\]]+)\]\]$/u : type === 'object' ? /^\[([^\[\]]+)\]$/u : /^\{([^{}]+)\}$/u;
    const label = type === 'secret' ? 'секрет' : type === 'object' ? 'объект' : 'предмет';
    let current = null;
    for (const line of text.split('\n')) {
      const match = line.trim().match(marker);
      if (match) {
        const name = match[1].trim();
        if (!name) throw new Error(`«${location}»: пустое название (${label}).`);
        if (entries.has(name)) throw new Error(`«${location}»: ${label} «${name}» определён дважды.`);
        current = { name, lines: [] };
        entries.set(name, current);
      } else if (current) current.lines.push(line);
      else if (line.trim()) throw new Error(`«${location}»: перед описанием нужен маркер ${type === 'secret' ? '[[секрета]]' : type === 'object' ? '[объекта]' : '{предмета}'}.`);
    }
    return new Map([...entries].map(([name, entity]) => [name, {
      id: JSON.stringify([location, name]), name, location, description: entity.lines.join('\n').trim()
    }]));
  }

  function parseWorld(source) {
    const lines = source.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').split('\n');
    const records = [];
    const characters = [];
    const connections = [];
    const endings = [];
    const sections = [];
    let section = null;
    for (let i = 0; i < lines.length; i++) {
      // Имена локаций, персонажей и мест диалога могут быть прописными.
      if (['ЛОКАЦИЯ', 'ПЕРСОНАЖ', 'ДИАЛОГ'].includes(section?.name) && !section.lines.some(line => line.trim()) && lines[i].trim()) {
        section.lines.push(lines[i]);
        continue;
      }
      // Следующая пара может стоять прямо после текста РЕЗУЛЬТАТ.
      const relation = lines[i].trim().match(/^\{([^{}]+)\}\s*(?:->|→)\s*\[([^\[\]]+)\]$/u);
      const header = relation ? 'СВЯЗЬ' : sectionName(lines[i]);
      if (header) {
        section = { name: header, lines: relation ? [lines[i].trim()] : [], line: i + 1 };
        sections.push(section);
      } else if (section) section.lines.push(lines[i]);
    }
    let record = null;
    for (const part of sections) {
      const collection = { ЛОКАЦИЯ: records, ПЕРСОНАЖ: characters, СВЯЗЬ: connections, 'КОНЕЦ ИГРЫ': endings }[part.name];
      if (collection) {
        record = { line: part.line, sections: [] };
        collection.push(record);
      } else if (['СВЯЗАННЫЕ ОБЪЕКТЫ', 'ПЕРСОНАЖИ'].includes(part.name)) record = null;
      if (record) record.sections.push(part);
    }
    if (!records.length) throw new Error('В файле нет ни одного блока ЛОКАЦИЯ.');

    const locations = new Map();
    for (const item of records) {
      // Берём первое определение: ОПИСАНИЕ персонажа далее в файле
      // не заменяет описание последней комнаты.
      const field = name => item.sections.find(part => part.name === name);
      const value = name => field(name)?.lines.join('\n').trim() || '';
      const name = value('ЛОКАЦИЯ');
      if (!name || name.includes('\n')) {
        throw new Error(`Строка ${item.line}: после ЛОКАЦИЯ нужно одно название.`);
      }
      if (locations.has(name)) throw new Error(`Локация «${name}» определена дважды.`);
      if (!field('ОПИСАНИЕ')) throw new Error(`У локации «${name}» нет раздела ОПИСАНИЕ.`);
      const exits = [];
      const directions = new Set();
      for (const raw of value('ПЕРЕХОДЫ').split('\n')) {
        if (!raw.trim()) continue;
        const match = raw.match(/^\s*(север|юг|запад|восток)\s*(?:->|→)\s*(.+?)\s*$/iu);
        if (!match) throw new Error(`«${name}»: неверный переход «${raw.trim()}».`);
        const direction = match[1].toLowerCase();
        if (directions.has(direction)) throw new Error(`«${name}»: направление «${direction}» указано дважды.`);
        directions.add(direction);
        exits.push({ direction, target: match[2] });
      }
      locations.set(name, {
        name, firstEntry: value('ПЕРВЫЙ ВХОД'), description: value('ОПИСАНИЕ'), exits,
        objects: parseEntities(value('ОБЪЕКТЫ'), 'object', name),
        items: parseEntities(value('ПРЕДМЕТЫ'), 'item', name),
        secrets: parseEntities(value('СЕКРЕТЫ'), 'secret', name)
      });
    }
    for (const location of locations.values()) {
      for (const exit of location.exits) {
        if (!locations.has(exit.target)) {
          throw new Error(`«${location.name}»: переход ведёт в неизвестную локацию «${exit.target}».`);
        }
      }
    }
    const world = { locations, start: locations.keys().next().value };
    world.secrets = new Map([...locations.values()].flatMap(location => [...location.secrets.values()].map(secret => [secret.id, secret])));
    const field = (record, name) => record.sections.find(part => part.name === name)?.lines.join('\n').trim() || '';
    world.characters = new Map();
    for (const record of characters) {
      const name = field(record, 'ПЕРСОНАЖ');
      if (!name || name.includes('\n')) throw new Error(`Строка ${record.line}: нужно одно имя персонажа.`);
      if (world.characters.has(name)) throw new Error(`Персонаж «${name}» определён дважды.`);
      const route = [...new Set((field(record, 'МАРШРУТ') || world.start).split(',').map(name => name.trim()).filter(Boolean))];
      if (!route.length) throw new Error(`«${name}»: маршрут должен содержать хотя бы одну локацию.`);
      for (const place of route) if (!locations.has(place)) throw new Error(`«${name}»: неизвестная локация маршрута «${place}».`);
      const dialogues = new Map();
      for (const part of record.sections.filter(part => part.name === 'ДИАЛОГ')) {
        const lines = part.lines.join('\n').trim().split('\n');
        const place = lines.shift()?.trim();
        if (!locations.has(place)) throw new Error(`«${name}»: неизвестная локация диалога «${place}».`);
        if (dialogues.has(place)) throw new Error(`«${name}»: диалог для «${place}» определён дважды.`);
        const utterances = [];
        for (const line of lines) {
          if (!line.trim()) continue;
          const speech = line.match(/^\s*([^:]+):\s*(.*)$/u);
          if (speech) utterances.push({ speaker: speech[1].trim(), text: speech[2].trim() });
          else if (utterances.length) utterances.at(-1).text += '\n' + line.trim();
          else utterances.push({ speaker: '', text: line.trim() });
        }
        dialogues.set(place, utterances);
      }
      world.characters.set(name, { name, description: field(record, 'ОПИСАНИЕ'), route, dialogues, gender: field(record, 'РОД').toLowerCase() });
    }
    world.connections = connections.map((record, index) => {
      const pair = field(record, 'СВЯЗЬ').match(/^\{([^{}]+)\}\s*(?:->|→)\s*\[([^\[\]]+)\]$/u);
      if (!pair) throw new Error(`Строка ${record.line}: неверная пара предмета и объекта.`);
      const item = pair[1].trim(), object = pair[2].trim();
      if (![...locations.values()].some(location => location.items.has(item))) throw new Error(`Связь: предмет «${item}» не определён.`);
      if (![...locations.values()].some(location => location.objects.has(object))) throw new Error(`Связь: объект «${object}» не определён.`);
      const result = field(record, 'РЕЗУЛЬТАТ');
      if (!result) throw new Error(`Связь «${item}» → «${object}»: нет текста РЕЗУЛЬТАТ.`);
      return { id: String(index), item, object, result, action: field(record, 'ДЕЙСТВИЕ') };
    });
    world.endings = endings.map(record => {
      const condition = field(record, 'УСЛОВИЕ');
      // Условие декларативное: связываем выбранную кнопку по её названию.
      // Свободный текст не выполняется как JavaScript.
      const quoted = condition.match(/^Игрок\s+выбрал\s+действие\s+[«"“](.+?)[»"”]\.?$/iu);
      const explicit = condition.match(/^ДЕЙСТВИЕ\s*:\s*(.+)$/iu);
      const action = (quoted?.[1] || explicit?.[1] || '').trim();
      if (!action) throw new Error('УСЛОВИЕ финала: используйте «Игрок выбрал действие «Название кнопки».» или «ДЕЙСТВИЕ: Название кнопки».');
      if (!world.connections.some(link => link.action === action)) throw new Error(`Условие финала ссылается на неизвестное действие «${action}».`);
      const text = field(record, 'ТЕКСТ'), button = field(record, 'КНОПКА');
      if (!text || !button) throw new Error('Для КОНЕЦ ИГРЫ нужны ТЕКСТ и КНОПКА.');
      return { action, text, button };
    });
    world.coordinates = layoutWorld(world);
    return world;
  }

  function layoutWorld(world) {
    const constraints = new Map([...world.locations.keys()].map(name => [name, []]));
    for (const location of world.locations.values()) {
      for (const exit of location.exits) {
        const { x, y } = DIRECTIONS[exit.direction];
        constraints.get(location.name).push({ name: exit.target, x, y });
        // Обратное ограничение нужно для геометрии; игрового выхода оно не создаёт.
        constraints.get(exit.target).push({ name: location.name, x: -x, y: -y });
      }
    }
    const coordinates = new Map();
    let offset = 0;
    for (const start of world.locations.keys()) {
      if (coordinates.has(start)) continue;
      const component = new Map([[start, { x: 0, y: 0 }]]);
      const occupied = new Map([['0,0', start]]);
      const queue = [start];
      let minX = 0;
      let maxX = 0;
      for (let i = 0; i < queue.length; i++) {
        const current = component.get(queue[i]);
        for (const edge of constraints.get(queue[i])) {
          const expected = { x: current.x + edge.x, y: current.y + edge.y };
          const previous = component.get(edge.name);
          if (previous) {
            if (previous.x !== expected.x || previous.y !== expected.y) {
              throw new Error(`Противоречие направлений между «${queue[i]}» и «${edge.name}». Проверьте переходы в цикле.`);
            }
            continue;
          }
          const key = `${expected.x},${expected.y}`;
          if (occupied.has(key)) {
            throw new Error(`«${edge.name}» и «${occupied.get(key)}» занимают одну клетку. Проверьте направления.`);
          }
          occupied.set(key, edge.name);
          component.set(edge.name, expected);
          minX = Math.min(minX, expected.x);
          maxX = Math.max(maxX, expected.x);
          queue.push(edge.name);
        }
      }
      for (const [name, point] of component) {
        coordinates.set(name, { x: point.x - minX + offset, y: point.y });
      }
      offset += maxX - minX + 3;
    }
    return coordinates;
  }

  class Game {
    constructor(world, random = Math.random) {
      this.world = world;
      this.random = random;
      this.visited = new Set();
      this.inventory = new Map();
      this.foundItems = new Set();
      this.foundSecrets = new Map();
      this.message = null;
      this.objectStates = new Map();
      this.completedLinks = new Set();
      this.performedActions = new Set();
      this.characters = new Map([...world.characters].map(([name, character]) => [name, {
        name, location: character.route[0], ticks: 0
      }]));
      this.selectedCharacter = null;
      this.dialogue = null;
      this.events = [];
      this.turns = 0;
      this.ending = null;
      this.current = world.start;
      this.enter(this.current);
    }
    enter(name) {
      this.firstVisit = !this.visited.has(name);
      this.visited.add(name);
      this.current = name;
      this.message = null;
      this.discoverItems(this.location.description);
    }
    move(name) {
      if (this.ending) return false;
      const exit = this.location.exits.find(exit => exit.target === name);
      if (!exit) return false;
      this.enter(name);
      this.selectedCharacter = null;
      this.dialogue = null;
      this.advanceTurn([`Вы идёте на ${exit.direction}.`]);
      return true;
    }
    discoverItems(text) {
      for (const part of textParts(text)) {
        const item = part.type === 'item' && this.location.items.get(part.name);
        if (item) this.foundItems.add(item.id);
      }
    }
    inspect(name) {
      if (this.ending) return false;
      const object = this.location.objects.get(name);
      if (!object) return false;
      this.showObject(object);
      this.advanceTurn();
      return true;
    }
    showObject(object) {
      const results = this.objectStates.get(object.id) || [];
      const text = results.length ? results.map(link => link.result).join('\n\n') : object.description;
      this.message = { kind: results.length ? 'result' : 'object', name: object.name, text, receipt: null };
      this.discoverItems(text);
    }
    take(name) {
      if (this.ending) return false;
      const item = this.location.items.get(name);
      if (!item || !this.foundItems.has(item.id) || this.inventory.has(item.id)) return false;
      const currentText = this.location.description + '\n' + (['object', 'result'].includes(this.message?.kind) ? this.message.text : '');
      if (!textParts(currentText).some(part => part.type === 'item' && part.name === name)) return false;
      this.inventory.set(item.id, item);
      this.message = ['object', 'result'].includes(this.message?.kind)
        ? { ...this.message, receipt: item }
        : { kind: 'item', name, text: item.description, receipt: item };
      this.advanceTurn();
      return true;
    }
    inspectItem(id) {
      if (this.ending) return false;
      const item = this.inventory.get(id);
      if (!item) return false;
      this.message = { kind: 'item', name: item.name, text: item.description, receipt: null };
      return true;
    }
    findSecret(name) {
      if (this.ending) return false;
      const secret = this.location.secrets.get(name);
      const currentText = this.location.description + '\n' + (['object', 'result'].includes(this.message?.kind) ? this.message.text : '');
      if (!secret || !textParts(currentText).some(part => part.type === 'secret' && part.name === name)) return false;
      const isNew = !this.foundSecrets.has(secret.id);
      this.foundSecrets.set(secret.id, secret);
      this.message = { kind: 'secret', name, text: secret.description, receipt: null, isNew };
      if (isNew) this.advanceTurn();
      return true;
    }
    inspectSecret(id) {
      if (this.ending) return false;
      const secret = this.foundSecrets.get(id);
      if (!secret) return false;
      this.message = { kind: 'secret', name: secret.name, text: secret.description, receipt: null, isNew: false };
      return true;
    }
    linkKey(object, link) { return JSON.stringify([object.id, link.id]); }
    availableApplications(name) {
      const object = this.location.objects.get(name);
      if (!object || this.ending) return [];
      const heldNames = new Set([...this.inventory.values()].map(item => item.name));
      return this.world.connections.filter(link => link.object === name && heldNames.has(link.item) && !this.completedLinks.has(this.linkKey(object, link)));
    }
    apply(name, linkId) {
      const link = this.availableApplications(name).find(link => link.id === linkId);
      if (!link) return false;
      const object = this.location.objects.get(name);
      this.completedLinks.add(this.linkKey(object, link));
      this.objectStates.set(object.id, [...(this.objectStates.get(object.id) || []), link]);
      this.showObject(object);
      this.advanceTurn();
      return true;
    }
    availableActions(name) {
      const object = this.location.objects.get(name);
      if (!object || this.ending) return [];
      return (this.objectStates.get(object.id) || []).filter(link => link.action && !this.performedActions.has(this.linkKey(object, link)));
    }
    performAction(name, linkId) {
      const link = this.availableActions(name).find(link => link.id === linkId);
      if (!link) return false;
      this.performedActions.add(this.linkKey(this.location.objects.get(name), link));
      this.ending = this.world.endings.find(ending => ending.action === link.action) || null;
      if (this.ending) this.dialogue = null;
      return true;
    }
    get presentCharacters() {
      return [...this.characters.values()].filter(character => character.location === this.current);
    }
    inspectCharacter(name) {
      if (this.ending || this.characters.get(name)?.location !== this.current) return false;
      this.selectedCharacter = name;
      return true;
    }
    startDialogue(name) {
      if (this.ending || this.characters.get(name)?.location !== this.current) return false;
      const lines = this.world.characters.get(name).dialogues.get(this.current);
      if (!lines?.length) return false;
      this.selectedCharacter = name;
      this.dialogue = { character: name, location: this.current, lines, shown: 1, status: lines.length === 1 ? 'complete' : 'active' };
      if (lines.length === 1) this.advanceTurn();
      return true;
    }
    nextDialogue() {
      if (this.ending || this.dialogue?.status !== 'active') return false;
      this.dialogue.shown++;
      if (this.dialogue.shown === this.dialogue.lines.length) {
        this.dialogue.status = 'complete';
        this.advanceTurn();
      }
      return true;
    }
    movementText(character, direction, arriving) {
      const definition = this.world.characters.get(character.name);
      const gender = definition.gender;
      const verbs = { мужской: ['ушёл', 'пришёл'], женский: ['ушла', 'пришла'], средний: ['ушло', 'пришло'] };
      const verb = verbs[gender]?.[arriving ? 1 : 0];
      const from = { север: 'с юга', юг: 'с севера', запад: 'с востока', восток: 'с запада' };
      const motion = arriving ? from[direction] : `на ${direction}`;
      return verb ? `${character.name} ${verb} ${motion}.` : `${character.name} ${arriving ? '←' : '→'} ${motion}.`;
    }
    advanceTurn(events = []) {
      if (this.ending) return;
      this.turns++;
      this.events = [...events];
      if (this.dialogue?.status === 'active') this.dialogue.status = 'interrupted';
      for (const character of this.characters.values()) {
        if (character.ticks < 2) { character.ticks++; continue; }
        character.ticks++;
        const route = this.world.characters.get(character.name).route;
        const exits = this.world.locations.get(character.location).exits.filter(exit => route.includes(exit.target));
        if (!exits.length || this.random() >= .35) continue;
        const exit = exits[Math.floor(this.random() * exits.length)];
        const previous = character.location;
        character.location = exit.target;
        character.ticks = 0;
        if (previous === this.current) this.events.push(this.movementText(character, exit.direction, false));
        else if (character.location === this.current) this.events.push(this.movementText(character, exit.direction, true));
      }
      if (this.characters.get(this.selectedCharacter)?.location !== this.current) this.selectedCharacter = null;
    }
    get location() { return this.world.locations.get(this.current); }
    get visible() {
      return new Set([...this.visited, ...this.location.exits.map(exit => exit.target)]);
    }
  }

  const api = { parseWorld, layoutWorld, Game, DIRECTIONS, textParts };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.QuestWorld = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
