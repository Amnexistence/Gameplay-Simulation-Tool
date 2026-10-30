'use strict';
/* ============================================================
   Panel — правая панель: параметры сущности, редактор дерева
   событий (drag-n-drop нод, связи через порт), инспектор ноды
   (воздействия, переходы, повторы) и панель воздействий на
   параметр (кто и как меняет параметр + приоритеты).
   ============================================================ */

const Panel = {
  el: null,
  NW: 150, NH: 52,   // размер ноды дерева
  _tree: null,       // состояние drag/link в дереве

  init() {
    this.el = document.getElementById('panel');
    this.el.addEventListener('click', e => this._onClick(e));
    this.el.addEventListener('input', e => this._onInput(e));
    this.el.addEventListener('change', e => this._onInput(e));
  },

  /* ================= рендер ================= */

  render() {
    const sel = App.sel;
    if (sel.impact) { this.renderImpact(); return; }
    const ent = sel.entityId ? Store.entity(sel.entityId) : null;
    if (!ent) {
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

    if (sel.tab === 'events') {
      this.renderTree(ent);
      this.renderInspector(ent);
    }
  },

  _paramsHTML(ent) {
    const rows = ent.params.map(p => {
      const v = Engine.values[p.id] !== undefined ? Engine.values[p.id] : p.value;
      return '<tr>' +
        '<td><input class="inp" data-inp="param-name" data-id="' + p.id + '" value="' + U.esc(p.name) + '"></td>' +
        '<td><input class="inp num" type="number" step="any" data-inp="param-start" data-id="' + p.id + '" value="' + p.value + '" title="Стартовое значение"></td>' +
        '<td><span class="cur-val" id="pv-' + p.id + '">' + U.fmt(v) + '</span></td>' +
        '<td><button class="ibtn" data-act="param-impact" data-id="' + p.id + '" title="Кто меняет этот параметр?">🔍</button></td>' +
        '<td><button class="ibtn danger" data-act="param-del" data-id="' + p.id + '" title="Удалить параметр">✕</button></td>' +
      '</tr>';
    }).join('');
    return '<div class="p-scroll">' +
      '<table class="ptable"><thead><tr><th>Параметр</th><th title="Значение на старте симуляции">Старт</th><th title="Текущее значение">Текущее</th><th></th><th></th></tr></thead>' +
      '<tbody>' + (rows || '<tr><td colspan="5" class="empty">Нет параметров</td></tr>') + '</tbody></table>' +
      '<button class="tbtn" data-act="add-param">＋ Параметр</button>' +
      '<div class="hint">В формулах событий параметры доступны как <code>имя</code> (свои) или <code>Сущность.имя</code> (глобально). Клик по 🔍 — панель воздействий на параметр.</div>' +
      '</div>';
  },

  _eventsHTML(ent) {
    const en = ent.events;
    const opts = en.nodes.map(n =>
      '<option value="' + n.id + '" ' + (n.id === en.entryId ? 'selected' : '') + '>' + U.esc(U.trunc(n.name, 18)) + '</option>').join('');
    return '' +
      '<div class="ev-toolbar">' +
        '<button class="tbtn" data-act="add-node">＋ Событие</button>' +
        '<label class="chk" title="Если нет доступных переходов — возврат в точку входа"><input type="checkbox" data-inp="autoloop" ' + (en.autoLoop ? 'checked' : '') + '>Автоцикл</label>' +
        '<label class="entry-lbl" title="Стартовая нода и точка возврата при автоцикле">Вход: <select data-inp="entry">' + (opts || '<option value="">—</option>') + '</select></label>' +
      '</div>' +
      '<div class="tree-scroll"><svg id="treeSvg" width="960" height="460"></svg></div>' +
      '<div class="hint tree-hint">Двойной клик по полю — новое событие · клик по ноде — настройки · тяните от <span class="port-ico">◆</span> к другой ноде — создать переход</div>' +
      '<div id="inspector"></div>';
  },

  /* ================= дерево событий ================= */

  renderTree(ent) {
    const svg = document.getElementById('treeSvg');
    if (!svg) return;
    const en = ent.events;
    svg.innerHTML = '';

    // маркеры по цветам нод
    let defs = '<defs>';
    const colors = new Set(en.nodes.map(n => n.color || '#8b98ad'));
    for (const c of colors) {
      defs += '<marker id="tmk-' + c.replace('#', '') + '" viewBox="0 0 8 6" refX="7" refY="3" markerWidth="9" markerHeight="9" orient="auto-start-reverse" markerUnits="userSpaceOnUse"><path d="M0,0 L8,3 L0,6 Z" fill="' + c + '"/></marker>';
    }
    defs += '</defs>';
    svg.insertAdjacentHTML('beforeend', defs);
    svg.insertAdjacentHTML('beforeend', '<rect class="tree-bg" x="0" y="0" width="960" height="460" fill="transparent"/>');

    const gE = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    const gN = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    svg.appendChild(gE); svg.appendChild(gN);

    // рёбра
    this._drawTreeEdges(ent, gE);

    // ноды
    for (const n of en.nodes) {
      const sel = App.sel.nodeId === n.id ? ' sel' : '';
      const entry = en.entryId === n.id ? ' entry' : '';
      const act = (App.sel.entityId === ent.id && Engine.activeNode(ent.id) === n.id) ? ' act' : '';
      const sub = '⏱ ' + U.fmt(n.duration) + 'с · ↯ ' + n.effects.length +
        (n.repeatChance > 0 ? ' · ⟳ ' + Math.round(n.repeatChance * 100) + '%' : '');
      gN.insertAdjacentHTML('beforeend',
        '<g class="tnode' + sel + entry + act + '" data-id="' + n.id + '" transform="translate(' + n.x + ',' + n.y + ')">' +
          '<rect class="tnode-body" width="' + this.NW + '" height="' + this.NH + '" rx="9" style="stroke:' + (n.color || '#8b98ad') + '"/>' +
          '<rect class="tnode-bar" width="7" height="' + this.NH + '" rx="3.5" fill="' + (n.color || '#8b98ad') + '"/>' +
          '<text class="tnode-name" x="15" y="21">' + U.esc(U.trunc(n.name, 17)) + '</text>' +
          '<text class="tnode-sub" x="15" y="40">' + U.esc(sub) + '</text>' +
          (en.entryId === n.id ? '<text class="tnode-entry" x="15" y="-6">▶ старт/возврат</text>' : '') +
          '<circle class="tport" cx="' + this.NW + '" cy="' + (this.NH / 2) + '" r="6.5" fill="' + (n.color || '#8b98ad') + '" title="Тяните к другой ноде, чтобы создать переход"/>' +
        '</g>');
    }

    this._bindTree(svg, ent);
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
      if (ed.chance < 1) parts.push(Math.round(ed.chance * 100) + '%');
      if (ed.priority) parts.push('пр' + ed.priority);
      const label = parts.join(' · ');
      const mx = (a1.x + a2.x) / 2, my = (a1.y + a2.y) / 2;
      gE.insertAdjacentHTML('beforeend',
        '<g class="tedge" data-id="' + ed.id + '">' +
          '<line x1="' + a1.x + '" y1="' + a1.y + '" x2="' + a2.x + '" y2="' + a2.y + '" stroke="' + color + '" marker-end="url(#tmk-' + color.replace('#', '') + ')"/>' +
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
        // начало создания связи
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
        // выбор + перетаскивание ноды
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
        node.x = U.clamp(Math.round(st.ox + p.x - st.sx), 0, 960 - self.NW);
        node.y = U.clamp(Math.round(st.oy + p.y - st.sy), 0, 460 - self.NH);
        st.g.setAttribute('transform', 'translate(' + node.x + ',' + node.y + ')');
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
        const target = ent.events.nodes.find(n =>
          p.x >= n.x && p.x <= n.x + self.NW && p.y >= n.y && p.y <= n.y + self.NH);
        if (target && target.id !== st.from) {
          const exists = ent.events.edges.some(ed => ed.from === st.from && ed.to === target.id);
          if (!exists) {
            ent.events.edges.push({ id: U.uid(), from: st.from, to: target.id, condition: '', chance: 1, priority: 0 });
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
        x: U.clamp(Math.round(p.x - self.NW / 2), 0, 960 - self.NW),
        y: U.clamp(Math.round(p.y - self.NH / 2), 0, 460 - self.NH),
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

  renderInspector(ent) {
    const box = document.getElementById('inspector');
    if (!box) return;
    const node = ent.events.nodes.find(n => n.id === App.sel.nodeId);
    if (!node) {
      box.innerHTML = '<div class="insp-empty">Выберите событие в дереве, чтобы настроить его воздействия, переходы и повторы.</div>';
      return;
    }
    const page = Store.page();

    // эффекты
    const fxRows = node.effects.map(f => {
      const te = Store.entity(f.targetEntityId) || ent;
      const pOpts = te.params.map(p => '<option value="' + p.id + '" ' + (p.id === f.paramId ? 'selected' : '') + '>' + U.esc(p.name) + '</option>').join('');
      return '<div class="fx-row" data-fx="' + f.id + '">' +
        '<div class="fx-line1">' +
          '<select class="inp" data-inp="fx-field" data-fx="' + f.id + '" data-f="targetEntityId" title="Целевая сущность">' +
            page.entities.map(e => '<option value="' + e.id + '" ' + (e.id === f.targetEntityId ? 'selected' : '') + '>' + U.esc(U.trunc(e.name, 14)) + '</option>').join('') +
          '</select>' +
          '<select class="inp" data-inp="fx-field" data-fx="' + f.id + '" data-f="paramId" title="Целевой параметр">' + (pOpts || '<option value="">—</option>') + '</select>' +
          '<select class="inp op" data-inp="fx-field" data-fx="' + f.id + '" data-f="op" title="Операция">' +
            '<option value="add" ' + (f.op === 'add' ? 'selected' : '') + '>+=</option>' +
            '<option value="set" ' + (f.op === 'set' ? 'selected' : '') + '>=</option>' +
            '<option value="mul" ' + (f.op === 'mul' ? 'selected' : '') + '>×=</option>' +
          '</select>' +
          '<button class="ibtn danger" data-act="fx-del" data-id="' + f.id + '" title="Удалить воздействие">✕</button>' +
        '</div>' +
        '<div class="fx-line2">' +
          '<input class="inp fx-val" data-inp="fx-field" data-fx="' + f.id + '" data-f="value" value="' + U.esc(f.value) + '" placeholder="число или формула, напр. 10 + золото*0.1" title="Величина изменения">' +
        '</div>' +
        '<div class="fx-line3">' +
          '<input class="inp fx-cond" data-inp="fx-field" data-fx="' + f.id + '" data-f="condition" value="' + U.esc(f.condition) + '" placeholder="условие (напр. золото &lt; 100)" title="Условие срабатывания">' +
          '<label title="Вероятность срабатывания">шанс<input class="inp num" type="number" min="0" max="100" step="5" data-inp="fx-field" data-fx="' + f.id + '" data-f="chance" value="' + Math.round(f.chance * 100) + '">%</label>' +
          '<label title="Приоритет: при одновременном изменении одного параметра первым применяется больший приоритет">приор.<input class="inp num" type="number" step="1" data-inp="fx-field" data-fx="' + f.id + '" data-f="priority" value="' + f.priority + '"></label>' +
        '</div>' +
      '</div>';
    }).join('');

    // исходящие переходы
    const en = ent.events;
    const edRows = en.edges.filter(ed => ed.from === node.id).map(ed => {
      return '<div class="ed-row">' +
        '<span class="ed-arrow">→</span>' +
        '<select class="inp" data-inp="edge-field" data-id="' + ed.id + '" data-f="to">' +
          en.nodes.map(n => '<option value="' + n.id + '" ' + (n.id === ed.to ? 'selected' : '') + '>' + U.esc(U.trunc(n.name, 14)) + '</option>').join('') +
        '</select>' +
        '<input class="inp ed-cond" data-inp="edge-field" data-id="' + ed.id + '" data-f="condition" value="' + U.esc(ed.condition) + '" placeholder="условие">' +
        '<label>шанс<input class="inp num" type="number" min="0" max="100" step="5" data-inp="edge-field" data-id="' + ed.id + '" data-f="chance" value="' + Math.round(ed.chance * 100) + '">%</label>' +
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
        '<fieldset><legend>Повтор события</legend>' +
          '<div class="insp-grid">' +
            '<label>Шанс %<input class="inp num" type="number" min="0" max="100" step="5" data-inp="node-field" data-f="repeatChance" value="' + Math.round(node.repeatChance * 100) + '"></label>' +
            '<label>Лимит (0 = ∞)<input class="inp num" type="number" min="0" step="1" data-inp="node-field" data-f="repeatLimit" value="' + node.repeatLimit + '"></label>' +
            '<label class="wide">Условие повтора<input class="inp" data-inp="node-field" data-f="repeatCond" value="' + U.esc(node.repeatCond) + '" placeholder="напр. враг.армия > 0"></label>' +
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
    document.querySelectorAll('#inspector [data-f="value"], #inspector [data-f="condition"], #inspector [data-f="repeatCond"]').forEach(check);
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

    // подсветка карты
    const entityIds = new Set(rows.map(r => r.e2.id));
    entityIds.add(ent.id);
    const nodeIds = new Set(rows.map(r => r.n.id));
    MapView.setHighlight({ entityIds, nodeIds });

    const cur = Engine.values[param.id] !== undefined ? Engine.values[param.id] : param.value;
    const opLabel = { add: '+=', set: '=', mul: '×=' };

    const cards = rows.map(r =>
      '<div class="imp-card">' +
        '<div class="imp-head"><span class="chip" style="background:' + (r.n.color || '#888') + '"></span>' +
          '<b>' + U.esc(r.e2.name) + '</b> <span class="dim">▸</span> ' + U.esc(r.n.name) + '</div>' +
        '<div class="imp-body">' +
          '<code class="imp-op">' + opLabel[r.fx.op] + ' ' + U.esc(r.fx.value) + '</code>' +
          (r.fx.condition ? '<div class="imp-meta">если <code>' + U.esc(r.fx.condition) + '</code></div>' : '') +
          (r.fx.chance < 1 ? '<div class="imp-meta">шанс ' + Math.round(r.fx.chance * 100) + '%</div>' : '') +
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
        '<div class="imp-summary">Сущность <b style="color:' + ent.color + '">' + U.esc(ent.name) + '</b> · старт: <b>' + U.fmt(param.value) + '</b> · текущее: <b id="imp-cur">' + U.fmt(cur) + '</b> · источников: <b>' + rows.length + '</b></div>' +
        (cards || '<div class="insp-empty">Этот параметр пока нигде не изменяется.</div>') +
        '<div class="hint">Приоритет определяет порядок применения, когда несколько источников меняют параметр одновременно (больший — раньше). Карта подсвечивает только связанные сущности и события.</div>' +
      '</div></div>';
  },

  /* ================= точечные обновления ================= */

  updateParamValue(paramId, val) {
    const el = document.getElementById('pv-' + paramId);
    if (el && document.activeElement !== el) el.textContent = U.fmt(val);
    const cur = document.getElementById('imp-cur');
    if (cur && App.sel.impact && App.sel.impact.paramId === paramId) cur.textContent = U.fmt(val);
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

  /* ================= обработка ввода (делегирование) ================= */

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
      case 'param-start': {
        const p = ent.params.find(x => x.id === id);
        if (p) {
          p.value = U.num(t.value, p.value);
          if (!Engine.running) { Engine.values[p.id] = p.value; this.updateParamValue(p.id, p.value); MapView.updateValue(p.id, p.value); }
          Store.save();
        }
        break;
      }
      case 'autoloop':
        ent.events.autoLoop = t.checked; Store.save(); break;
      case 'entry':
        ent.events.entryId = t.value || null; Store.save(); this.renderTree(ent); break;
      case 'node-field': {
        const n = ent.events.nodes.find(x => x.id === sel.nodeId);
        if (!n) break;
        if (f === 'name') n.name = t.value;
        else if (f === 'color') n.color = t.value;
        else if (f === 'duration') n.duration = Math.max(0, U.num(t.value, 0));
        else if (f === 'repeatChance') n.repeatChance = U.clamp(U.num(t.value, 0) / 100, 0, 1);
        else if (f === 'repeatCond') n.repeatCond = t.value;
        else if (f === 'repeatLimit') n.repeatLimit = Math.max(0, Math.round(U.num(t.value, 0)));
        Store.save();
        this.renderTree(ent);
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
        } else if (f === 'paramId') { fx.paramId = t.value; Store.save(); MapView.render(); }
        else if (f === 'op') { fx.op = t.value; Store.save(); MapView.render(); }
        else if (f === 'value') { fx.value = t.value; Store.save(); this._validateInspector(ent, found.node); }
        else if (f === 'condition') { fx.condition = t.value; Store.save(); this._validateInspector(ent, found.node); }
        else if (f === 'chance') { fx.chance = U.clamp(U.num(t.value, 100) / 100, 0, 1); Store.save(); }
        else if (f === 'priority') { fx.priority = U.num(t.value, 0); Store.save(); }
        break;
      }
      case 'edge-field': {
        const ed = ent.events.edges.find(x => x.id === id);
        if (!ed) break;
        if (f === 'to') { ed.to = t.value; Store.save(); this.renderTree(ent); }
        else if (f === 'condition') { ed.condition = t.value; Store.save(); this.renderTree(ent); }
        else if (f === 'chance') { ed.chance = U.clamp(U.num(t.value, 100) / 100, 0, 1); Store.save(); this.renderTree(ent); }
        else if (f === 'priority') { ed.priority = U.num(t.value, 0); Store.save(); this.renderTree(ent); }
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
        ent.params.push(normParam({ id: U.uid(), name: 'параметр ' + (ent.params.length + 1), value: 0 }));
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
        const idx = ent.events.nodes.length;
        const node = normNode({
          id: U.uid(), name: 'Событие ' + (idx + 1),
          x: 40 + (idx % 3) * 210, y: 40 + Math.floor(idx / 3) * 120,
          color: U.PALETTE_NODE[idx % U.PALETTE_NODE.length],
          duration: 1, effects: [],
        }, idx);
        ent.events.nodes.push(node);
        if (!ent.events.entryId) ent.events.entryId = node.id;
        sel.nodeId = node.id;
        Store.save(); this.render(); MapView.render();
        break;
      }
      case 'tnode-select': {
        sel.nodeId = id;
        this.renderTree(ent);
        this.renderInspector(ent);
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
        const te = Store.entity(ent.id);
        n.effects.push(normEffect({
          id: U.uid(), targetEntityId: te.id,
          paramId: te.params[0] ? te.params[0].id : '',
          op: 'add', value: '1', condition: '', chance: 1, priority: 0,
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
        ent.events.edges.push(normEdge({ id: U.uid(), from: sel.nodeId, to: others[0].id, condition: '', chance: 1, priority: 0 }));
        Store.save(); this.render();
        break;
      }
      case 'edge-del': {
        if (!ent) break;
        ent.events.edges = ent.events.edges.filter(x => x.id !== id);
        Store.save();
        this.renderTree(ent);
        this.renderInspector(ent);
        break;
      }
    }
  },
};
