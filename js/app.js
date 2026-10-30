'use strict';
/* ============================================================
   App — точка входа: тулбар, страницы, управление симуляцией,
   журнал, импорт/экспорт, связь Engine ↔ MapView ↔ Panel.
   ============================================================ */

const App = {
  sel: { entityId: null, tab: 'params', nodeId: null, impact: null },

  init() {
    Store.init();
    Store.onSaved = () => this.setStatus('✓ сохранено');

    MapView.init();
    Panel.init();

    this._bindEngineHooks();
    this._bindToolbar();

    Engine.speed = Store.state.simSpeed || 1;
    document.getElementById('selSpeed').value = String(Engine.speed);
    Engine.reset(true);

    this.refresh();
    MapView.fit();
    this.log('Добро пожаловать в GameFlow! Нажмите «▶ Старт» для запуска симуляции. Клик по сущности — настройки. «?» — справка.', 'sys');
  },

  /* ---------- общее ---------- */

  refresh() {
    this.renderTabs();
    MapView.render();
    Panel.render();
    this.updatePlayBtn();
    this.updateTime();
  },

  onDataChange() {
    MapView.render();
    Panel.render();
  },

  setStatus(text) {
    const el = document.getElementById('saveStatus');
    el.textContent = text;
    el.classList.add('on');
    clearTimeout(this._stTimer);
    this._stTimer = setTimeout(() => el.classList.remove('on'), 1200);
  },

  selectEntity(id) {
    this.sel = { entityId: id, tab: 'params', nodeId: null, impact: null };
    MapView.setHighlight(null);
    MapView.render();
    Panel.render();
  },

  addEntity(x, y) {
    const page = Store.page();
    if (!page) return;
    const idx = page.entities.length;
    if (x === undefined) {
      const vb = MapView.vb;
      x = Math.round(vb.x + vb.w / 2 + (idx % 3) * 60 - 60);
      y = Math.round(vb.y + vb.h / 2 + Math.floor(idx / 3) * 60 - 60);
    }
    const ent = normEntity({
      id: U.uid(),
      name: 'Сущность ' + (idx + 1),
      x, y,
      color: U.PALETTE_ENT[idx % U.PALETTE_ENT.length],
      enabled: true, params: [],
      events: { nodes: [], edges: [], entryId: null, autoLoop: true },
    }, idx);
    page.entities.push(ent);
    Store.save();
    if (!Engine.running) Engine.reset(true);
    this.selectEntity(ent.id);
    MapView.render();
  },

  /* ---------- страницы ---------- */

  renderTabs() {
    const box = document.getElementById('pageTabs');
    box.innerHTML = Store.state.pages.map(p =>
      '<div class="tab ' + (p.id === Store.state.activePageId ? 'on' : '') + '" data-id="' + p.id + '" title="Двойной клик — переименовать">' +
        '<span class="tab-name">' + U.esc(U.trunc(p.name, 18)) + '</span>' +
      '</div>').join('');
  },

  switchPage(id) {
    if (Store.state.activePageId === id) return;
    Store.state.activePageId = id;
    Store.save();
    this.sel = { entityId: null, tab: 'params', nodeId: null, impact: null };
    Engine.reset(true);
    this.refresh();
    MapView.fit();
  },

  /* ---------- тулбар ---------- */

  _bindToolbar() {
    const $ = id => document.getElementById(id);

    // страницы
    $('pageTabs').addEventListener('click', e => {
      const tab = e.target.closest('.tab');
      if (tab) this.switchPage(tab.dataset.id);
    });
    $('pageTabs').addEventListener('dblclick', e => {
      const tab = e.target.closest('.tab');
      if (!tab) return;
      const p = Store.state.pages.find(x => x.id === tab.dataset.id);
      if (!p) return;
      const name = prompt('Название страницы:', p.name);
      if (name !== null && name.trim()) { p.name = name.trim(); Store.save(); this.renderTabs(); }
    });
    $('btnAddPage').addEventListener('click', () => {
      const name = prompt('Название новой страницы:', 'Страница ' + (Store.state.pages.length + 1));
      if (name === null) return;
      Store.addPage(name.trim() || undefined);
      this.sel = { entityId: null, tab: 'params', nodeId: null, impact: null };
      Engine.reset(true);
      this.refresh();
      MapView.fit();
    });
    $('btnDelPage').addEventListener('click', () => {
      const p = Store.page();
      if (!p) return;
      if (Store.state.pages.length <= 1) { alert('Это единственная страница. Используйте «очистить».'); return; }
      if (!confirm('Удалить страницу «' + p.name + '» со всеми схемами?')) return;
      Store.removePage(p.id);
      this.sel = { entityId: null, tab: 'params', nodeId: null, impact: null };
      Engine.reset(true);
      this.refresh();
      MapView.fit();
    });
    $('btnClearPage').addEventListener('click', () => {
      const p = Store.page();
      if (!p) return;
      if (!confirm('Очистить страницу «' + p.name + '»: удалить все сущности и схемы?')) return;
      Store.clearPage();
      this.sel = { entityId: null, tab: 'params', nodeId: null, impact: null };
      Engine.reset(true);
      this.refresh();
    });

    // симуляция
    $('btnPlay').addEventListener('click', () => Engine.toggle());
    $('btnReset').addEventListener('click', () => {
      Engine.reset();
      MapView.clearActive();
      MapView.refreshValues();
      Panel.render();
    });
    $('selSpeed').addEventListener('change', e => {
      Engine.setSpeed(parseFloat(e.target.value) || 1);
      this.setStatus('скорость ×' + Engine.speed);
    });

    // сущность / карта
    $('btnAddEnt').addEventListener('click', () => this.addEntity());
    $('btnFit').addEventListener('click', () => MapView.fit());

    // журнал
    $('btnToggleLog').addEventListener('click', () => {
      const w = $('logWrap');
      w.classList.toggle('collapsed');
      $('btnToggleLog').textContent = w.classList.contains('collapsed') ? '▲' : '▼';
    });
    $('btnClearLog').addEventListener('click', () => { $('logList').innerHTML = ''; this._logCount = 0; $('logCount').textContent = ''; });

    // импорт / экспорт
    $('btnExport').addEventListener('click', () => {
      const blob = new Blob([Store.exportAll()], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'gameflow-scheme.json';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
      this.log('⇩ Схема экспортирована в gameflow-scheme.json', 'sys');
    });
    $('btnImport').addEventListener('click', () => $('fileImport').click());
    $('fileImport').addEventListener('change', e => {
      const file = e.target.files[0];
      e.target.value = '';
      if (!file) return;
      if (!confirm('Импортировать «' + file.name + '»? Текущие страницы будут заменены данными файла.')) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const n = Store.importAll(String(reader.result));
          this.sel = { entityId: null, tab: 'params', nodeId: null, impact: null };
          Engine.reset(true);
          this.refresh();
          MapView.fit();
          this.log('⇧ Импортировано страниц: ' + n, 'sys');
        } catch (err) {
          alert('Ошибка импорта: ' + err.message);
        }
      };
      reader.readAsText(file);
    });

    // справка
    $('btnHelp').addEventListener('click', () => $('helpModal').classList.remove('hidden'));
    $('btnCloseHelp').addEventListener('click', () => $('helpModal').classList.add('hidden'));
    $('helpModal').addEventListener('click', e => { if (e.target === $('helpModal')) $('helpModal').classList.add('hidden'); });

    // клавиатура
    document.addEventListener('keydown', e => {
      const tag = e.target.tagName;
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
      if (e.code === 'Space') { e.preventDefault(); Engine.toggle(); }
      else if (e.code === 'Delete' && this.sel.nodeId && this.sel.entityId && this.sel.tab === 'events') {
        const btn = document.querySelector('[data-act="del-node"]');
        if (btn) btn.click();
      }
      else if (e.code === 'Escape') {
        if (!$('helpModal').classList.contains('hidden')) $('helpModal').classList.add('hidden');
        else if (this.sel.impact) { this.sel.impact = null; MapView.setHighlight(null); Panel.render(); }
      }
    });
  },

  /* ---------- движок: хуки ---------- */

  _bindEngineHooks() {
    Engine.hooks.onEnter = (entityId, nodeId) => {
      MapView.setActive(entityId, nodeId);
      Panel.markActive(entityId, nodeId, true);
    };
    Engine.hooks.onExit = (entityId, nodeId) => {
      Panel.markActive(entityId, nodeId, false);
    };
    Engine.hooks.onApply = info => {
      const sign = info.op === 'set' ? '= ' : info.op === 'mul' ? '× ' : (info.amount >= 0 ? '+' : '');
      MapView.showFx(info.targetEntityId, info.paramName + ' ' + sign + U.fmt(info.amount),
        info.op === 'add' ? (info.amount >= 0 ? 'fx-pos' : 'fx-neg') : 'fx-set');
      MapView.updateValue(info.paramId, info.val);
      Panel.updateParamValue(info.paramId, info.val);
    };
    Engine.hooks.onLog = (text, cls) => this.log(text, cls);
    Engine.hooks.onState = () => { this.updatePlayBtn(); };
    Engine.hooks.onTick = () => this.updateTime();
    Engine.hooks.onReset = () => {
      MapView.clearActive();
      MapView.refreshValues();
      Panel.render();
      this.updateTime();
    };
  },

  updatePlayBtn() {
    const b = document.getElementById('btnPlay');
    b.textContent = Engine.running ? '⏸ Пауза' : '▶ Старт';
    b.classList.toggle('playing', Engine.running);
  },

  updateTime() {
    document.getElementById('simTime').textContent = U.fmt(Engine.time) + ' с';
  },

  /* ---------- журнал ---------- */

  _logCount: 0,

  log(text, cls) {
    const list = document.getElementById('logList');
    if (!list) return;
    const div = document.createElement('div');
    div.className = 'log-line ' + (cls || '');
    div.textContent = text;
    list.appendChild(div);
    this._logCount++;
    while (list.children.length > 400) list.removeChild(list.firstChild);
    list.scrollTop = list.scrollHeight;
    const c = document.getElementById('logCount');
    if (c) c.textContent = this._logCount + ' записей';
    // при запуске автоматически раскрываем журнал
    const w = document.getElementById('logWrap');
    if (cls === 'sys' && w.classList.contains('collapsed') && this._logCount <= 2) {
      w.classList.remove('collapsed');
      document.getElementById('btnToggleLog').textContent = '▼';
    }
  },
};

document.addEventListener('DOMContentLoaded', () => App.init());
