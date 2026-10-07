/* Обычные скрипты и относительные URL: работают в подпапке GitHub Pages. */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const locationImages = new Map([
    ['Читальный зал', { file: 'Library_interior.jpg', alt: 'Ночной читальный зал с длинными столами, книгами и окнами' }],
    ['Холл', { file: 'Library_hall.jpg', alt: 'Полутёмный холл библиотеки со стойкой и стеклянными дверями' }],
    ['Архив', { file: 'Library_storage_room.jpg', alt: 'Архивная комната со стеллажами, коробками и рабочим столом' }],
    ['Служебное помещение', { file: 'Library_service_room.jpg', alt: 'Служебная комната с документами, стеллажами и рабочим столом' }],
  ]);
  const viewport = $('map-viewport');
  const stage = $('map-stage');
  const nodes = $('map-nodes');
  const links = $('map-links');
  let world;
  let game;
  let camera = { x: 0, y: 0, zoom: 1 };
  let drag = null;
  let suppressClick = false;
  let frame = 0;
  let loadingVersion = 0;
  let renderedDialogue = null;
  const music = new QuestMusic.Music($('ambient-music'));
  function updateSoundControl() {
    const button = $('sound-toggle');
    button.hidden = !game || !!game.ending;
    button.disabled = !music.supported;
    button.setAttribute('aria-pressed', String(!music.isMuted && music.supported));
    button.setAttribute('aria-label', !music.supported ? 'Музыка недоступна' : music.isMuted ? 'Включить музыку' : 'Выключить музыку');
    $('sound-label').textContent = !music.supported ? 'Звук недоступен' : music.isMuted ? 'Звук выключен' : music.isPaused ? 'Звук на паузе' : 'Звук включён';
  }
  async function playMusic(name) {
    try { await music.setLocation(name); }
    catch (error) {
      console.warn('Музыка недоступна:', error);
      music.isMuted = true;
      updateSoundControl();
    }
  }
  async function pauseMusic(paused) {
    try { await music.setPaused(paused); }
    catch (error) { console.warn('Не удалось приостановить музыку:', error); }
    updateSoundControl();
  }
  const syncMusicActivity = () => { void pauseMusic(document.hidden || !document.hasFocus()); };
  document.addEventListener('visibilitychange', syncMusicActivity);
  window.addEventListener('blur', syncMusicActivity);
  window.addEventListener('focus', syncMusicActivity);
  window.addEventListener('pagehide', () => { void pauseMusic(true); });
  window.addEventListener('pageshow', syncMusicActivity);
  syncMusicActivity();
  const metrics = () => matchMedia('(max-width: 360px)').matches
    ? { x: 116, y: 96, w: 100, h: 78 }
    : matchMedia('(max-width: 600px)').matches
      ? { x: 146, y: 105, w: 116, h: 80 }
      : { x: 186, y: 112, w: 142, h: 88 };
  function point(name) {
    const p = world.coordinates.get(name);
    const m = metrics();
    return { x: p.x * m.x, y: p.y * m.y };
  }
  function textBlock(element, text, interactive = false) {
    element.replaceChildren();
    for (const paragraph of text.split(/\n\s*\n/).filter(Boolean)) {
      const p = document.createElement('p');
      if (interactive) {
        for (const part of QuestWorld.textParts(paragraph)) {
          const entity = part.type === 'object' ? game.location.objects.get(part.name)
            : part.type === 'item' ? game.location.items.get(part.name)
              : part.type === 'secret' ? game.location.secrets.get(part.name) : null;
          if (!entity) { p.append(document.createTextNode(part.text)); continue; }
          if (part.type === 'item' && game.inventory.has(entity.id)) {
            const taken = document.createElement('span');
            taken.className = 'taken-item';
            taken.textContent = `${entity.name} (в инвентаре)`;
            p.append(taken);
            continue;
          }
          const button = document.createElement('button');
          button.type = 'button';
          button.className = `inline-action ${part.type}-action`;
          button.dataset.action = part.type === 'object' ? 'inspect' : part.type === 'secret' ? 'secret' : 'take';
          button.dataset.name = entity.name;
          const found = part.type === 'secret' && game.foundSecrets.has(entity.id);
          button.textContent = `${entity.name}${found ? ' ✓' : ''}`;
          button.setAttribute('aria-label', `${part.type === 'object' ? 'Осмотреть' : part.type === 'secret' ? found ? 'Перечитать секрет' : 'Исследовать находку' : 'Взять'}: ${entity.name}`);
          button.title = part.type === 'object' ? 'Осмотреть объект' : part.type === 'secret' ? 'Прочитать историю' : 'Взять в инвентарь';
          p.append(button);
        }
      } else p.textContent = paragraph;
      element.append(p);
    }
    element.hidden = !text;
  }
  function renderMessage() {
    const message = game.message;
    $('current-message').hidden = !message;
    $('current-message').dataset.kind = message?.kind || '';
    $('message-title').textContent = message?.name || '';
    $('message-text').replaceChildren();
    $('pickup-receipt').replaceChildren();
    $('pickup-receipt').hidden = !message?.receipt;
    $('object-actions').replaceChildren();
    $('object-actions').hidden = true;
    if (!message) return;
    const isObject = ['object', 'result'].includes(message.kind);
    $('message-label').textContent = message.kind === 'secret' ? message.isNew ? 'СЕКРЕТ НАЙДЕН · СОХРАНЁН В ЖУРНАЛЕ' : 'ИСТОРИЯ БИБЛИОТЕКИ' : message.kind === 'result' ? 'РЕЗУЛЬТАТ' : isObject ? 'ОСМОТР' : 'ПРЕДМЕТ';
    textBlock($('message-text'), message.text || 'Здесь пока нет подробного описания.', isObject);
    if (message.receipt) {
      const confirmation = document.createElement('p');
      confirmation.className = 'pickup-confirmation';
      confirmation.textContent = `✓ Взято: ${message.receipt.name}. Предмет в инвентаре.`;
      $('pickup-receipt').append(confirmation);
      if (isObject && message.receipt.description) {
        const description = document.createElement('div');
        textBlock(description, message.receipt.description);
        $('pickup-receipt').append(description);
      }
    }
    if (isObject) {
      for (const [action, candidates] of [['apply', game.availableApplications(message.name)], ['perform', game.availableActions(message.name)]]) {
        for (const link of candidates) {
          const button = document.createElement('button');
          button.type = 'button';
          button.className = `object-action-button${action === 'perform' ? ' final-action' : ''}`;
          button.dataset.linkId = link.id;
          button.dataset.objectName = message.name;
          button.dataset.kind = action;
          button.textContent = action === 'apply' ? `Применить: ${link.item}` : link.action;
          $('object-actions').append(button);
        }
      }
      $('object-actions').hidden = !$('object-actions').childElementCount;
    }
  }
  function renderEvents() {
    $('movement-events').replaceChildren();
    $('movement-events').hidden = !game.events.length;
    for (const text of game.events) {
      const li = document.createElement('li');
      li.textContent = text;
      $('movement-events').append(li);
    }
  }
  function renderCharacters() {
    const present = game.presentCharacters;
    $('characters-panel').hidden = !present.length;
    // Не теряем фокус кнопки при обновлении описания персонажа.
    const focused = $('character-list').contains(document.activeElement) ? document.activeElement.dataset.character : null;
    $('character-list').replaceChildren();
    for (const character of present) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'character-button';
      button.textContent = character.name;
      button.dataset.character = character.name;
      button.setAttribute('aria-label', `Персонаж: ${character.name}`);
      button.setAttribute('aria-pressed', String(game.selectedCharacter === character.name));
      $('character-list').append(button);
      if (focused === character.name) button.focus({ preventScroll: true });
    }
    const character = game.world.characters.get(game.selectedCharacter);
    $('character-detail').hidden = !character;
    $('character-name').textContent = character?.name || '';
    textBlock($('character-description'), character?.description || '');
    const canTalk = !!character?.dialogues.get(game.current)?.length;
    $('start-dialogue').hidden = !canTalk;
    $('no-dialogue').hidden = !character || canTalk;
  }
  function renderDialogue() {
    const dialogue = game.dialogue;
    $('dialogue-panel').hidden = !dialogue;
    if (renderedDialogue !== dialogue) {
      $('dialogue-lines').replaceChildren();
      renderedDialogue = dialogue;
    }
    if (!dialogue) return;
    $('dialogue-title').textContent = dialogue.character;
    for (let i = $('dialogue-lines').childElementCount; i < dialogue.shown; i++) {
      const line = dialogue.lines[i];
      const li = document.createElement('li');
      li.className = line.speaker === 'Игрок' ? 'player-line' : 'character-line';
      li.tabIndex = -1;
      if (line.speaker) {
        const speaker = document.createElement('span');
        speaker.className = 'speaker';
        speaker.textContent = line.speaker;
        li.append(speaker);
      }
      const text = document.createElement('p');
      text.textContent = line.text;
      li.append(text);
      $('dialogue-lines').append(li);
    }
    $('next-dialogue').hidden = dialogue.status !== 'active';
    $('dialogue-status').hidden = dialogue.status !== 'interrupted';
    $('dialogue-status').textContent = dialogue.status === 'interrupted' ? 'Разговор прерван.' : '';
  }
  function renderActivity() {
    renderSecrets();
    renderEvents();
    renderCharacters();
    renderDialogue();
    scheduleMap();
  }
  function renderEnding() {
    void music.stop();
    updateSoundControl();
    $('game').hidden = true;
    $('ending-panel').hidden = false;
    textBlock($('ending-text'), game.ending.text);
    $('ending-secrets').hidden = !world.secrets.size;
    $('ending-secrets').textContent = `Найдено секретов: ${game.foundSecrets.size} из ${world.secrets.size}.${game.foundSecrets.size === world.secrets.size && world.secrets.size ? ' Все истории библиотеки открыты.' : ''}`;
    $('ending-restart').textContent = game.ending.button;
    document.title = 'История завершена — После закрытия';
    $('ending-title').focus({ preventScroll: true });
    $('ending-panel').scrollIntoView({ block: 'start', behavior: 'instant' });
  }
  function renderInventory() {
    $('inventory').hidden = !game.inventory.size;
    $('inventory-count').textContent = game.inventory.size;
    const fragment = document.createDocumentFragment();
    const names = new Map();
    for (const item of game.inventory.values()) names.set(item.name, (names.get(item.name) || 0) + 1);
    for (const item of game.inventory.values()) {
      const li = document.createElement('li');
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'inventory-item';
      button.dataset.itemId = item.id;
      button.textContent = item.name;
      button.setAttribute('aria-label', `Описание предмета: ${item.name}${names.get(item.name) > 1 ? ` (${item.location})` : ''}`);
      if (names.get(item.name) > 1) {
        const origin = document.createElement('small');
        origin.textContent = item.location;
        button.append(origin);
      }
      li.append(button);
      fragment.append(li);
    }
    $('inventory-items').replaceChildren(fragment);
  }
  function renderSecrets() {
    $('secrets-panel').hidden = !world.secrets.size;
    const count = `Найдено ${game.foundSecrets.size} из ${world.secrets.size}`;
    if ($('secrets-count').textContent !== count) $('secrets-count').textContent = count;
    $('secrets-hint').hidden = !!game.foundSecrets.size;
    $('secrets-journal').hidden = !game.foundSecrets.size;
    const focused = $('secrets-list').contains(document.activeElement) ? document.activeElement.dataset.secretId : null;
    const fragment = document.createDocumentFragment();
    for (const secret of game.foundSecrets.values()) {
      const li = document.createElement('li');
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'secret-entry';
      button.dataset.secretId = secret.id;
      button.textContent = secret.name;
      const origin = document.createElement('small');
      origin.textContent = secret.location;
      button.append(origin);
      li.append(button);
      fragment.append(li);
    }
    $('secrets-list').replaceChildren(fragment);
    if (focused) [...$('secrets-list').querySelectorAll('button')].find(button => button.dataset.secretId === focused)?.focus({ preventScroll: true });
  }
  function visitWord(n) {
    if (n % 10 === 1 && n % 100 !== 11) return 'локация открыта';
    if ([2, 3, 4].includes(n % 10) && ![12, 13, 14].includes(n % 100)) return 'локации открыты';
    return 'локаций открыто';
  }
  function renderStory(focus = false) {
    $('start-screen').hidden = true;
    $('ending-panel').hidden = true;
    $('game').hidden = false;
    updateSoundControl();
    const location = game.location;
    $('location-title').textContent = location.name;
    const visual = locationImages.get(location.name);
    const figure = $('location-visual');
    const picture = $('location-image');
    figure.hidden = !visual;
    if (visual) {
      picture.alt = visual.alt;
      picture.src = `./media/${visual.file}`;
    } else {
      picture.removeAttribute('src');
      picture.alt = '';
    }
    document.title = `${location.name} — После закрытия`;
    $('visit-label').textContent = game.firstVisit ? 'ПЕРВОЕ ПОСЕЩЕНИЕ' : 'ЗНАКОМОЕ МЕСТО';
    textBlock($('first-entry'), game.firstVisit ? location.firstEntry : '');
    textBlock($('description'), location.description, true);
    renderMessage();
    renderInventory();
    renderActivity();
    $('visited-count').textContent = game.visited.size;
    $('visited-word').textContent = visitWord(game.visited.size);
    $('announcement').textContent = `${location.name}. Доступно переходов: ${location.exits.length}.`;
    if (focus) {
      $('location-title').focus({ preventScroll: true });
      $('location-title').scrollIntoView({ block: 'nearest', behavior: 'instant' });
    }
    recenter();
  }
  for (const id of ['description', 'message-text']) {
    $(id).addEventListener('click', event => {
      const button = event.target.closest('button[data-action]');
      if (!button) return;
      const taking = button.dataset.action === 'take';
      const finding = button.dataset.action === 'secret';
      const changed = finding ? game.findSecret(button.dataset.name) : taking ? game.take(button.dataset.name) : game.inspect(button.dataset.name);
      if (!changed) return;
      renderMessage();
      renderActivity();
      if (taking || finding) {
        textBlock($('description'), game.location.description, true);
        renderInventory();
      }
      // Кнопка предмета исчезает после взятия; фокус остаётся рядом с результатом.
      if (taking || finding || id === 'message-text') $('message-title').focus({ preventScroll: true });
      $('current-message').scrollIntoView({ block: 'nearest', behavior: 'instant' });
    });
  }
  $('inventory-items').addEventListener('click', event => {
    const button = event.target.closest('button[data-item-id]');
    if (button && game.inspectItem(button.dataset.itemId)) {
      renderMessage();
      $('current-message').scrollIntoView({ block: 'nearest', behavior: 'instant' });
    }
  });
  $('secrets-list').addEventListener('click', event => {
    const button = event.target.closest('button[data-secret-id]');
    if (button && game.inspectSecret(button.dataset.secretId)) {
      renderMessage();
      $('message-title').focus({ preventScroll: true });
      $('current-message').scrollIntoView({ block: 'nearest', behavior: 'instant' });
    }
  });
  $('object-actions').addEventListener('click', event => {
    const button = event.target.closest('button[data-link-id]');
    if (!button) return;
    const changed = button.dataset.kind === 'apply'
      ? game.apply(button.dataset.objectName, button.dataset.linkId)
      : game.performAction(button.dataset.objectName, button.dataset.linkId);
    if (!changed) return;
    if (game.ending) { renderEnding(); return; }
    renderMessage();
    renderActivity();
    $('message-title').focus({ preventScroll: true });
    $('current-message').scrollIntoView({ block: 'nearest', behavior: 'instant' });
  });
  $('character-list').addEventListener('click', event => {
    const button = event.target.closest('button[data-character]');
    if (button && game.inspectCharacter(button.dataset.character)) renderCharacters();
  });
  $('start-dialogue').addEventListener('click', () => {
    if (game.startDialogue(game.selectedCharacter)) {
      renderActivity();
      $('dialogue-lines').lastElementChild?.focus({ preventScroll: true });
      $('dialogue-panel').scrollIntoView({ block: 'nearest', behavior: 'instant' });
    }
  });
  $('next-dialogue').addEventListener('click', () => {
    if (game.nextDialogue()) {
      renderActivity();
      const last = $('dialogue-lines').lastElementChild;
      if (game.dialogue.status === 'complete') last?.focus({ preventScroll: true });
      last?.scrollIntoView({ block: 'nearest', behavior: 'instant' });
    }
  });
  function fit(names) {
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const name of names) {
      const p = point(name);
      minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
      minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
    }
    const m = metrics();
    return {
      x: (minX + maxX) / 2, y: (minY + maxY) / 2,
      zoom: Math.min(1, (viewport.clientWidth - 42) / (maxX - minX + m.w),
        (viewport.clientHeight - 78) / (maxY - minY + m.h))
    };
  }
  function recenter() {
    if (!game || !viewport.clientWidth) return;
    const whole = fit(game.visible);
    if (whole.zoom >= .78) camera = whole;
    else {
      // Большой исследованный мир не превращается в нечитаемую миниатюру.
      // Камера показывает текущую комнату и все её доступные выходы.
      camera = fit(new Set([game.current, ...game.location.exits.map(exit => exit.target)]));
    }
    renderMap();
  }
  function scheduleMap() {
    if (!frame) frame = requestAnimationFrame(() => { frame = 0; renderMap(); });
  }
  function mapIcon(kind) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    svg.classList.add('map-icon');
    const add = (tag, attributes) => {
      const element = document.createElementNS('http://www.w3.org/2000/svg', tag);
      for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, value);
      svg.append(element);
    };
    if (kind === 'room') {
      add('path', { d: 'M3 10.5 12 3l9 7.5M5.5 9v11h13V9M9.5 20v-7h5v7', fill: 'none', stroke: 'currentColor', 'stroke-width': '1.8', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' });
    } else if (kind === 'closed') {
      add('path', { d: 'M7.5 10V7a4.5 4.5 0 0 1 9 0v3', fill: 'none', stroke: 'currentColor', 'stroke-width': '1.8', 'stroke-linecap': 'round' });
      add('rect', { x: '5', y: '10', width: '14', height: '11', rx: '2', fill: 'currentColor' });
      add('circle', { cx: '12', cy: '15', r: '1.2', fill: '#29291d' });
    } else if (kind === 'player') {
      add('circle', { cx: '12', cy: '12', r: '10', fill: 'currentColor' });
      add('circle', { cx: '12', cy: '9', r: '2.3', fill: '#233322' });
      add('path', { d: 'M7.8 17a4.3 4.3 0 0 1 8.4 0', fill: 'none', stroke: '#233322', 'stroke-width': '1.8', 'stroke-linecap': 'round' });
    } else {
      add('circle', { cx: '12', cy: '12', r: '10', fill: 'currentColor' });
      add('circle', { cx: '12', cy: '9', r: '2', fill: '#293429' });
      add('path', { d: 'M7.6 17a4.4 4.4 0 0 1 8.8 0', fill: 'none', stroke: '#293429', 'stroke-width': '1.7', 'stroke-linecap': 'round' });
    }
    return svg;
  }
  function renderMap() {
    if (!game) return;
    const width = viewport.clientWidth;
    const height = viewport.clientHeight;
    // Припуск сверху оставляет место компасу, снизу — кнопкам масштаба.
    stage.style.transform = `translate(${width / 2}px, ${height / 2 - 10}px) scale(${camera.zoom}) translate(${-camera.x}px, ${-camera.y}px)`;
    const visible = game.visible;
    const available = new Map(game.location.exits.map(exit => [exit.target, exit.direction]));
    const charactersByLocation = new Map();
    for (const character of game.characters.values()) {
      if (!game.visited.has(character.location)) continue;
      if (!charactersByLocation.has(character.location)) charactersByLocation.set(character.location, []);
      charactersByLocation.get(character.location).push(character);
    }
    const m = metrics();
    const halfW = width / camera.zoom / 2 + m.x;
    const halfH = height / camera.zoom / 2 + m.y;
    const inView = new Set();
    const fragment = document.createDocumentFragment();
    for (const name of visible) {
      const p = point(name);
      if (Math.abs(p.x - camera.x) > halfW || Math.abs(p.y - camera.y) > halfH) continue;
      inView.add(name);
      const current = name === game.current;
      const reachable = available.has(name);
      const visited = game.visited.has(name);
      // Отмечаем персонажей только в уже исследованных комнатах.
      const charactersHere = visited ? charactersByLocation.get(name) || [] : [];
      const node = document.createElement(reachable ? 'button' : 'div');
      node.className = `map-node${current ? ' current' : ''}${reachable ? ' available' : ''}${visited ? '' : ' unknown'}`;
      node.style.left = `${p.x}px`;
      node.style.top = `${p.y}px`;
      const emblems = document.createElement('span');
      emblems.className = 'node-emblems';
      if (visited) {
        const roomIcon = document.createElement('span');
        roomIcon.className = 'map-emblem room-emblem';
        roomIcon.title = 'Исследованная комната';
        roomIcon.append(mapIcon('room'));
        emblems.append(roomIcon);
      } else {
        const closedIcon = document.createElement('span');
        closedIcon.className = 'map-emblem closed-emblem';
        closedIcon.title = 'Неизведанная комната';
        closedIcon.append(mapIcon('closed'));
        emblems.append(closedIcon);
      }
      if (current) {
        const playerIcon = document.createElement('span');
        playerIcon.className = 'map-emblem player-emblem';
        playerIcon.title = 'Игрок здесь';
        playerIcon.append(mapIcon('player'));
        emblems.append(playerIcon);
      }
      for (const character of charactersHere.slice(0, 3)) {
        const personIcon = document.createElement('span');
        personIcon.className = 'map-emblem character-emblem';
        personIcon.title = `Персонаж: ${character.name}`;
        personIcon.append(mapIcon('character'));
        emblems.append(personIcon);
      }
      if (charactersHere.length > 3) {
        const more = document.createElement('span');
        more.className = 'more-characters';
        more.textContent = `+${charactersHere.length - 3}`;
        more.title = charactersHere.slice(3).map(character => character.name).join(', ');
        emblems.append(more);
      }
      node.append(emblems);
      const title = document.createElement('span');
      title.className = 'node-name';
      title.textContent = visited ? name : 'Неизведано';
      node.append(title);
      const meta = document.createElement('span');
      meta.className = 'node-meta';
      meta.textContent = current ? 'Вы здесь' : reachable ? `${available.get(name)} · открыть` : 'Исследовано';
      node.append(meta);
      if (reachable) {
        node.type = 'button';
        node.dataset.destination = name;
        const who = charactersHere.length ? ` Персонажи: ${charactersHere.map(character => character.name).join(', ')}.` : '';
        node.setAttribute('aria-label', visited ? `Перейти: ${name}, ${available.get(name)}.${who}` : `Неизведанная локация, ${available.get(name)}. Перейти`);
      } else if (current) node.setAttribute('aria-current', 'location');
      if (visited) {
        node.title = charactersHere.length ? `${name} · ${charactersHere.map(character => character.name).join(', ')}` : name;
        if (!reachable) {
          node.setAttribute('role', 'img');
          node.setAttribute('aria-label', `Исследованная комната: ${name}${current ? '. Здесь игрок.' : ''}${charactersHere.length ? `. Здесь персонажи: ${charactersHere.map(character => character.name).join(', ')}.` : ''}`);
        }
      }
      fragment.append(node);
    }
    // Сохраняем клавиатурный фокус после изменения масштаба.
    const focusedDestination = nodes.contains(document.activeElement) ? document.activeElement.dataset.destination : null;
    nodes.replaceChildren(fragment);
    if (focusedDestination) {
      [...nodes.querySelectorAll('button')].find(node => node.dataset.destination === focusedDestination)?.focus({ preventScroll: true });
    }
    const edges = document.createDocumentFragment();
    const drawn = new Set();
    for (const name of inView) {
      if (!game.visited.has(name)) continue;
      for (const exit of world.locations.get(name).exits) {
        if (!visible.has(exit.target)) continue;
        const key = JSON.stringify([name, exit.target].sort());
        if (drawn.has(key)) continue;
        drawn.add(key);
        const a = point(name), b = point(exit.target);
        const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        for (const [key, value] of Object.entries({ x1: a.x, y1: a.y, x2: b.x, y2: b.y })) line.setAttribute(key, value);
        const active = (name === game.current && available.has(exit.target)) || (exit.target === game.current && available.has(name));
        line.setAttribute('class', `map-link${active ? ' available' : ''}`);
        edges.append(line);
      }
    }
    links.replaceChildren(edges);
    $('zoom-out').disabled = camera.zoom <= .5;
    $('zoom-in').disabled = camera.zoom >= 1.5;
  }
  function start(source) {
    world = QuestWorld.parseWorld(source);
    game = null;
    void music.stop();
    $('loading').hidden = true;
    $('error-panel').hidden = true;
    $('game').hidden = true;
    $('ending-panel').hidden = true;
    $('start-screen').hidden = false;
    $('offline-world').hidden = true;
    updateSoundControl();
    $('start-title').focus({ preventScroll: true });
  }
  function showError(error) {
    void music.stop();
    $('loading').hidden = true;
    $('start-screen').hidden = true;
    $('game').hidden = true;
    $('ending-panel').hidden = true;
    $('error-panel').hidden = false;
    $('error-message').textContent = error.message;
  }
  async function load() {
    const version = ++loadingVersion;
    $('loading').hidden = false;
    $('error-panel').hidden = true;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);
    try {
      const result = await QuestLoader.loadSource({
        protocol: location.protocol,
        fallback: JSON.parse($('world-snapshot').textContent),
        fetchText: async () => {
          const response = await fetch(new URL('./map.txt', document.baseURI), { cache: 'no-cache', signal: controller.signal });
          if (!response.ok) throw new Error(`Не удалось загрузить map.txt: HTTP ${response.status}.`);
          return response.text();
        }
      });
      if (version === loadingVersion) {
        start(result.source);
        $('offline-world').hidden = !result.offline;
      }
    } catch (error) {
      if (version === loadingVersion) {
        if (error instanceof TypeError || error.name === 'AbortError') {
          showError(new Error('Не удалось загрузить мир. Выберите map.txt из папки игры кнопкой ниже.'));
        } else showError(error);
      }
    } finally { clearTimeout(timeout); }
  }
  nodes.addEventListener('click', event => {
    if (suppressClick) { suppressClick = false; return; }
    const button = event.target.closest('button[data-destination]');
    if (button && game.move(button.dataset.destination)) {
      renderStory(true);
      void playMusic(game.current);
    }
  });
  viewport.addEventListener('pointerdown', event => {
    if (event.button !== 0 || !event.isPrimary) return;
    suppressClick = false;
    drag = { id: event.pointerId, x: event.clientX, y: event.clientY, cx: camera.x, cy: camera.y, moved: false };
  });
  viewport.addEventListener('pointermove', event => {
    if (!drag || drag.id !== event.pointerId) return;
    const dx = event.clientX - drag.x, dy = event.clientY - drag.y;
    if (!drag.moved && Math.hypot(dx, dy) < 7) return;
    if (!drag.moved) viewport.setPointerCapture(event.pointerId);
    drag.moved = true;
    viewport.classList.add('dragging');
    camera.x = drag.cx - dx / camera.zoom;
    camera.y = drag.cy - dy / camera.zoom;
    scheduleMap();
  });
  function stopDrag(event) {
    if (!drag || (event && event.pointerId !== drag.id)) return;
    suppressClick = drag.moved;
    if (viewport.hasPointerCapture(drag.id)) viewport.releasePointerCapture(drag.id);
    drag = null;
    viewport.classList.remove('dragging');
  }
  window.addEventListener('pointerup', stopDrag);
  window.addEventListener('pointercancel', stopDrag);
  viewport.addEventListener('lostpointercapture', stopDrag);
  for (const [id, factor] of [['zoom-out', .8], ['zoom-in', 1.25]]) {
    $(id).addEventListener('click', () => {
      camera.zoom = Math.max(.5, Math.min(1.5, camera.zoom * factor));
      renderMap();
    });
  }
  $('recenter').addEventListener('click', recenter);
  const restart = () => { game = null; void music.stop(); $('game').hidden = true; $('ending-panel').hidden = true; $('start-screen').hidden = false; updateSoundControl(); $('start-title').focus({ preventScroll: true }); };
  $('restart').addEventListener('click', restart);
  $('ending-restart').addEventListener('click', restart);
  $('begin-game').addEventListener('click', () => {
    if (!world) return;
    game = new QuestWorld.Game(world);
    $('secrets-journal').open = false;
    // Клик пользователя разрешает браузеру запустить фоновую запись.
    void playMusic(game.current);
    renderStory(true);
  });
  $('sound-toggle').addEventListener('click', async () => {
    try { await music.toggle(); }
    catch (error) { console.warn('Не удалось переключить музыку:', error); music.isMuted = true; }
    updateSoundControl();
  });
  $('retry').addEventListener('click', load);
  for (const id of ['world-file', 'local-world-file']) $(id).addEventListener('change', async event => {
    const file = event.target.files[0];
    if (!file) return;
    const version = ++loadingVersion;
    try { const source = await file.text(); if (version === loadingVersion) start(source); }
    catch (error) { if (version === loadingVersion) showError(error); }
    event.target.value = '';
  });
  new ResizeObserver(recenter).observe(viewport);
  load();
})();
