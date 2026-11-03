'use strict';
/* ============================================================
   Panel — правая панель: параметры сущности (тип, старт, min/max,
   текущее), редактор дерева событий на бесконечном полотне
   (drag-n-drop нод, связи через порт, прокрутка в любые стороны),
   инспектор ноды (воздействия с шансами-формулами, переходы,
   повторы с приоритетом) и панель воздействий на параметр.
   Позиции прокрутки сохраняются между перерисовками и вкладками.
   ============================================================ */

const TREE_OFF = 2000;   // смещение мира дерева в координаты svg (полотно 4000×4000)
const TREE_SIZE = 4000;

const Panel = {
  el: null,
  NW: 150, NH: 52,
  _tree: null,
  _scrollMem: {},
  _curKey: null,

  init() {
    this.el = document.getElementById('panel');
    this.el.addEventListener('click', e => this._onClick(e));
    this.el.addEventListener('input', e => this._onInput(e));
    this.el.addEventListener('change', e => this._onInput(e));
  },

  /* ================= прокрутка ================= */

  _captureScrolls() {
    const caps = {};
    const pb = this.el.querySelector('.p-body');
    if (pb) caps.pb = pb.scrollTop;
    const ts = this.el.querySelector('.tree-scroll');
    if (ts) caps.ts = [ts.scrollLeft, ts.scrollTop];
    const ins = document.getElementById('inspector');
    if (ins) caps.ins = ins.scrollTop;
    return caps;
  },

  /* ================= рендер ================= */

  render() {
    const sel = App.sel;
    const prevKey = this._curKey;
    const caps = this._captureScrolls();
    if (prevKey) this._scrollMem[prevKey] = caps;

    if (sel.impact) { this._curKey = 'impact'; this.renderImpact(); this._restoreScrolls('impact'); return; }
    const ent = sel.entityId ? Store.entity(sel.entityId) : null;
    if (!ent) {
      this._curKey = 'none';
      MapView.setHighlight(null);
      this.el.innerHTML =
        '<div class="panel-hint">' +
        '<div class="ph-icon">🎯</div>' +
        '<p>Выберите сущность на карте (клик по точке), чтобы настроить её параметры и дерево событий.</p>' +
        '<p class="dim">Двойной клик по пустому месту карты создаст новую сущность.</p>' +
        '</div>';
      return;
    }
    MapView.setHighlight(null);

    const nP = ent.params.length, nN = ent.events.nodes.length;
    this.el.innerHTML =
      '<div class="p-header" style="--c:' + ent.color + '">' +
        '<span class="p-dot" style="background:' + ent.color + '"></span>' +
        '<input class="inp ent-name" data-inp="ent-name" value="' + U.esc(ent.name) + '" title="Название сущности">' +
        '<input type="color" class="color-inp" data-inp="ent-color" value="' + ent.color + '" title="Цвет сущности">' +
        '<label class="chk" title="Участвует ли сущность в симуляции"><input type="checkbox" data-inp="ent-enabled" ' + (ent.enabled ? 'checked' : '') + '>вкл</label>' +
        '<button class="ibtn danger" data-act="ent-del" title="Удалить сущность">🗑</button>' +
      '</div>' +
      '<div class="p-tabs">' +
        '<button class="ptab ' + (sel.tab === 'params' ? 'on' : '') + '" data-act="tab-params">Параметры (' + nP + ')</button>' +
        '<button class="ptab ' + (sel.tab === 'events' ? 'on' : '') + '" data-act="tab-events">События (' + nN + ')</button>' +
      '</div>' +
      '<div class="p-body">' + (sel.tab === 'params' ? this._paramsHTML(ent) : this._eventsHTML(ent)) + '</div>';

    this._curKey = sel.tab;
    if (sel.tab === 'events') {
      const memTs = this._scrollMem.events && this._scrollMem.events.ts;
      this.renderTree(ent, memTs);
      this.renderInspector(ent);
    }
    this._restoreScrolls(sel.tab);
  },

  _restoreScrolls(key) {
    const m = this._scrollMem[key];
    const pb = this.el.querySelector('.p-body');
    if (pb && m && m.pb) pb.scrollTop = m.pb;
    const ins = document.getElementById('inspector');
    if (ins && m && m.ins) ins.scrollTop = m.ins;
  },

  _paramsHTML(ent) {
    const cards = ent.params.map(p => {
      const v = Engine.values[p.id] !== undefined ? Engine.values[p.id] : p.value;
      let start;
      if (p.type === 'bool') start = '<label class="chk"><input type="checkbox" data-inp="param-start" data-id="' + p.id + '" ' + (p.value ? 'checked' : '') + '> старт</label>';
      else if (p.type === 'text') start = '<input class="inp" data-inp="param-start" data-id="' + p.id + '" value="' + U.esc(p.value) + '">';
      else start = '<input class="inp num" type="number" step="any" data-inp="param-start" data-id="' + p.id + '" value="' + p.value + '" title="Стартовое значение">';
      const mm = p.type === 'num'
        ? '<label>мин <input class="inp num" type="number" step="any" data-inp="param-min" data-id="' + p.id + '" value="' + (p.min === null || p.min === undefined ? '' : p.min) + '"></label>' +
          '<label>макс <input class="inp num" type="number" step="any" data-inp="param-max" data-id="' + p.id + '" value="' + (p.max === null || p.max === undefined ? '' : p.max) + '"></label>'
        : '<span class="dim">' + (p.type === 'bool' ? 'да / нет' : 'текст') + '</span>';
      return '<div class="p-row">' +
        '<div class="p-row1">' +
          '<input class="inp name" data-inp="param-name" data-id="' + p.id + '" value="' + U.esc(p.name) + '" title="Имя параметра (в формулах имена с пробелами — в кавычках: &quot;имя&quot;)">' +
          '<select class="inp type-sel" data-inp="param-type" data-id="' + p.id + '" title="Тип параметра">' +
            '<option value="num"' + (p.type === 'num' ? ' selected' : '') + '>число</option>' +
            '<option value="text"' + (p.type === 'text' ? ' selected' : '') + '>текст</option>' +
            '<option value="bool"' + (p.type === 'bool' ? ' selected' : '') + '>булев</option>' +
          '</select>' +
          '<span class="cur-val" id="pv-' + p.id + '" title="Текущее значение">' + U.fmtVal(v) + '</span>' +
          '<button class="ibtn" data-act="param-impact" data-id="' + p.id + '" title="Кто меняет этот параметр?">🔍</button>' +
          '<button class="ibtn danger" data-act="param-del" data-id="' + p.id + '" title="Удалить параметр">✕</button>' +
        '</div>' +
        '<div class="p-row2"><span class="dim">старт:</span>' + start + mm + '</div>' +
      '</div>';
    }).join('');
    return '<div class="p-scroll">' +
      (cards || '<div class="insp-empty">Нет параметров</div>') +
      '<button class="tbtn" data-act="add-param">＋ Параметр</button>' +
      '<div class="hint">В формулах событий параметры доступны как <code>имя</code> (свои) или <code>Сущность.имя</code> (глобально); имена с пробелами — в кавычках: <code>"в войне"</code>. При вводе формулы появляется список автоподстановки. Клик по 🔍 — панель воздействий.</div>' +
      '</div>';
  },

  _eventsHTML(ent) {
    const en = ent.events;
    const opts = en.nodes.map(n =>
      '<option value="' + n.id + '" ' + (n.id === en.entryId ? 'selected' : '') + '>' + U.esc(U.trunc(n.name, 18)) + '</option>').join('');
    const jumpOpts = en.nodes.map(n =>
      '<option value="' + n.id + '" ' + (n.id === App.sel.nodeId ? 'selected' : '') + '>' + U.esc(U.trunc(n.name, 22)) + '</option>').join('');
    return '' +
      '<div class="ev-toolbar">' +
        '<button class="tbtn" data-act="add-node">＋ Событие</button>' +
        '<label class="chk" title="Если нет доступных переходов — возврат в точку входа"><input type="checkbox" data-inp="autoloop" ' + (en.autoLoop ? 'checked' : '') + '>Автоцикл</label>' +
        '<label class="entry-lbl" title="Стартовая нода и точка возврата при автоцикле">Вход: <select data-inp="entry">' + (opts || '<option value="">—</option>') + '</select></label>' +
        '<label class="entry-lbl" title="Показать на полотне и открыть настройки события (работает даже если нода далеко за пределами экрана)">Событие: <select data-inp="jump-node"><option value="">— выбрать —</option>' + jumpOpts + '</select></label>' +
      '</div>' +
      '<div class="tree-scroll"><svg id="treeSvg" width="' + TREE_SIZE + '" height="' + TREE_SIZE + '"></svg></div>' +
      '<div class="hint tree-hint">Двойной клик по полю — новое событие · клик по ноде — настройки · тяните от <span class="port-ico">◆</span> к другой ноде — создать переход · полотно прокручивается в любые стороны</div>' +
      '<div id="inspector"></div>';
  },

  /* ================= дерево событий ================= */

  renderTree(ent, savedScroll, centerOn) {
    const svg = document.getElementById('treeSvg');
    if (!svg) return;
    const en = ent.events;
    svg.innerHTML = '';

    let defs = '<defs>';
    const colors = new Set(en.nodes.map(n => n.color || '#8b98ad'));
    for (const c of colors) {
      defs += '<marker id="tmk-' + c.replace('#', '') + '" viewBox="0 0 8 6" refX="7" refY="3" markerWidth="9" markerHeight="9" orient="auto-start-reverse" markerUnits="userSpaceOnUse"><path d="M0,0 L8,3 L0,6 Z" fill="' + c + '"/></marker>';
    }
    defs += '</defs>';
    svg.insertAdjacentHTML('beforeend', defs);
    svg.insertAdjacentHTML('beforeend', '<rect class="tree-bg" x="0" y="0" width="' + TREE_SIZE + '" height="' + TREE_SIZE + '" fill="transparent"/>');

    const gE = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    const gN = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    svg.appendChild(gE); svg.appendChild(gN);

    this._drawTreeEdges(ent, gE);

    for (const n of en.nodes) {
      const sel = App.sel.nodeId === n.id ? ' sel' : '';
      const entry = en.entryId === n.id ? ' entry' : '';
      const act = (App.sel.entityId === ent.id && Engine.activeNode(ent.id) === n.id) ? ' act' : '';
      const sub = '⏱ ' + U.fmt(n.duration) + 'с · ↯ ' + n.effects.length +
        (parseFloat(n.repeatChance) > 0 || !/^\d+(\.\d+)?$/.test(String(n.repeatChance).trim()) ? ' · ⟳ ' + n.repeatChance + '%' : '');
      gN.insertAdjacentHTML('beforeend',
        '<g class="tnode' + sel + entry + act + '" data-id="' + n.id + '" transform="translate(' + (n.x + TREE_OFF) + ',' + (n.y + TREE_OFF) + ')">' +
          '<rect class="tnode-body" width="' + this.NW + '" height="' + this.NH + '" rx="9" style="stroke:' + (n.color || '#8b98ad') + '"/>' +
          '<rect class="tnode-bar" width="7" height="' + this.NH + '" rx="3.5" fill="' + (n.color || '#8b98ad') + '"/>' +
          '<text class="tnode-name" x="15" y="21">' + U.esc(U.trunc(n.name, 17)) + '</text>' +
          '<text class="tnode-sub" x="15" y="40">' + U.esc(sub) + '</text>' +
          (en.entryId === n.id ? '<text class="tnode-entry" x="15" y="-6">▶ старт/возврат</text>' : '') +
          '<circle class="tport" cx="' + this.NW + '" cy="' + (this.NH / 2) + '" r="6.5" fill="' + (n.color || '#8b98ad') + '" title="Тяните к другой ноде, чтобы создать переход"/>' +
        '</g>');
    }

    // прокрутка: сохранённая позиция или центрирование на нужной ноде/точке входа
    const ts = svg.parentElement;
    if (savedScroll && !centerOn) {
      ts.scrollLeft = savedScroll[0];
      ts.scrollTop = savedScroll[1];
    } else {
      const focus = (centerOn && en.nodes.find(n => n.id === centerOn)) ||
        en.nodes.find(n => n.id === en.entryId) || en.nodes[0];
      const cx = (focus ? focus.x : 0) + TREE_OFF + this.NW / 2;
      const cy = (focus ? focus.y : 0) + TREE_OFF + this.NH / 2;
      ts.scrollLeft = Math.max(0, cx - ts.clientWidth / 2);
      ts.scrollTop = Math.max(0, cy - ts.clientHeight / 2);
    }

    // слушатели вешаются один раз на жизнь svg-элемента,
    // иначе повторные renderTree накапливают обработчики
    // (dblclick создавал бы несколько нод подряд)
    if (!svg._gfBound) {
      this._bindTree(svg, ent);
      svg._gfBound = true;
    }
  },

  _drawTreeEdges(ent, gE) {
    const en = ent.events;
    for (const ed of en.edges) {
      const sn = en.nodes.find(n => n.id === ed.from);
      const tn = en.nodes.find(n => n.id === ed.to);
      if (!sn || !tn) continue;
      const a1 = this._anchor(sn, tn.x + this.NW / 2, tn.y + this.NH / 2);
      const a2 = this._anchor(tn, sn.x + this.NW / 2, sn.y + this.NH / 2);
      const color = sn.color || '#8b98ad';
      const parts = [];
      if (ed.condition) parts.push(U.trunc(ed.condition, 16));
      if (String(ed.chance) !== '100') parts.push(ed.chance + '%');
      if (ed.priority) parts.push('пр' + ed.priority);
      const label = parts.join(' · ');
      const mx = (a1.x + a2.x) / 2 + TREE_OFF, my = (a1.y + a2.y) / 2 + TREE_OFF;
      gE.insertAdjacentHTML('beforeend',
        '<g class="tedge" data-id="' + ed.id + '">' +
          '<line x1="' + (a1.x + TREE_OFF) + '" y1="' + (a1.y + TREE_OFF) + '" x2="' + (a2.x + TREE_OFF) + '" y2="' + (a2.y + TREE_OFF) + '" stroke="' + color + '" marker-end="url(#tmk-' + color.replace('#', '') + ')"/>' +
          (label ? '<text class="tedge-label" x="' + mx + '" y="' + (my - 6) + '" text-anchor="middle">' + U.esc(label) + '</text>' : '') +
          '<g class="edel" data-act="edge-del" data-id="' + ed.id + '" transform="translate(' + mx + ',' + (my + 8) + ')"><circle r="7.5"/><text y="3.5" text-anchor="middle">✕</text></g>' +
        '</g>');
    }
  },

  _anchor(node, tx, ty) {
    const cx = node.x + this.NW / 2, cy = node.y + this.NH / 2;
    const dx = tx - cx, dy = ty - cy;
    if (!dx && !dy) return { x: cx, y: cy };
    const sx = dx !== 0 ? (this.NW / 2 + 2) / Math.abs(dx) : Infinity;
    const sy = dy !== 0 ? (this.NH / 2 + 2) / Math.abs(dy) : Infinity;
    const s = Math.min(sx, sy);
    return { x: cx + dx * s, y: cy + dy * s };
  },

  _treePoint(svg, e) {
    const pt = svg.createSVGPoint();
    pt.x = e.clientX; pt.y = e.clientY;
    const m = svg.getScreenCTM();
    return m ? pt.matrixTransform(m.inverse()) : { x: 0, y: 0 };
  },

  _bindTree(svg, ent) {
    const self = this;
    svg.addEventListener('pointerdown', function (e) {
      const port = e.target.closest('.tport');
      const nodeG = e.target.closest('.tnode');
      if (port && nodeG) {
        e.stopPropagation();
        svg.setPointerCapture(e.pointerId);
        const p = self._treePoint(svg, e);
        self._tree = { mode: 'link', from: nodeG.dataset.id, line: null };
        const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        line.setAttribute('class', 'tlink-temp');
        line.setAttribute('x1', p.x); line.setAttribute('y1', p.y);
        line.setAttribute('x2', p.x); line.setAttribute('y2', p.y);
        svg.appendChild(line);
        self._tree.line = line;
        return;
      }
      if (nodeG && !e.target.closest('.edel')) {
        const id = nodeG.dataset.id;
        const node = ent.events.nodes.find(n => n.id === id);
        if (!node) return;
        if (App.sel.nodeId !== id) {
          App.sel.nodeId = id;
          svg.querySelectorAll('.tnode.sel').forEach(g => g.classList.remove('sel'));
          nodeG.classList.add('sel');
          self.renderInspector(ent);
        }
        svg.setPointerCapture(e.pointerId);
        const p = self._treePoint(svg, e);
        self._tree = { mode: 'drag', id, moved: false, sx: p.x, sy: p.y, ox: node.x, oy: node.y, g: nodeG };
        e.preventDefault();
      }
    });

    svg.addEventListener('pointermove', function (e) {
      const st = self._tree;
      if (!st) return;
      const p = self._treePoint(svg, e);
      if (st.mode === 'drag') {
        const node = ent.events.nodes.find(n => n.id === st.id);
        if (!node) return;
        if (Math.abs(p.x - st.sx) + Math.abs(p.y - st.sy) > 2) st.moved = true;
        node.x = U.clamp(Math.round(st.ox + p.x - st.sx), -TREE_OFF, TREE_SIZE - TREE_OFF - self.NW);
        node.y = U.clamp(Math.round(st.oy + p.y - st.sy), -TREE_OFF, TREE_SIZE - TREE_OFF - self.NH);
        st.g.setAttribute('transform', 'translate(' + (node.x + TREE_OFF) + ',' + (node.y + TREE_OFF) + ')');
        const gE = svg.querySelector('g');
        gE.innerHTML = '';
        self._drawTreeEdges(ent, gE);
      } else if (st.mode === 'link') {
        st.line.setAttribute('x2', p.x);
        st.line.setAttribute('y2', p.y);
      }
    });

    svg.addEventListener('pointerup', function (e) {
      const st = self._tree;
      if (!st) return;
      self._tree = null;
      if (st.mode === 'drag') {
        if (st.moved) Store.save();
      } else if (st.mode === 'link') {
        st.line.remove();
        const p = self._treePoint(svg, e);
        const wx = p.x - TREE_OFF, wy = p.y - TREE_OFF;
        const target = ent.events.nodes.find(n =>
          wx >= n.x && wx <= n.x + self.NW && wy >= n.y && wy <= n.y + self.NH);
        if (target && target.id !== st.from) {
          const exists = ent.events.edges.some(ed => ed.from === st.from && ed.to === target.id);
          if (!exists) {
            ent.events.edges.push({ id: U.uid(), from: st.from, to: target.id, condition: '', chance: '100', priority: 0 });
            Store.save();
            App.onDataChange();
          }
        }
      }
    });

    svg.addEventListener('dblclick', function (e) {
      if (e.target.closest('.tnode') || e.target.closest('.tedge')) return;
      const p = self._treePoint(svg, e);
      const idx = ent.events.nodes.length;
      const node = normNode({
        id: U.uid(),
        name: 'Событие ' + (idx + 1),
        x: Math.round(p.x - TREE_OFF - self.NW / 2),
        y: Math.round(p.y - TREE_OFF - self.NH / 2),
        color: U.PALETTE_NODE[idx % U.PALETTE_NODE.length],
        duration: 1, effects: [],
      }, idx);
      ent.events.nodes.push(node);
      if (!ent.events.entryId) ent.events.entryId = node.id;
      App.sel.nodeId = node.id;
      Store.save();
      App.onDataChange();
    });
  },

  /* ================= инспектор ноды ================= */

  _opOptions(type, cur) {
    const opts = type === 'bool' ? [['set', '= (по формуле)'], ['toggle', 'инверсия']]
      : type === 'text' ? [['set', '= (текст)']]
      : [['add', '+='], ['set', '='], ['mul', '×=']];
    if (!opts.some(o => o[0] === cur)) cur = opts[0][0];
    return { html: opts.map(o => '<option value="' + o[0] + '" ' + (o[0] === cur ? 'selected' : '') + '>' + o[1] + '</option>').join(''), cur };
  },

  renderInspector(ent) {
    const box = document.getElementById('inspector');
    if (!box) return;
    const node = ent.events.nodes.find(n => n.id === App.sel.nodeId);
    if (!node) {
      box.innerHTML = '<div class="insp-empty">Выберите событие в дереве, чтобы настроить его воздействия, переходы и повторы.</div>';
      return;
    }
    const page = Store.page();

    const fxRows = node.effects.map(f => {
      const te = Store.entity(f.targetEntityId) || ent;
      const tp = te.params.find(p => p.id === f.paramId);
      const type = tp ? tp.type : 'num';
      const ops = this._opOptions(type, f.op);
      f.op = ops.cur;
      const pOpts = te.params.map(p => '<option value="' + p.id + '" ' + (p.id === f.paramId ? 'selected' : '') + '>' + U.esc(p.name) + '</option>').join('');
      return '<div class="fx-row" data-fx="' + f.id + '">' +
        '<div class="fx-line1">' +
          '<select class="inp" data-inp="fx-field" data-fx="' + f.id + '" data-f="targetEntityId" title="Целевая сущность">' +
            page.entities.map(e => '<option value="' + e.id + '" ' + (e.id === f.targetEntityId ? 'selected' : '') + '>' + U.esc(U.trunc(e.name, 14)) + '</option>').join('') +
          '</select>' +
          '<select class="inp" data-inp="fx-field" data-fx="' + f.id + '" data-f="paramId" title="Целевой параметр">' + (pOpts || '<option value="">—</option>') + '</select>' +
          '<select class="inp op" data-inp="fx-field" data-fx="' + f.id + '" data-f="op" title="Операция (зависит от типа параметра)">' + ops.html + '</select>' +
          '<button class="ibtn danger" data-act="fx-del" data-id="' + f.id + '" title="Удалить воздействие">✕</button>' +
        '</div>' +
        '<div class="fx-line2">' +
          '<input class="inp fx-val ac" data-inp="fx-field" data-fx="' + f.id + '" data-f="value" value="' + U.esc(f.value) + '" placeholder="' + (type === 'text' ? 'текст для присваивания' : 'число или формула, напр. 10 + золото*0.1') + '" title="Величина изменения">' +
        '</div>' +
        '<div class="fx-line3">' +
          '<input class="inp fx-cond ac" data-inp="fx-field" data-fx="' + f.id + '" data-f="condition" value="' + U.esc(f.condition) + '" placeholder="условие (напр. золото &lt; 100)" title="Условие срабатывания">' +
          '<label title="Шанс срабатывания: число в % или формула (результат в %)">шанс<input class="inp chance ac" data-inp="fx-field" data-fx="' + f.id + '" data-f="chance" value="' + U.esc(f.chance) + '" placeholder="%"></label>' +
          '<label title="Приоритет: при одновременном изменении одного параметра первым применяется больший приоритет">приор.<input class="inp num" type="number" step="1" data-inp="fx-field" data-fx="' + f.id + '" data-f="priority" value="' + f.priority + '"></label>' +
        '</div>' +
      '</div>';
    }).join('');

    const en = ent.events;
    const edRows = en.edges.filter(ed => ed.from === node.id).map(ed => {
      return '<div class="ed-row">' +
        '<span class="ed-arrow">→</span>' +
        '<select class="inp" data-inp="edge-field" data-id="' + ed.id + '" data-f="to">' +
          en.nodes.map(n => '<option value="' + n.id + '" ' + (n.id === ed.to ? 'selected' : '') + '>' + U.esc(U.trunc(n.name, 14)) + '</option>').join('') +
        '</select>' +
        '<input class="inp ed-cond ac" data-inp="edge-field" data-id="' + ed.id + '" data-f="condition" value="' + U.esc(ed.condition) + '" placeholder="условие">' +
        '<label title="Число в % или формула (результат в %)">шанс<input class="inp chance ac" data-inp="edge-field" data-id="' + ed.id + '" data-f="chance" value="' + U.esc(ed.chance) + '" placeholder="%"></label>' +
        '<label>приор.<input class="inp num" type="number" step="1" data-inp="edge-field" data-id="' + ed.id + '" data-f="priority" value="' + ed.priority + '"></label>' +
        '<button class="ibtn danger" data-act="edge-del" data-id="' + ed.id + '" title="Удалить переход">✕</button>' +
      '</div>';
    }).join('');

    box.innerHTML =
      '<div class="insp">' +
        '<div class="insp-head"><span class="chip" style="background:' + (node.color || '#888') + '"></span><b>' + U.esc(node.name) + '</b></div>' +
        '<div class="insp-grid">' +
          '<label>Название<input class="inp" data-inp="node-field" data-f="name" value="' + U.esc(node.name) + '"></label>' +
          '<label>Цвет<input type="color" class="color-inp" data-inp="node-field" data-f="color" value="' + (node.color || '#ffd166') + '"></label>' +
          '<label title="Сколько секунд занимает событие">Длительность, с<input class="inp num" type="number" min="0" step="0.1" data-inp="node-field" data-f="duration" value="' + node.duration + '"></label>' +
        '</div>' +
        '<fieldset><legend>Повтор события (конкурирует с переходами по приоритету)</legend>' +
          '<div class="insp-grid">' +
            '<label title="Число в % или формула (результат в %)">Шанс %<input class="inp chance ac" data-inp="node-field" data-f="repeatChance" value="' + U.esc(node.repeatChance) + '" placeholder="0 или формула"></label>' +
            '<label title="Приоритет повтора относительно переходов в другие события">Приоритет<input class="inp num" type="number" step="1" data-inp="node-field" data-f="repeatPriority" value="' + (node.repeatPriority || 0) + '"></label>' +
            '<label>Лимит (0 = ∞)<input class="inp num" type="number" min="0" step="1" data-inp="node-field" data-f="repeatLimit" value="' + node.repeatLimit + '"></label>' +
            '<label class="wide">Условие повтора<input class="inp ac" data-inp="node-field" data-f="repeatCond" value="' + U.esc(node.repeatCond) + '" placeholder="напр. враг.армия > 0"></label>' +
          '</div>' +
        '</fieldset>' +
        '<fieldset><legend>Воздействия (' + node.effects.length + ')</legend>' +
          (fxRows || '<div class="insp-empty small">Нет изменений параметров в этом событии</div>') +
          '<button class="tbtn small" data-act="add-fx">＋ Воздействие</button>' +
        '</fieldset>' +
        '<fieldset><legend>Переходы из события</legend>' +
          (edRows || '<div class="insp-empty small">Нет переходов' + (en.autoLoop ? ' — сработает автоцикл в точку входа' : '') + '</div>') +
          '<button class="tbtn small" data-act="add-edge">＋ Переход</button>' +
        '</fieldset>' +
        '<div class="insp-actions">' +
          '<button class="tbtn" data-act="set-entry" ' + (en.entryId === node.id ? 'disabled' : '') + '>' + (en.entryId === node.id ? '✓ Точка входа' : 'Сделать точкой входа') + '</button>' +
          '<button class="tbtn danger" data-act="del-node">Удалить событие</button>' +
        '</div>' +
      '</div>';

    this._validateInspector(ent, node);
  },

  _validateInspector(ent, node) {
    const resolver = Engine.makeResolver(ent.id);
    const check = input => {
      const src = input.value;
      if (!src.trim()) { input.classList.remove('bad'); input.title = ''; return; }
      const r = Formula.eval(src, resolver);
      if (r.ok) { input.classList.remove('bad'); input.title = 'OK (сейчас = ' + U.fmt(r.value) + ')'; }
      else { input.classList.add('bad'); input.title = 'Ошибка: ' + r.error; }
    };
    const checkChance = input => {
      const src = input.value.trim();
      if (!src) { input.classList.remove('bad'); input.title = 'Пусто = 100%'; return; }
      if (/^-?\d+(\.\d+)?$/.test(src)) { input.classList.remove('bad'); input.title = 'Шанс ' + U.clamp(parseFloat(src), 0, 100) + '%'; return; }
      const r = Formula.eval(src, resolver);
      if (r.ok) { input.classList.remove('bad'); input.title = 'OK: формула даёт шанс ' + U.fmt(U.clamp(r.value, 0, 100)) + '%'; }
      else { input.classList.add('bad'); input.title = 'Ошибка: ' + r.error; }
    };
    document.querySelectorAll('#inspector [data-f="value"], #inspector [data-f="condition"], #inspector [data-f="repeatCond"]').forEach(check);
    document.querySelectorAll('#inspector [data-f="chance"], #inspector [data-f="repeatChance"]').forEach(checkChance);
  },

  /* ================= панель воздействий ================= */

  renderImpact() {
    const imp = App.sel.impact;
    const ent = Store.entity(imp.entityId);
    if (!ent) { App.sel.impact = null; this.render(); return; }
    const param = ent.params.find(p => p.id === imp.paramId);
    if (!param) { App.sel.impact = null; this.render(); return; }

    const page = Store.page();
    const rows = [];
    for (const e2 of page.entities)
      for (const n of e2.events.nodes)
        for (const fx of n.effects)
          if (fx.targetEntityId === ent.id && fx.paramId === param.id) rows.push({ e2, n, fx });

    const entityIds = new Set(rows.map(r => r.e2.id));
    entityIds.add(ent.id);
    const nodeIds = new Set(rows.map(r => r.n.id));
    MapView.setHighlight({ entityIds, nodeIds });

    const cur = Engine.values[param.id] !== undefined ? Engine.values[param.id] : param.value;
    const typeName = { num: 'число', text: 'текст', bool: 'булев' }[param.type] || 'число';
    const opLabel = { add: '+=', set: '=', mul: '×=', toggle: 'инверсия' };

    const cards = rows.map(r =>
      '<div class="imp-card">' +
        '<div class="imp-head"><span class="chip" style="background:' + (r.n.color || '#888') + '"></span>' +
          '<b>' + U.esc(r.e2.name) + '</b> <span class="dim">▸</span> ' + U.esc(r.n.name) + '</div>' +
        '<div class="imp-body">' +
          '<code class="imp-op">' + opLabel[r.fx.op] + ' ' + U.esc(r.fx.value) + '</code>' +
          (r.fx.condition ? '<div class="imp-meta">если <code>' + U.esc(r.fx.condition) + '</code></div>' : '') +
          (String(r.fx.chance) !== '100' ? '<div class="imp-meta">шанс ' + U.esc(r.fx.chance) + '%</div>' : '') +
        '</div>' +
        '<div class="imp-foot">' +
          '<label title="Приоритет применения при одновременном изменении">приоритет ' +
            '<input class="inp num" type="number" step="1" data-inp="impact-prio" data-id="' + r.fx.id + '" value="' + r.fx.priority + '">' +
          '</label>' +
          '<button class="tbtn small" data-act="impact-goto" data-e="' + r.e2.id + '" data-n="' + r.n.id + '">К событию →</button>' +
        '</div>' +
      '</div>').join('');

    this.el.innerHTML =
      '<div class="p-header impact-head">' +
        '<button class="ibtn" data-act="impact-close" title="Назад к сущности">←</button>' +
        '<b class="imp-title">🔍 Воздействия на «' + U.esc(param.name) + '»</b>' +
      '</div>' +
      '<div class="p-body"><div class="p-scroll">' +
        '<div class="imp-summary">Сущность <b style="color:' + ent.color + '">' + U.esc(ent.name) + '</b> · тип: <b>' + typeName + '</b> · старт: <b>' + U.fmtVal(param.value) + '</b> · текущее: <b id="imp-cur">' + U.fmtVal(cur) + '</b>' +
        (param.type === 'num' && (param.min !== null || param.max !== null) ? ' · границы: <b>' + (param.min === null ? '−∞' : param.min) + ' … ' + (param.max === null ? '+∞' : param.max) + '</b>' : '') +
        ' · источников: <b>' + rows.length + '</b></div>' +
        (cards || '<div class="insp-empty">Этот параметр пока нигде не изменяется.</div>') +
        '<div class="hint">Приоритет определяет порядок применения, когда несколько источников меняют параметр одновременно (больший — раньше). Карта подсвечивает только связанные сущности и события.</div>' +
      '</div></div>';
  },

  /* ================= точечные обновления ================= */

  updateParamValue(paramId, val) {
    const el = document.getElementById('pv-' + paramId);
    if (el && document.activeElement !== el) el.textContent = U.fmtVal(val);
    const cur = document.getElementById('imp-cur');
    if (cur && App.sel.impact && App.sel.impact.paramId === paramId) cur.textContent = U.fmtVal(val);
  },

  markActive(entityId, nodeId, on) {
    if (App.sel.entityId !== entityId || App.sel.tab !== 'events') return;
    const svg = document.getElementById('treeSvg');
    if (!svg) return;
    if (on) {
      svg.querySelectorAll('.tnode.act').forEach(g => g.classList.remove('act'));
      const g = svg.querySelector('.tnode[data-id="' + nodeId + '"]');
      if (g) g.classList.add('act');
    } else {
      const g = svg.querySelector('.tnode[data-id="' + nodeId + '"]');
      if (g) g.classList.remove('act');
    }
  },

  /* ================= обработка ввода ================= */

  _onInput(e) {
    const t = e.target;
    const inp = t.dataset ? t.dataset.inp : null;
    if (!inp) return;
    const sel = App.sel;
    const ent = sel.entityId ? Store.entity(sel.entityId) : null;
    if (!ent && inp !== 'impact-prio') return;
    const id = t.dataset.id;
    const f = t.dataset.f;

    switch (inp) {
      case 'ent-name':
        ent.name = t.value; Store.save(); MapView.render(); break;
      case 'ent-color':
        ent.color = t.value; Store.save(); MapView.render();
        { const dot = this.el.querySelector('.p-dot'); if (dot) dot.style.background = t.value; }
        break;
      case 'ent-enabled':
        ent.enabled = t.checked; Store.save(); MapView.render();
        if (!Engine.running) Engine.reset(true);
        break;
      case 'param-name': {
        const p = ent.params.find(x => x.id === id);
        if (p) { p.name = t.value; Store.save(); MapView.render(); }
        break;
      }
      case 'param-type': {
        const p = ent.params.find(x => x.id === id);
        if (!p) break;
        const old = p.value;
        p.type = t.value;
        if (p.type === 'bool') p.value = old === true || old === 'true' || U.num(old, 0) !== 0;
        else if (p.type === 'text') p.value = String(old === true ? 'да' : old === false ? 'нет' : old);
        else p.value = U.num(old === true ? 1 : old === false ? 0 : old, 0);
        if (!Engine.running) Engine.values[p.id] = p.value;
        Store.save(); this.render(); MapView.render();
        break;
      }
      case 'param-start': {
        const p = ent.params.find(x => x.id === id);
        if (!p) break;
        if (p.type === 'bool') p.value = t.checked;
        else if (p.type === 'text') p.value = t.value;
        else {
          p.value = U.num(t.value, p.value);
          if (p.min !== null && p.min !== undefined) p.value = Math.max(p.min, p.value);
          if (p.max !== null && p.max !== undefined) p.value = Math.min(p.max, p.value);
        }
        if (!Engine.running) { Engine.values[p.id] = p.value; this.updateParamValue(p.id, p.value); MapView.updateValue(p.id, p.value); }
        Store.save();
        break;
      }
      case 'param-min': case 'param-max': {
        const p = ent.params.find(x => x.id === id);
        if (!p) break;
        // важно: используем inp (data-inp), а не f (data-f) — у этих полей data-f нет
        p[inp === 'param-min' ? 'min' : 'max'] = t.value === '' ? null : U.num(t.value, null);
        Store.save();
        break;
      }
      case 'autoloop':
        ent.events.autoLoop = t.checked; Store.save(); break;
      case 'jump-node': {
        sel.nodeId = t.value || null;
        this.renderTree(ent, null, t.value || undefined);
        this.renderInspector(ent);
        break;
      }
      case 'entry':
        ent.events.entryId = t.value || null; Store.save(); this.renderTree(ent, this._scrollMem.events && this._scrollMem.events.ts); break;
      case 'node-field': {
        const n = ent.events.nodes.find(x => x.id === sel.nodeId);
        if (!n) break;
        if (f === 'name') n.name = t.value;
        else if (f === 'color') n.color = t.value;
        else if (f === 'duration') n.duration = Math.max(0, U.num(t.value, 0));
        else if (f === 'repeatChance') n.repeatChance = t.value;
        else if (f === 'repeatCond') n.repeatCond = t.value;
        else if (f === 'repeatLimit') n.repeatLimit = Math.max(0, Math.round(U.num(t.value, 0)));
        else if (f === 'repeatPriority') n.repeatPriority = U.num(t.value, 0);
        Store.save();
        this.renderTree(ent, this._scrollMem.events && this._scrollMem.events.ts);
        break;
      }
      case 'fx-field': {
        const found = Store.findEffect(t.dataset.fx);
        if (!found) break;
        const fx = found.fx;
        if (f === 'targetEntityId') {
          fx.targetEntityId = t.value;
          const te = Store.entity(t.value);
          fx.paramId = te && te.params[0] ? te.params[0].id : '';
          Store.save(); this.render(); MapView.render();
        } else if (f === 'paramId') {
          fx.paramId = t.value; Store.save();
          this.renderInspector(ent); MapView.render();
        }
        else if (f === 'op') { fx.op = t.value; Store.save(); MapView.render(); }
        else if (f === 'value') { fx.value = t.value; Store.save(); this._validateInspector(ent, found.node); }
        else if (f === 'condition') { fx.condition = t.value; Store.save(); this._validateInspector(ent, found.node); }
        else if (f === 'chance') { fx.chance = t.value; Store.save(); this._validateInspector(ent, found.node); }
        else if (f === 'priority') { fx.priority = U.num(t.value, 0); Store.save(); }
        break;
      }
      case 'edge-field': {
        const ed = ent.events.edges.find(x => x.id === id);
        if (!ed) break;
        if (f === 'to') { ed.to = t.value; Store.save(); this.renderTree(ent, this._scrollMem.events && this._scrollMem.events.ts); }
        else if (f === 'condition') { ed.condition = t.value; Store.save(); this.renderTree(ent, this._scrollMem.events && this._scrollMem.events.ts); }
        else if (f === 'chance') { ed.chance = t.value; Store.save(); this.renderTree(ent, this._scrollMem.events && this._scrollMem.events.ts); }
        else if (f === 'priority') { ed.priority = U.num(t.value, 0); Store.save(); this.renderTree(ent, this._scrollMem.events && this._scrollMem.events.ts); }
        break;
      }
      case 'impact-prio': {
        const found = Store.findEffect(id);
        if (found) { found.fx.priority = U.num(t.value, 0); Store.save(); }
        break;
      }
    }
  },

  _onClick(e) {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const act = btn.dataset.act;
    const sel = App.sel;
    const ent = sel.entityId ? Store.entity(sel.entityId) : null;
    const id = btn.dataset.id;

    switch (act) {
      case 'tab-params': sel.tab = 'params'; this.render(); break;
      case 'tab-events': sel.tab = 'events'; this.render(); break;

      case 'ent-del': {
        if (!ent) break;
        if (!confirm('Удалить сущность «' + ent.name + '» вместе со всеми параметрами и событиями?')) return;
        const page = Store.page();
        page.entities = page.entities.filter(x => x.id !== ent.id);
        for (const e2 of page.entities)
          for (const n of e2.events.nodes)
            n.effects = n.effects.filter(f => f.targetEntityId !== ent.id);
        App.sel = { entityId: null, tab: 'params', nodeId: null, impact: null };
        Store.save();
        if (!Engine.running) Engine.reset(true);
        App.onDataChange();
        break;
      }
      case 'add-param': {
        if (!ent) break;
        ent.params.push(normParam({ id: U.uid(), name: 'параметр ' + (ent.params.length + 1), type: 'num', value: 0 }));
        Store.save(); this.render(); MapView.render();
        break;
      }
      case 'param-del': {
        if (!ent) break;
        const p = ent.params.find(x => x.id === id);
        if (!p || !confirm('Удалить параметр «' + p.name + '»? Все воздействия на него будут удалены.')) return;
        ent.params = ent.params.filter(x => x.id !== id);
        const page = Store.page();
        for (const e2 of page.entities)
          for (const n of e2.events.nodes)
            n.effects = n.effects.filter(f => !(f.targetEntityId === ent.id && f.paramId === id));
        Store.save(); this.render(); MapView.render();
        break;
      }
      case 'param-impact':
        sel.impact = { entityId: ent.id, paramId: id };
        this.render();
        break;
      case 'impact-close':
        sel.impact = null;
        MapView.setHighlight(null);
        this.render();
        break;
      case 'impact-goto': {
        const eid = btn.dataset.e, nid = btn.dataset.n;
        sel.impact = null;
        sel.entityId = eid;
        sel.tab = 'events';
        sel.nodeId = nid;
        MapView.setHighlight(null);
        MapView.render();
        this.render();
        break;
      }
      case 'add-node': {
        if (!ent) break;
        const ts = this.el.querySelector('.tree-scroll');
        const wx = ts ? ts.scrollLeft + ts.clientWidth / 2 - TREE_OFF - this.NW / 2 : 40;
        const wy = ts ? ts.scrollTop + ts.clientHeight / 2 - TREE_OFF - this.NH / 2 : 40;
        const idx = ent.events.nodes.length;
        const node = normNode({
          id: U.uid(), name: 'Событие ' + (idx + 1),
          x: Math.round(wx), y: Math.round(wy),
          color: U.PALETTE_NODE[idx % U.PALETTE_NODE.length],
          duration: 1, effects: [],
        }, idx);
        ent.events.nodes.push(node);
        if (!ent.events.entryId) ent.events.entryId = node.id;
        sel.nodeId = node.id;
        Store.save(); this.render(); MapView.render();
        break;
      }
      case 'del-node': {
        if (!ent || !sel.nodeId) break;
        const n = ent.events.nodes.find(x => x.id === sel.nodeId);
        if (!n || !confirm('Удалить событие «' + n.name + '»?')) return;
        ent.events.nodes = ent.events.nodes.filter(x => x.id !== sel.nodeId);
        ent.events.edges = ent.events.edges.filter(ed => ed.from !== sel.nodeId && ed.to !== sel.nodeId);
        if (ent.events.entryId === sel.nodeId)
          ent.events.entryId = ent.events.nodes[0] ? ent.events.nodes[0].id : null;
        sel.nodeId = null;
        Store.save(); this.render(); MapView.render();
        break;
      }
      case 'set-entry': {
        if (!ent || !sel.nodeId) break;
        ent.events.entryId = sel.nodeId;
        Store.save(); this.render();
        break;
      }
      case 'add-fx': {
        if (!ent || !sel.nodeId) break;
        const n = ent.events.nodes.find(x => x.id === sel.nodeId);
        if (!n) break;
        n.effects.push(normEffect({
          id: U.uid(), targetEntityId: ent.id,
          paramId: ent.params[0] ? ent.params[0].id : '',
          op: 'add', value: '1', condition: '', chance: '100', priority: 0,
        }));
        Store.save(); this.render(); MapView.render();
        break;
      }
      case 'fx-del': {
        if (!ent || !sel.nodeId) break;
        const n = ent.events.nodes.find(x => x.id === sel.nodeId);
        if (!n) break;
        n.effects = n.effects.filter(x => x.id !== id);
        Store.save(); this.render(); MapView.render();
        break;
      }
      case 'add-edge': {
        if (!ent || !sel.nodeId) break;
        const others = ent.events.nodes.filter(n => n.id !== sel.nodeId);
        if (!others.length) { alert('Нужна хотя бы ещё одна нода-цель. Создайте второе событие.'); return; }
        ent.events.edges.push(normEdge({ id: U.uid(), from: sel.nodeId, to: others[0].id, condition: '', chance: '100', priority: 0 }));
        Store.save(); this.render();
        break;
      }
      case 'edge-del': {
        if (!ent) break;
        ent.events.edges = ent.events.edges.filter(x => x.id !== id);
        Store.save();
        this.renderTree(ent, this._scrollMem.events && this._scrollMem.events.ts);
        this.renderInspector(ent);
        break;
      }
    }
  },
};
