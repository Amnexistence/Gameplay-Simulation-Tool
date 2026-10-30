'use strict';
/* ============================================================
   U — мелкие утилиты. Store — модель данных + localStorage.
   Demo — стартовая демо-схема.
   ============================================================ */

const U = {
  uid() {
    return 'id' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
  },
  esc(s) {
    return String(s === undefined || s === null ? '' : s).replace(/[&<>"']/g,
      c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  },
  fmt(v) {
    if (typeof v !== 'number' || isNaN(v)) return '—';
    return String(Math.round(v * 100) / 100);
  },
  num(v, def) { const n = parseFloat(v); return isNaN(n) ? def : n; },
  clamp(v, a, b) { return Math.min(b, Math.max(a, v)); },
  trunc(s, n) { s = String(s || ''); return s.length > n ? s.slice(0, n - 1) + '…' : s; },
  PALETTE_ENT: ['#4da3ff', '#e05c5c', '#06d6a0', '#ffd166', '#9b8cff', '#ff8c42', '#f472b6', '#38bdf8'],
  PALETTE_NODE: ['#ffd166', '#ef476f', '#06d6a0', '#4da3ff', '#9b8cff', '#ff8c42', '#f472b6', '#38bdf8'],
};

/* ---------- нормализация данных (для импорта и защиты от битых данных) ---------- */

function normParam(p) {
  return {
    id: p && p.id || U.uid(),
    name: String(p && p.name || 'параметр'),
    value: U.num(p && p.value, 0),
  };
}

function normEffect(f) {
  f = f || {};
  return {
    id: f.id || U.uid(),
    targetEntityId: String(f.targetEntityId || ''),
    paramId: String(f.paramId || ''),
    op: ['add', 'set', 'mul'].includes(f.op) ? f.op : 'add',
    value: String(f.value === undefined ? '0' : f.value),
    condition: String(f.condition || ''),
    chance: U.clamp(U.num(f.chance, 1), 0, 1),
    priority: U.num(f.priority, 0),
  };
}

function normNode(n, idx) {
  n = n || {};
  return {
    id: n.id || U.uid(),
    name: String(n.name || 'Событие ' + (idx + 1)),
    x: U.num(n.x, 40 + (idx % 3) * 210),
    y: U.num(n.y, 40 + Math.floor(idx / 3) * 120),
    color: String(n.color || U.PALETTE_NODE[idx % U.PALETTE_NODE.length]),
    duration: Math.max(0, U.num(n.duration, 1)),
    repeatChance: U.clamp(U.num(n.repeatChance, 0), 0, 1),
    repeatCond: String(n.repeatCond || ''),
    repeatLimit: Math.max(0, Math.round(U.num(n.repeatLimit, 0))),
    effects: Array.isArray(n.effects) ? n.effects.map(normEffect) : [],
  };
}

function normEdge(e) {
  e = e || {};
  return {
    id: e.id || U.uid(),
    from: String(e.from || ''),
    to: String(e.to || ''),
    condition: String(e.condition || ''),
    chance: U.clamp(U.num(e.chance, 1), 0, 1),
    priority: U.num(e.priority, 0),
  };
}

function normEntity(e, idx) {
  e = e || {};
  const ev = e.events || {};
  const ent = {
    id: e.id || U.uid(),
    name: String(e.name || 'Сущность ' + (idx + 1)),
    x: U.num(e.x, 200 + idx * 220),
    y: U.num(e.y, 250),
    color: String(e.color || U.PALETTE_ENT[idx % U.PALETTE_ENT.length]),
    enabled: e.enabled !== false,
    params: Array.isArray(e.params) ? e.params.map(normParam) : [],
    events: {
      nodes: Array.isArray(ev.nodes) ? ev.nodes.map(normNode) : [],
      edges: Array.isArray(ev.edges) ? ev.edges.map(normEdge) : [],
      entryId: ev.entryId || null,
      autoLoop: ev.autoLoop !== false,
    },
  };
  // чистка dangling-ссылок
  const nodeIds = new Set(ent.events.nodes.map(n => n.id));
  ent.events.edges = ent.events.edges.filter(x => nodeIds.has(x.from) && nodeIds.has(x.to));
  if (!nodeIds.has(ent.events.entryId)) ent.events.entryId = ent.events.nodes[0] ? ent.events.nodes[0].id : null;
  const entIds = new Set(); // заполнится на уровне страницы
  ent._paramIds = new Set(ent.params.map(p => p.id));
  return ent;
}

function normPage(p) {
  p = p || {};
  const page = {
    id: p.id || U.uid(),
    name: String(p.name || 'Страница'),
    entities: Array.isArray(p.entities) ? p.entities.map(normEntity) : [],
  };
  const entIds = new Set(page.entities.map(e => e.id));
  for (const e of page.entities) {
    for (const n of e.events.nodes) {
      n.effects = n.effects.filter(f => entIds.has(f.targetEntityId));
      for (const f of n.effects) {
        const te = page.entities.find(x => x.id === f.targetEntityId);
        if (te && !te.params.some(pp => pp.id === f.paramId)) {
          f.paramId = te.params[0] ? te.params[0].id : '';
        }
      }
    }
    delete e._paramIds;
  }
  return page;
}

/* ---------- хранилище ---------- */

const Store = {
  KEY: 'gameflow-sim-v1',
  state: null,
  _timer: null,
  onSaved: null,

  init() {
    let raw = null;
    try { raw = localStorage.getItem(this.KEY); } catch (e) { /* приватный режим */ }
    if (raw) {
      try {
        const s = JSON.parse(raw);
        if (s && Array.isArray(s.pages) && s.pages.length) {
          this.state = {
            pages: s.pages.map(normPage),
            activePageId: s.activePageId || null,
            simSpeed: U.num(s.simSpeed, 1),
          };
        }
      } catch (e) { console.warn('Не удалось прочитать сохранение', e); }
    }
    if (!this.state) {
      const demo = normPage(Demo.build());
      this.state = { pages: [demo], activePageId: demo.id, simSpeed: 1 };
    }
    if (!this.state.pages.some(p => p.id === this.state.activePageId)) {
      this.state.activePageId = this.state.pages[0].id;
    }
  },

  save() {
    clearTimeout(this._timer);
    this._timer = setTimeout(() => {
      try {
        localStorage.setItem(this.KEY, JSON.stringify(this.state));
        if (this.onSaved) this.onSaved();
      } catch (e) { console.warn('Ошибка сохранения', e); }
    }, 250);
  },

  page() { return this.state.pages.find(p => p.id === this.state.activePageId) || this.state.pages[0] || null; },

  entity(id) {
    const p = this.page();
    return (p && p.entities.find(e => e.id === id)) || null;
  },

  node(entityId, nodeId) {
    const e = this.entity(entityId);
    return (e && e.events.nodes.find(n => n.id === nodeId)) || null;
  },

  findEffect(effectId) {
    const p = this.page();
    if (!p) return null;
    for (const e of p.entities)
      for (const n of e.events.nodes)
        for (const f of n.effects)
          if (f.id === effectId) return { entity: e, node: n, fx: f };
    return null;
  },

  addPage(name) {
    const page = { id: U.uid(), name: name || ('Страница ' + (this.state.pages.length + 1)), entities: [] };
    this.state.pages.push(page);
    this.state.activePageId = page.id;
    this.save();
    return page;
  },

  removePage(id) {
    if (this.state.pages.length <= 1) return false;
    this.state.pages = this.state.pages.filter(p => p.id !== id);
    if (this.state.activePageId === id) this.state.activePageId = this.state.pages[0].id;
    this.save();
    return true;
  },

  clearPage() {
    const p = this.page();
    if (p) { p.entities = []; this.save(); }
  },

  exportAll() {
    return JSON.stringify({
      app: 'GameFlowSim',
      version: 1,
      pages: this.state.pages,
      activePageId: this.state.activePageId,
    }, null, 2);
  },

  importAll(text) {
    const d = JSON.parse(text);
    if (!d || !Array.isArray(d.pages)) throw new Error('Неверный формат: ожидается файл GameFlow с массивом "pages"');
    const pages = d.pages.map(normPage);
    if (!pages.length) throw new Error('В файле нет страниц');
    this.state.pages = pages;
    this.state.activePageId = pages.some(p => p.id === d.activePageId) ? d.activePageId : pages[0].id;
    this.save();
    return pages.length;
  },
};

/* ---------- демо-схема ---------- */

const Demo = {
  build() {
    const page = { id: U.uid(), name: 'Демо: Королевство vs Враг', entities: [] };

    const K = {
      id: U.uid(), name: 'Королевство', x: 300, y: 250, color: '#4da3ff', enabled: true,
      params: [
        { id: U.uid(), name: 'золото', value: 100 },
        { id: U.uid(), name: 'население', value: 50 },
        { id: U.uid(), name: 'армия', value: 10 },
      ],
      events: { nodes: [], edges: [], entryId: null, autoLoop: true },
    };
    const [zol, nas, armK] = K.params;

    const t1 = {
      id: U.uid(), name: 'Сбор налогов', x: 40, y: 40, color: '#ffd166', duration: 3,
      repeatChance: 0, repeatCond: '', repeatLimit: 0,
      effects: [
        { id: U.uid(), targetEntityId: K.id, paramId: zol.id, op: 'add', value: '10 + население * 0.1', condition: '', chance: 1, priority: 0 },
      ],
    };
    const t2 = {
      id: U.uid(), name: 'Наём войск', x: 40, y: 240, color: '#ef476f', duration: 2,
      repeatChance: 0, repeatCond: '', repeatLimit: 0,
      effects: [
        { id: U.uid(), targetEntityId: K.id, paramId: armK.id, op: 'add', value: '5', condition: 'золото >= 40', chance: 1, priority: 0 },
        { id: U.uid(), targetEntityId: K.id, paramId: zol.id, op: 'add', value: '-40', condition: 'золото >= 40', chance: 1, priority: -1 },
      ],
    };
    K.events.nodes = [t1, t2];
    K.events.edges = [
      { id: U.uid(), from: t1.id, to: t2.id, condition: 'золото >= 60', chance: 1, priority: 1 },
      { id: U.uid(), from: t2.id, to: t1.id, condition: '', chance: 1, priority: 0 },
    ];
    K.events.entryId = t1.id;

    const V = {
      id: U.uid(), name: 'Враг', x: 820, y: 250, color: '#e05c5c', enabled: true,
      params: [
        { id: U.uid(), name: 'армия', value: 18 },
        { id: U.uid(), name: 'агрессия', value: 6 },
      ],
      events: { nodes: [], edges: [], entryId: null, autoLoop: true },
    };
    const [armV, agr] = V.params;

    const e1 = {
      id: U.uid(), name: 'Разведка', x: 40, y: 40, color: '#9b8cff', duration: 4,
      repeatChance: 0, repeatCond: '', repeatLimit: 0,
      effects: [
        { id: U.uid(), targetEntityId: V.id, paramId: armV.id, op: 'add', value: 'round(rand(0,3))', condition: '', chance: 1, priority: 0 },
      ],
    };
    const e2 = {
      id: U.uid(), name: 'Атака', x: 40, y: 260, color: '#ff6b4a', duration: 2,
      repeatChance: 0.2, repeatCond: 'Королевство.армия > 0', repeatLimit: 2,
      effects: [
        { id: U.uid(), targetEntityId: K.id, paramId: nas.id, op: 'add', value: '-(5 + агрессия * 0.5)', condition: '', chance: 0.7, priority: 1 },
        { id: U.uid(), targetEntityId: K.id, paramId: zol.id, op: 'add', value: '-20', condition: '', chance: 0.5, priority: 0 },
        { id: U.uid(), targetEntityId: V.id, paramId: armV.id, op: 'add', value: '-round(rand(1,4))', condition: '', chance: 1, priority: 0 },
      ],
    };
    V.events.nodes = [e1, e2];
    V.events.edges = [
      { id: U.uid(), from: e1.id, to: e2.id, condition: 'Королевство.армия < армия', chance: 0.8, priority: 1 },
      { id: U.uid(), from: e2.id, to: e1.id, condition: '', chance: 1, priority: 0 },
    ];
    V.events.entryId = e1.id;

    page.entities = [K, V];
    return page;
  },
};
