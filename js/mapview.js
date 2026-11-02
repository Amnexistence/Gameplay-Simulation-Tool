'use strict';
/* ============================================================
   MapView — карта сущностей: точки-сущности и стрелки воздействий.
   Одна стрелка на пару (событие → целевая сущность): толщина
   растёт с числом меняемых параметров, рядом подпись (параметры
   с операциями и длительность события), в тултипе — столбик
   изменений. Цвет стрелки = цвет события. Стрелки активного
   события подсвечиваются анимацией. Pan/zoom, затемнение для
   панели воздействий, «всплывающие» изменения параметров.
   ============================================================ */

const MapView = {
  svg: null,
  vp: null,
  vb: { x: -60, y: -60, w: 1300, h: 760 },
  _drag: null,
  _active: {},   // entityId -> nodeId
  _hl: null,     // {entityIds:Set, nodeIds:Set}
  _userView: false,

  R: 26,

  init() {
    this.svg = document.getElementById('mapSvg');
    this.svg.innerHTML =
      '<defs id="mapDefs">' +
        '<pattern id="mapGrid" width="40" height="40" patternUnits="userSpaceOnUse">' +
          '<circle cx="1.5" cy="1.5" r="1.5" fill="#20283a"/>' +
        '</pattern>' +
      '</defs>' +
      '<g id="mapVp">' +
        '<rect id="mapBg" x="-6000" y="-6000" width="14000" height="14000" fill="url(#mapGrid)"/>' +
        '<g id="mapEdges"></g>' +
        '<g id="mapNodes"></g>' +
        '<g id="mapFx"></g>' +
      '</g>';
    this.vp = document.getElementById('mapVp');
    this._bindEvents();
    this.applyVB();
    if (typeof ResizeObserver !== 'undefined') {
      this._ro = new ResizeObserver(() => { if (!this._userView) this.fit(); });
      this._ro.observe(document.getElementById('mapWrap'));
    }
  },

  /* ---------- координаты ---------- */

  toWorld(clientX, clientY) {
    const pt = this.svg.createSVGPoint();
    pt.x = clientX; pt.y = clientY;
    const m = this.vp.getScreenCTM();
    if (!m) return { x: 0, y: 0 };
    const p = pt.matrixTransform(m.inverse());
    return { x: p.x, y: p.y };
  },

  applyVB() {
    this.svg.setAttribute('viewBox', this.vb.x + ' ' + this.vb.y + ' ' + this.vb.w + ' ' + this.vb.h);
  },

  fit() {
    this._userView = false;
    const page = Store.page();
    const ents = page ? page.entities : [];
    if (!ents.length) { this.vb = { x: -60, y: -60, w: 1300, h: 760 }; this.applyVB(); return; }
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const e of ents) {
      minX = Math.min(minX, e.x); maxX = Math.max(maxX, e.x);
      minY = Math.min(minY, e.y); maxY = Math.max(maxY, e.y);
    }
    const pad = 150;
    const w = Math.max(400, maxX - minX + pad * 2);
    const h = Math.max(300, maxY - minY + pad * 2);
    const rect = this.svg.getBoundingClientRect();
    const aspect = rect.width / Math.max(1, rect.height);
    let vw = w, vh = h;
    if (vw / vh < aspect) vw = vh * aspect; else vh = vw / aspect;
    const MIN_SCALE = 0.5;
    if (rect.width / vw < MIN_SCALE) {
      vw = rect.width / MIN_SCALE;
      vh = vw / aspect;
    }
    const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
    this.vb = { x: cx - vw / 2, y: cy - vh / 2, w: vw, h: vh };
    this.applyVB();
  },

  /* ---------- события мыши ---------- */

  _bindEvents() {
    const svg = this.svg;

    svg.addEventListener('pointerdown', e => {
      const g = e.target.closest('.ent');
      if (g) {
        const ent = Store.entity(g.dataset.id);
        if (!ent) return;
        this._drag = { type: 'ent', id: ent.id, moved: false, start: this.toWorld(e.clientX, e.clientY), ox: ent.x, oy: ent.y };
      } else {
        this._drag = { type: 'pan', moved: false, cx: e.clientX, cy: e.clientY, vb: { ...this.vb } };
      }
      svg.setPointerCapture(e.pointerId);
      e.preventDefault();
    });

    svg.addEventListener('pointermove', e => {
      const d = this._drag;
      if (!d) return;
      if (d.type === 'ent') {
        const w = this.toWorld(e.clientX, e.clientY);
        const dx = w.x - d.start.x, dy = w.y - d.start.y;
        if (Math.abs(dx) + Math.abs(dy) > 3) d.moved = true;
        const ent = Store.entity(d.id);
        if (!ent) return;
        ent.x = Math.round(d.ox + dx);
        ent.y = Math.round(d.oy + dy);
        const g = svg.querySelector('.ent[data-id="' + d.id + '"]');
        if (g) g.setAttribute('transform', 'translate(' + ent.x + ',' + ent.y + ')');
        this.renderEdges();
      } else {
        const dx = e.clientX - d.cx, dy = e.clientY - d.cy;
        if (Math.abs(dx) + Math.abs(dy) > 3) { d.moved = true; this._userView = true; }
        const rect = svg.getBoundingClientRect();
        const sx = d.vb.w / Math.max(1, rect.width);
        const sy = d.vb.h / Math.max(1, rect.height);
        this.vb.x = d.vb.x - dx * sx;
        this.vb.y = d.vb.y - dy * sy;
        this.applyVB();
      }
    });

    svg.addEventListener('pointerup', e => {
      const d = this._drag;
      this._drag = null;
      if (!d) return;
      if (d.type === 'ent') {
        if (d.moved) Store.save();
        else App.selectEntity(d.id);
      }
    });

    svg.addEventListener('wheel', e => {
      e.preventDefault();
      this._userView = true;
      const p = this.toWorld(e.clientX, e.clientY);
      const f = Math.exp(e.deltaY * 0.0012);
      const nw = U.clamp(this.vb.w * f, 200, 8000);
      const k = nw / this.vb.w;
      this.vb.x = p.x - (p.x - this.vb.x) * k;
      this.vb.y = p.y - (p.y - this.vb.y) * k;
      this.vb.w *= k;
      this.vb.h *= k;
      this.applyVB();
    }, { passive: false });

    svg.addEventListener('dblclick', e => {
      if (e.target.closest('.ent')) return;
      const w = this.toWorld(e.clientX, e.clientY);
      App.addEntity(Math.round(w.x), Math.round(w.y));
    });
  },

  /* ---------- отрисовка ---------- */

  render() {
    const page = Store.page();
    const ents = page ? page.entities : [];
    document.getElementById('mapHint').classList.toggle('hidden', ents.length > 0);
    this.renderEdges();
    this.renderNodes();
    this._applyHL();
  },

  _marker(color) {
    return '<marker id="mk-' + color.replace('#', '') + '" viewBox="0 0 8 6" refX="7" refY="3" ' +
      'markerWidth="9" markerHeight="9" orient="auto-start-reverse" markerUnits="userSpaceOnUse">' +
      '<path d="M0,0 L8,3 L0,6 Z" fill="' + color + '"/></marker>';
  },

  _ensureMarkers(colors) {
    const defs = document.getElementById('mapDefs');
    for (const c of colors) {
      const id = 'mk-' + c.replace('#', '');
      if (!defs.querySelector('#' + id)) {
        defs.insertAdjacentHTML('beforeend', this._marker(c));
      }
    }
  },

  opSym(op) { return op === 'set' ? '=' : op === 'mul' ? '×=' : op === 'toggle' ? 'inv' : '+='; },

  /* Группировка: одна стрелка на (событие → целевая сущность) */
  renderEdges() {
    const page = Store.page();
    const g = document.getElementById('mapEdges');
    if (!g) return;
    g.innerHTML = '';
    if (!page) return;

    const groups = new Map();
    for (const e of page.entities) {
      for (const n of e.events.nodes) {
        for (const fx of n.effects) {
          const te = fx.targetEntityId === e.id ? e : Store.entity(fx.targetEntityId);
          if (!te) continue;
          const tp = te.params.find(p => p.id === fx.paramId);
          const key = e.id + '|' + n.id + '|' + te.id;
          if (!groups.has(key)) groups.set(key, { src: e, dst: te, node: n, fxs: [] });
          groups.get(key).fxs.push({ fx, paramName: tp ? tp.name : '?' });
        }
      }
    }

    const colors = new Set();
    for (const gr of groups.values()) colors.add(gr.node.color || '#8b98ad');
    this._ensureMarkers(colors);

    // индексы для разведения параллельных стрелок между парами сущностей
    const pairCount = {};
    for (const gr of groups.values()) {
      if (gr.src.id === gr.dst.id) continue;
      const key = [gr.src.id, gr.dst.id].sort().join('|');
      pairCount[key] = (pairCount[key] || 0) + 1;
      gr._pair = key; gr._idx = pairCount[key] - 1;
    }

    for (const gr of groups.values()) {
      const color = gr.node.color || '#8b98ad';
      const n = gr.fxs.length;
      const width = 2 + Math.min(6, (n - 1) * 1.6);
      const act = this._active[gr.src.id] === gr.node.id ? ' act' : '';

      // тултип: каждое воздействие с новой строки + пустая строка между ними
      const tipLines = [gr.src.name + ' ▸ ' + gr.node.name + ' (⏱ ' + U.fmt(gr.node.duration) + 'с) → ' + gr.dst.name];
      for (const f of gr.fxs) {
        tipLines.push('');
        tipLines.push('  ' + f.paramName + ' ' + this.opSym(f.fx.op) + ' ' + f.fx.value +
          (f.fx.condition ? '   [если ' + f.fx.condition + ']' : '') +
          (String(f.fx.chance) !== '100' ? '   [шанс ' + f.fx.chance + '%]' : ''));
      }
      const tip = U.esc(tipLines.join('\n'));

      if (gr.src.id === gr.dst.id) {
        const x = gr.src.x, y = gr.src.y;
        const d = 'M' + (x - 14) + ',' + (y - 20) + ' C' + (x - 46) + ',' + (y - 64) + ' ' + (x + 46) + ',' + (y - 64) + ' ' + (x + 14) + ',' + (y - 22);
        g.insertAdjacentHTML('beforeend',
          '<path class="arrow' + act + '" d="' + d + '" stroke="' + color + '" style="--w:' + width + '" ' +
          'marker-end="url(#mk-' + color.replace('#', '') + ')" ' +
          'data-src="' + gr.src.id + '" data-dst="' + gr.dst.id + '" data-node="' + gr.node.id + '"><title>' + tip + '</title></path>');
        this._arrowLabel(g, x, y - 74, gr, color);
        continue;
      }

      const total = pairCount[gr._pair];
      const curve = (gr._idx - (total - 1) / 2) * 34 + (total === 1 ? 16 : 0);

      const s = gr.src, t = gr.dst;
      const dx = t.x - s.x, dy = t.y - s.y;
      const len = Math.hypot(dx, dy) || 1;
      const nx = -dy / len, ny = dx / len;
      const mx = (s.x + t.x) / 2 + nx * curve;
      const my = (s.y + t.y) / 2 + ny * curve;
      const a1 = Math.atan2(my - s.y, mx - s.x);
      const a2 = Math.atan2(my - t.y, mx - t.x);
      const sx = s.x + Math.cos(a1) * (this.R + 2), sy = s.y + Math.sin(a1) * (this.R + 2);
      const tx = t.x + Math.cos(a2) * (this.R + 8), ty = t.y + Math.sin(a2) * (this.R + 8);
      const d = 'M' + sx.toFixed(1) + ',' + sy.toFixed(1) + ' Q' + mx.toFixed(1) + ',' + my.toFixed(1) + ' ' + tx.toFixed(1) + ',' + ty.toFixed(1);

      g.insertAdjacentHTML('beforeend',
        '<path class="arrow' + act + '" d="' + d + '" stroke="' + color + '" style="--w:' + width + '" ' +
        'marker-end="url(#mk-' + color.replace('#', '') + ')" ' +
        'data-src="' + s.id + '" data-dst="' + t.id + '" data-node="' + gr.node.id + '"><title>' + tip + '</title></path>');

      // подпись рядом со стрелкой: параметры с операциями + длительность
      const lx = 0.25 * sx + 0.5 * mx + 0.25 * tx + nx * (width / 2 + 11) * Math.sign(curve || 1);
      const ly = 0.25 * sy + 0.5 * my + 0.25 * ty + ny * (width / 2 + 11) * Math.sign(curve || 1);
      this._arrowLabel(g, lx, ly, gr, color);
    }
  },

  _arrowLabel(g, x, y, gr, color) {
    const lines = [];
    const show = gr.fxs.slice(0, 4);
    for (const f of show) lines.push(U.trunc(f.paramName, 14) + ' ' + this.opSym(f.fx.op));
    if (gr.fxs.length > 4) lines.push('+' + (gr.fxs.length - 4) + '…');
    lines.push('⏱ ' + U.fmt(gr.node.duration) + 'с');
    const tspans = lines.map((ln, i) =>
      '<tspan x="' + x.toFixed(1) + '" dy="' + (i === 0 ? 0 : 10.5) + '"' +
      (ln.startsWith('⏱') ? ' class="dur"' : '') + '>' + U.esc(ln) + '</tspan>').join('');
    g.insertAdjacentHTML('beforeend',
      '<text class="arrow-label" x="' + x.toFixed(1) + '" y="' + y.toFixed(1) + '" text-anchor="middle">' + tspans + '</text>');
  },

  renderNodes() {
    const page = Store.page();
    const g = document.getElementById('mapNodes');
    if (!g) return;
    g.innerHTML = '';
    if (!page) return;

    for (const e of page.entities) {
      const nodeCount = e.events.nodes.length;
      let params = '';
      for (let i = 0; i < Math.min(3, e.params.length); i++) {
        const p = e.params[i];
        const v = Engine.values[p.id] !== undefined ? Engine.values[p.id] : p.value;
        params += '<text class="entParam" data-pid="' + p.id + '" data-pname="' + U.esc(p.name) + '" y="' + (62 + i * 14) + '">' +
          U.esc(U.trunc(p.name, 14)) + ': ' + U.fmtVal(v) + '</text>';
      }
      if (e.params.length > 3) params += '<text class="entParamMore" y="' + (62 + 3 * 14) + '">+' + (e.params.length - 3) + ' ещё</text>';

      const sel = App.sel.entityId === e.id ? ' sel' : '';
      const off = e.enabled ? '' : ' off';
      const letter = (e.name.trim()[0] || '?').toUpperCase();

      g.insertAdjacentHTML('beforeend',
        '<g class="ent' + sel + off + '" data-id="' + e.id + '" transform="translate(' + e.x + ',' + e.y + ')" style="--c:' + e.color + '">' +
          '<circle class="entRing" r="34" fill="none"/>' +
          '<circle class="entBody" r="' + this.R + '"/>' +
          '<text class="entLetter" y="7">' + U.esc(letter) + '</text>' +
          '<text class="entName" y="48">' + U.esc(U.trunc(e.name, 18)) + '</text>' +
          params +
          (nodeCount ? '<text class="entBadge" x="22" y="-18">⚡' + nodeCount + '</text>' : '') +
        '</g>');
    }
  },

  /* ---------- симуляционные эффекты ---------- */

  setActive(entityId, nodeId) {
    if (nodeId) this._active[entityId] = nodeId;
    else delete this._active[entityId];
    const g = this.svg.querySelector('.ent[data-id="' + entityId + '"]');
    if (g) {
      const ring = g.querySelector('.entRing');
      if (nodeId) {
        const node = Store.node(entityId, nodeId);
        g.classList.add('active');
        if (ring && node) { ring.style.stroke = node.color; ring.classList.add('on'); }
      } else {
        g.classList.remove('active');
        if (ring) ring.classList.remove('on');
      }
    }
    // подсветка стрелок активного события
    this.svg.querySelectorAll('.arrow.act[data-src="' + entityId + '"]').forEach(p => p.classList.remove('act'));
    if (nodeId) {
      this.svg.querySelectorAll('.arrow[data-src="' + entityId + '"][data-node="' + nodeId + '"]').forEach(p => p.classList.add('act'));
    }
  },

  clearActive() {
    this._active = {};
    this.svg.querySelectorAll('.ent.active').forEach(g => {
      g.classList.remove('active');
      const r = g.querySelector('.entRing');
      if (r) r.classList.remove('on');
    });
    this.svg.querySelectorAll('.arrow.act').forEach(p => p.classList.remove('act'));
  },

  showFx(entityId, text, cls) {
    const ent = Store.entity(entityId);
    const layer = document.getElementById('mapFx');
    if (!ent || !layer) return;
    const el = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    el.setAttribute('class', 'fxtext ' + (cls || ''));
    el.setAttribute('x', ent.x + (Math.random() * 24 - 12));
    el.setAttribute('y', ent.y - 36);
    el.setAttribute('text-anchor', 'middle');
    el.textContent = text;
    layer.appendChild(el);
    setTimeout(() => el.remove(), 1400);

    const pulse = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    pulse.setAttribute('class', 'hitpulse');
    pulse.setAttribute('cx', ent.x);
    pulse.setAttribute('cy', ent.y);
    pulse.setAttribute('r', this.R);
    layer.appendChild(pulse);
    setTimeout(() => pulse.remove(), 750);
  },

  updateValue(paramId, val) {
    this.svg.querySelectorAll('.entParam[data-pid="' + paramId + '"]').forEach(t => {
      t.textContent = U.trunc(t.dataset.pname, 14) + ': ' + U.fmtVal(val);
    });
  },

  refreshValues() {
    this.svg.querySelectorAll('.entParam').forEach(t => {
      const v = Engine.values[t.dataset.pid];
      if (v !== undefined) t.textContent = U.trunc(t.dataset.pname, 14) + ': ' + U.fmtVal(v);
    });
  },

  /* ---------- подсветка для панели воздействий ---------- */

  setHighlight(hl) {
    this._hl = hl;
    this._applyHL();
  },

  _applyHL() {
    const hl = this._hl;
    this.svg.classList.toggle('dimming', !!hl);
    this.svg.querySelectorAll('.ent.hl, .arrow.hl').forEach(el => el.classList.remove('hl'));
    if (!hl) return;
    this.svg.querySelectorAll('.ent').forEach(g => {
      if (hl.entityIds.has(g.dataset.id)) g.classList.add('hl');
    });
    this.svg.querySelectorAll('.arrow').forEach(p => {
      if (hl.nodeIds.has(p.dataset.node)) p.classList.add('hl');
    });
  },
};
