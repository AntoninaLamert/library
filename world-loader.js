/* TXT остаётся основным источником; сохранённая копия позволяет играть с диска. */
(function (root) {
  'use strict';
  async function loadSource({ protocol, fallback, fetchText }) {
    if (protocol !== 'file:') {
      try { return { source: await fetchText(), offline: false }; }
      catch (error) { if (!fallback) throw error; }
    }
    if (!fallback) throw new Error('Не найдена сохранённая карта. Выберите map.txt вручную.');
    return { source: fallback, offline: true };
  }
  const api = { loadSource };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.QuestLoader = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
