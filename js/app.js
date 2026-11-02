'use strict';
/* ============================================================
   App — точка входа: тулбар, менеджер страниц ( popover со
   списком, массовые операции), resizable-панели, управление
   симуляцией (включая пошаговый шаг и стоп-условие), журнал,
   импорт/экспорт, связь Engine ↔ MapView ↔ Panel.
   ============================================================ */

const App = {
  sel: { entityId: null, tab: 'params', nodeId: null, impact: null },
  _pmSel: new Set(),   // выбранные страницы в менеджере
  _logCount: 0,

  init() {
    Store.init();
    Store.onSaved = () => this.setStatus('✓ сохранено');

    MapView.init();
    Panel.init();
    AC.init();

    this._bindEngineHooks();
    this._bindToolbar();
    this._applyUiPrefs();

    Engine.speed = Store.state.simSpeed || 1;
    document.getElementById('selSpeed').value = String(Engine.speed);
    Engine.stopCond = Store.state.ui.stopCond || '';
    document.getElementById('inpStopCond').value = Engine.stopCond;
    Engine.reset(true);

    this.refresh();
    MapView.fit();
    this.log('Добро пожаловать в GameFlow! Нажмите «▶ Старт» для запуска симуляции. Клик по сущности — настройки. «?» — справка.', 'sys');
  },

  /* ---------- настройки интерфейса ---------- */

  _applyUiPrefs() {
    const ui = Store.state.ui;
    document.getElementById('panel').style.setProperty('--panelW', ui.panelW + 'px');
    document.getElementById('logWrap').style.setProperty('--logH', ui.logH + 'px');
  },

  /* ---------- общее ---------- */

  refresh() {
    this.renderPages();
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

  /* ---------- менеджер страниц ---------- */

  renderPages() {
    const cur = Store.page();
    const btn = document.getElementById('btnPages');
    btn.innerHTML = '📄 <span class="pages-cur">' + U.esc(cur ? cur.name : '—') + '</span> <span class="dim">(' + Store.state.pages.length + ')</span>';
    if (!document.getElementById('pageMgr').classList.contains('hidden')) this.renderPageMgr();
  },

  renderPageMgr() {
    const box = document.getElementById('pageMgr');
    const curId = Store.state.activePageId;
    const rows = Store.state.pages.map(p => {
      const dup = / \(дубль \d+\)$/.test(p.name);
      return '<div class="pm-row ' + (p.id === curId ? 'on' : '') + '" data-id="' + p.id + '">' +
        '<input type="checkbox" class="pm-chk" data-id="' + p.id + '" ' + (this._pmSel.has(p.id) ? 'checked' : '') + ' title="Выделить для массовых операций">' +
        '<span class="pm-name" data-open="' + p.id + '" title="Открыть страницу">' + U.esc(p.name) + (dup ? ' <span class="pm-dup">дубль</span>' : '') + '</span>' +
        (p.id === curId ? '<span class="pm-cur">активна</span>' : '') +
        '<button class="ibtn" data-pm="rename" data-id="' + p.id + '" title="Переименовать">✎</button>' +
      '</div>';
    }).join('');
    box.innerHTML =
      '<div class="pm-head">Страницы схем <span class="dim">(' + Store.state.pages.length + ')</span>' +
        '<button class="ibtn" data-pm="close" title="Закрыть">✕</button></div>' +
      '<div class="pm-list">' + rows + '</div>' +
      '<div class="pm-foot">' +
        '<button class="tbtn small" data-pm="add">＋ Добавить</button>' +
        '<button class="tbtn small danger" data-pm="del-sel">🗑 Удалить выбранные</button>' +
        '<button class="tbtn small" data-pm="strip" title="Снять пометки «(дубль N)», если базовое имя свободно">✂ Убрать пометки дублей</button>' +
      '</div>';
  },

  openPageMgr(show) {
    const box = document.getElementById('pageMgr');
    if (show === undefined) show = box.classList.contains('hidden');
    box.classList.toggle('hidden', !show);
    if (show) this.renderPageMgr();
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

    // менеджер страниц
    $('btnPages').addEventListener('click', () => this.openPageMgr());
    $('pageMgr').addEventListener('click', e => {
      const pm = e.target.closest('[data-pm]');
      const open = e.target.closest('[data-open]');
      const chk = e.target.closest('.pm-chk');
      if (chk) {
        if (chk.checked) this._pmSel.add(chk.dataset.id); else this._pmSel.delete(chk.dataset.id);
        return;
      }
      if (open) { this.switchPage(open.dataset.open); this.renderPageMgr(); return; }
      if (!pm) return;
      const act = pm.dataset.pm;
      if (act === 'close') this.openPageMgr(false);
      else if (act === 'add') {
        const name = prompt('Название новой страницы:', 'Страница ' + (Store.state.pages.length + 1));
        if (name === null) return;
        Store.addPage(name.trim() || undefined);
        this.sel = { entityId: null, tab: 'params', nodeId: null, impact: null };
        this._pmSel.clear();
        Engine.reset(true);
        this.refresh();
        MapView.fit();
        this.renderPageMgr();
      }
      else if (act === 'rename') {
        const p = Store.state.pages.find(x => x.id === pm.dataset.id);
        if (!p) return;
        const name = prompt('Название страницы:', p.name);
        if (name !== null && name.trim()) { p.name = name.trim(); Store.save(); this.renderPages(); this.renderPageMgr(); }
      }
      else if (act === 'del-sel') {
        if (!this._pmSel.size) { alert('Сначала отметьте страницы галочками.'); return; }
        if (this._pmSel.size >= Store.state.pages.length) { alert('Нельзя удалить все страницы: оставьте хотя бы одну.'); return; }
        if (!confirm('Удалить выбранные страницы (' + this._pmSel.size + ') со всеми схемами?')) return;
        const ids = Array.from(this._pmSel);
        Store.state.pages = Store.state.pages.filter(p => !ids.includes(p.id));
        if (ids.includes(Store.state.activePageId)) Store.state.activePageId = Store.state.pages[0].id;
        this._pmSel.clear();
        Store.save();
        this.sel = { entityId: null, tab: 'params', nodeId: null, impact: null };
        Engine.reset(true);
        this.refresh();
        MapView.fit();
        this.renderPageMgr();
        this.log('🗑 Удалено страниц: ' + ids.length, 'sys');
      }
      else if (act === 'strip') {
        const ids = this._pmSel.size ? Array.from(this._pmSel) : null;
        const n = Store.stripDupMarks(ids);
        this.renderPages(); this.renderPageMgr();
        this.log(n ? '✂ Снято пометок дублей: ' + n : '✂ Нечего снимать: пометок нет или базовые имена заняты', 'sys');
      }
    });
    document.addEventListener('click', e => {
      if (!e.target.closest('#pageMgr') && !e.target.closest('#btnPages')) this.openPageMgr(false);
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
    $('btnStep').addEventListener('click', () => {
      const sec = U.num($('stepSize').value, 1);
      Engine.advance(sec);
      MapView.refreshValues();
      this.log('⏭ Шаг +' + U.fmt(sec) + 'с (время: ' + U.fmt(Engine.time) + 'с)', 'sys');
    });
    $('selSpeed').addEventListener('change', e => {
      Engine.setSpeed(parseFloat(e.target.value) || 1);
      this.setStatus('скорость ×' + Engine.speed);
    });
    $('inpStopCond').addEventListener('input', e => {
      Engine.stopCond = e.target.value;
      Store.state.ui.stopCond = e.target.value;
      Store.save();
    });

    // сущность / карта
    $('btnAddEnt').addEventListener('click', () => this.addEntity());
    $('btnFit').addEventListener('click', () => MapView.fit());

    // ресайз панелей
    this._bindSplitters();

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
      if (!confirm('Добавить страницы из «' + file.name + '» к текущим? Существующие страницы не затрагиваются; совпавшие названия получат пометку «(дубль N)».')) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const added = Store.importAppend(String(reader.result));
          this.sel = { entityId: null, tab: 'params', nodeId: null, impact: null };
          Engine.reset(true);
          this.refresh();
          MapView.fit();
          this.log('⇧ Добавлено страниц: ' + added.length + ' (' + added.map(p => p.name).join(', ') + ')', 'sys');
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
        else if (!$('pageMgr').classList.contains('hidden')) this.openPageMgr(false);
        else if (this.sel.impact) { this.sel.impact = null; MapView.setHighlight(null); Panel.render(); }
      }
    });
  },

  /* ---------- ресайз панелей ---------- */

  _bindSplitters() {
    const panel = document.getElementById('panel');
    const split = document.getElementById('splitter');
    let drag = null;

    split.addEventListener('pointerdown', e => {
      drag = true;
      try { split.setPointerCapture(e.pointerId); } catch (err) {}
      document.body.classList.add('resizing');
      e.preventDefault();
    });
    split.addEventListener('pointermove', e => {
      if (!drag) return;
      const main = document.getElementById('main').getBoundingClientRect();
      const w = U.clamp(Math.round(main.right - e.clientX), 320, Math.max(360, main.width - 260));
      panel.style.setProperty('--panelW', w + 'px');
      Store.state.ui.panelW = w;
    });
    split.addEventListener('pointerup', () => {
      if (!drag) return;
      drag = null;
      document.body.classList.remove('resizing');
      Store.save();
    });

    const logSplit = document.getElementById('logSplit');
    const logWrap = document.getElementById('logWrap');
    let ldrag = false;
    logSplit.addEventListener('pointerdown', e => {
      ldrag = true;
      try { logSplit.setPointerCapture(e.pointerId); } catch (err) {}
      document.body.classList.add('resizing');
      e.preventDefault();
    });
    logSplit.addEventListener('pointermove', e => {
      if (!ldrag) return;
      const h = U.clamp(Math.round(logWrap.getBoundingClientRect().bottom - e.clientY), 70, 600);
      logWrap.style.setProperty('--logH', h + 'px');
      logWrap.classList.remove('collapsed');
      document.getElementById('btnToggleLog').textContent = '▼';
      Store.state.ui.logH = h;
    });
    logSplit.addEventListener('pointerup', () => {
      if (!ldrag) return;
      ldrag = false;
      document.body.classList.remove('resizing');
      Store.save();
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
      MapView.showFx(info.targetEntityId, info.paramName + ' ' + info.display, info.cls);
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
    const w = document.getElementById('logWrap');
    if (cls === 'sys' && w.classList.contains('collapsed') && this._logCount <= 2) {
      w.classList.remove('collapsed');
      document.getElementById('btnToggleLog').textContent = '▼';
    }
  },
};

document.addEventListener('DOMContentLoaded', () => App.init());
