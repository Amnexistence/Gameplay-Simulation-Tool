'use strict';
/* ============================================================
   Engine — симуляция в реальном времени.
   Каждая включённая сущность — независимый процесс, идущий по
   своему дереву событий. Процесс: входит в ноду, ждёт duration
   (с учётом скорости), применяет воздействия (по условиям и
   шансам), выбирает следующий переход (повтор и переходы
   конкурируют по ПРИОРИТЕТУ: условие → шанс), иначе автоцикл
   в точку входа, иначе останавливается.
   Воздействия, завершившиеся в одном тике, применяются в порядке
   приоритета (больший — раньше).
   Типы параметров: num (с min/max-ограничением), bool, text.
   Шансы (воздействия, переходы, повторы) — число в % или формула
   (результат тоже в %), вычисляемая в контексте сущности.
   ============================================================ */

const Engine = {
  running: false,
  time: 0,
  speed: 1,
  stopCond: '',          // формула: при истине — автостоп
  values: {},            // paramId -> текущее значение (number|boolean|string)
  procs: [],             // { entityId, nodeId, timer, repeats, state }
  _raf: null,
  _last: 0,
  _ready: false,
  _fxOrder: 0,

  hooks: {
    onEnter: null, onExit: null, onApply: null, onLog: null,
    onState: null, onTick: null, onReset: null,
  },

  log(text, cls) { if (this.hooks.onLog) this.hooks.onLog(text, cls); },

  /* ---------- разрешение переменных формул ---------- */

  makeResolver(contextEntityId) {
    const self = this;
    return function (path) {
      const page = Store.page();
      if (!page) throw new Error('Нет активной страницы');
      const val = (ent, pname) => {
        const p = ent.params.find(pp => pp.name === pname);
        if (!p) return null;
        const v = self.values[p.id];
        return v === undefined ? p.value : v;
      };
      const toNum = (v, label) => {
        if (typeof v === 'boolean') return v ? 1 : 0;
        if (typeof v === 'number') return v;
        throw new Error('Параметр «' + label + '» не является числом (тип: ' +
          (typeof v === 'string' ? 'текст' : '?') + ')');
      };
      if (path.length === 1) {
        const name = path[0];
        if (contextEntityId) {
          const ce = page.entities.find(e => e.id === contextEntityId);
          if (ce) { const v = val(ce, name); if (v !== null) return toNum(v, name); }
        }
        for (const e of page.entities) { const v = val(e, name); if (v !== null) return toNum(v, name); }
        throw new Error('Параметр «' + name + '» не найден');
      }
      const ent = page.entities.find(e => e.name === path[0]);
      if (!ent) throw new Error('Сущность «' + path[0] + '» не найдена');
      const pname = path.slice(1).join('.');
      const v = val(ent, pname);
      if (v === null) throw new Error('Параметр «' + pname + '» не найден у сущности «' + ent.name + '»');
      return toNum(v, pname);
    };
  },

  /* Шанс: строка «75» (проценты) или формула (результат в процентах) → 0..1 */
  evalChance(src, resolver, where) {
    const s = String(src === undefined ? '100' : src).trim();
    if (!s) return 1;
    if (/^-?\d+(\.\d+)?$/.test(s)) return U.clamp(parseFloat(s) / 100, 0, 1);
    const r = Formula.eval(s, resolver);
    if (!r.ok) { this.log('⚠ ' + where + ': ошибка формулы шанса «' + s + '»: ' + r.error, 'err'); return 0; }
    return U.clamp(r.value / 100, 0, 1);
  },

  /* ---------- управление ---------- */

  reset(silent) {
    this.running = false;
    if (this._raf) cancelAnimationFrame(this._raf);
    this._raf = null;
    this.time = 0;
    this.procs = [];
    this.values = {};
    const page = Store.page();
    if (page) {
      for (const e of page.entities)
        for (const p of e.params)
          this.values[p.id] = p.value;
      for (const e of page.entities) {
        if (!e.enabled) continue;
        const en = e.events;
        const entry = en.nodes.find(n => n.id === en.entryId) || en.nodes[0];
        if (!entry) continue;
        this.procs.push({ entityId: e.id, nodeId: entry.id, timer: 0, repeats: 0, state: 'enter' });
      }
    }
    this._ready = true;
    if (!silent) this.log('⟲ Симуляция сброшена. Параметры возвращены к стартовым значениям.', 'sys');
    if (this.hooks.onState) this.hooks.onState();
    if (this.hooks.onTick) this.hooks.onTick();
    if (this.hooks.onReset) this.hooks.onReset();
  },

  start() {
    if (this.running) return;
    if (!this._ready) this.reset(true);
    this.running = true;
    this._last = performance.now();
    const loop = ts => {
      if (!this.running) return;
      this._frame(ts);
      this._raf = requestAnimationFrame(loop);
    };
    this._raf = requestAnimationFrame(loop);
    this.log('▶ Симуляция запущена (скорость ×' + this.speed + ')', 'sys');
    if (this.hooks.onState) this.hooks.onState();
  },

  pause() {
    if (!this.running) return;
    this.running = false;
    if (this._raf) cancelAnimationFrame(this._raf);
    this._raf = null;
    this.log('⏸ Пауза', 'sys');
    if (this.hooks.onState) this.hooks.onState();
  },

  toggle() { this.running ? this.pause() : this.start(); },

  setSpeed(v) {
    this.speed = v;
    Store.state.simSpeed = v;
    Store.save();
  },

  /* Пошаговый дебаг: продвинуть симуляцию ровно на sec симуляционных секунд */
  advance(sec) {
    if (this.running) this.pause();
    if (!this._ready) this.reset(true);
    this._runFor(Math.max(0, U.num(sec, 0)), 200000);
    this._checkStop();
    if (this.procs.length && this.procs.every(p => p.state === 'done')) {
      this.log('■ Все цепочки событий завершены', 'sys');
    }
    if (this.hooks.onTick) this.hooks.onTick();
    if (this.hooks.onState) this.hooks.onState();
  },

  activeNode(entityId) {
    const pr = this.procs.find(p => p.entityId === entityId);
    return pr && pr.state === 'run' ? pr.nodeId : null;
  },

  /* ---------- стоп-условие ---------- */

  _checkStop() {
    const cond = (this.stopCond || '').trim();
    if (!cond) return false;
    const r = Formula.eval(cond, this.makeResolver(null));
    if (!r.ok) { this.log('⚠ Ошибка условия остановки «' + cond + '»: ' + r.error, 'err'); return false; }
    if (Formula.isTruthy(r.value)) {
      this.log('⏹ Симуляция остановлена по условию: ' + cond, 'sys');
      if (this.running) this.pause();
      else if (this.hooks.onState) this.hooks.onState();
      return true;
    }
    return false;
  },

  /* ---------- кадр ---------- */

  _frame(ts) {
    let dt = (ts - this._last) / 1000;
    this._last = ts;
    if (dt > 0.25) dt = 0.25;
    this._runFor(dt * this.speed, 1024);

    if (this.hooks.onTick) this.hooks.onTick();
    if (this._checkStop()) return;

    if (this.procs.length && this.procs.every(p => p.state === 'done')) {
      this.running = false;
      if (this._raf) cancelAnimationFrame(this._raf);
      this._raf = null;
      this.log('■ Все цепочки событий завершены', 'sys');
      if (this.hooks.onState) this.hooks.onState();
    }
  },

  /* ---------- дискретно-событийное ядро ----------
     Продвигает симуляцию ровно на sdt симуляционных секунд.
     Часы переводятся к моменту ближайшего завершения события;
     воздействия применяются СРАЗУ в этот момент, поэтому условия
     и формулы следующих (более поздних) событий видят свежие
     значения. Траектория не зависит от скорости симуляции и
     частоты кадров. События, совпавшие по времени, применяются
     пакетом в порядке приоритета. */
  _runFor(sdt, maxEvents) {
    let rem = Math.max(0, sdt);
    let events = 0;
    const cap = maxEvents || 1024;

    // процессы в состоянии входа активируются в текущий момент
    for (const pr of this.procs) if (pr.state === 'enter') this._enterProc(pr);

    while (rem > 1e-9 && events < cap) {
      let minT = Infinity;
      for (const pr of this.procs) {
        if (pr.state === 'run' && pr.timer < minT) minT = pr.timer;
      }
      if (minT === Infinity) break;              // активных процессов нет
      if (minT > rem + 1e-9) {                   // завершений на отрезке не будет
        for (const pr of this.procs) if (pr.state === 'run') pr.timer -= rem;
        this.time += rem;
        rem = 0;
        break;
      }
      // переводим часы к ближайшему событию
      for (const pr of this.procs) if (pr.state === 'run') pr.timer -= minT;
      this.time += minT;
      rem -= minT;
      // все завершения в этот момент (одновременные — пакетом по приоритету)
      const pending = [];
      for (const pr of this.procs) {
        if (pr.state === 'run' && pr.timer <= 1e-9) {
          this._completeProc(pr, pending);
          events++;
        }
      }
      this._applyPending(pending);
    }
    if (rem > 1e-9) {
      // исчерпан лимит событий за вызов (патологически короткие циклы):
      // просто дочитываем оставшийся отрезок без завершений
      for (const pr of this.procs) if (pr.state === 'run') pr.timer -= rem;
      this.time += rem;
    }
  },

  _enterProc(pr) {
    const e = Store.entity(pr.entityId);
    if (!e || !e.enabled) { pr.state = 'done'; return; }
    const node = e.events.nodes.find(n => n.id === pr.nodeId);
    if (!node) { pr.state = 'done'; return; }
    pr.state = 'run';
    pr.timer = Math.max(0.02, node.duration);
    if (this.hooks.onEnter) this.hooks.onEnter(e.id, node.id);
  },

  _completeProc(pr, pending) {
    const e = Store.entity(pr.entityId);
    if (!e || !e.enabled) { pr.state = 'done'; return; }
    const node = e.events.nodes.find(n => n.id === pr.nodeId);
    if (!node) { pr.state = 'done'; return; }
    this._complete(e, node, pending);
    if (this.hooks.onExit) this.hooks.onExit(e.id, node.id);
    const next = this._nextNode(e, node, pr);
    if (!next) {
      pr.state = 'done';
      this.log(e.name + ': цепочка событий завершена (нет доступных переходов)', 'sys');
      return;
    }
    pr.nodeId = next.id;
    pr.state = 'run';
    pr.timer = Math.max(0.02, next.duration);
    if (this.hooks.onEnter) this.hooks.onEnter(e.id, next.id);
  },

  _applyPending(pending) {
    if (!pending.length) return;
    pending.sort((a, b) => (b.priority - a.priority) || (a.order - b.order));
    for (const fx of pending) this._apply(fx);
  },

  /* ---------- применения воздействий ---------- */

  _complete(e, node, pending) {
    const resolver = this.makeResolver(e.id);
    for (const fx of node.effects) {
      const te = Store.entity(fx.targetEntityId);
      if (!te) continue;
      const tp = te.params.find(p => p.id === fx.paramId);
      if (!tp) continue;
      const where = e.name + ' ▸ ' + node.name;

      if (fx.condition && fx.condition.trim()) {
        const r = Formula.eval(fx.condition, resolver);
        if (!r.ok) { this.log('⚠ ' + where + ': ошибка условия «' + fx.condition + '»: ' + r.error, 'err'); continue; }
        if (!Formula.isTruthy(r.value)) continue;
      }

      const chance = this.evalChance(fx.chance, resolver, where);
      if (chance < 1 && Math.random() >= chance) continue;

      // проверка совместимости операции и типа параметра
      if (tp.type === 'text') {
        if (fx.op !== 'set') { this.log('⚠ ' + where + ': к текстовому параметру «' + tp.name + '» применима только операция «=»', 'err'); continue; }
        pending.push({
          order: this._fxOrder++, priority: fx.priority || 0,
          paramId: tp.id, param: tp, target: te, op: fx.op,
          mode: 'text', raw: String(fx.value),
          srcEntity: e, srcNode: node, srcFx: fx,
        });
        continue;
      }

      const vr = Formula.eval(fx.value, resolver);
      if (!vr.ok) { this.log('⚠ ' + where + ': ошибка значения «' + fx.value + '»: ' + vr.error, 'err'); continue; }

      if (tp.type === 'bool') {
        if (fx.op !== 'set' && fx.op !== 'toggle') { this.log('⚠ ' + where + ': булев параметр «' + tp.name + '» поддерживает только «=» и инверсию', 'err'); continue; }
        pending.push({
          order: this._fxOrder++, priority: fx.priority || 0,
          paramId: tp.id, param: tp, target: te, op: fx.op,
          mode: 'bool', amount: vr.value,
          srcEntity: e, srcNode: node, srcFx: fx,
        });
        continue;
      }

      // num
      pending.push({
        order: this._fxOrder++, priority: fx.priority || 0,
        paramId: tp.id, param: tp, target: te, op: fx.op,
        mode: 'num', amount: vr.value,
        srcEntity: e, srcNode: node, srcFx: fx,
      });
    }
  },

  _apply(fx) {
    const cur = this.values[fx.paramId];
    const old = cur === undefined ? fx.param.value : cur;
    let nv, display, cls;

    if (fx.mode === 'text') {
      nv = fx.raw;
      display = '= ' + U.trunc(nv, 10);
      cls = 'fx-set';
    } else if (fx.mode === 'bool') {
      if (fx.op === 'toggle') nv = !old;
      else nv = Formula.isTruthy(fx.amount);
      display = (fx.op === 'toggle' ? '→ ' : '= ') + (nv ? 'да' : 'нет');
      cls = 'fx-set';
    } else {
      let n;
      if (fx.op === 'set') n = fx.amount;
      else if (fx.op === 'mul') n = old * fx.amount;
      else n = old + fx.amount;
      if (typeof n !== 'number' || isNaN(n)) {
        this.log('⚠ Результат не число: ' + fx.target.name + '.' + fx.param.name, 'err');
        return;
      }
      // ограничение min/max: воздействие не блокируется, значение зажимается
      if (fx.param.min !== null && fx.param.min !== undefined) n = Math.max(fx.param.min, n);
      if (fx.param.max !== null && fx.param.max !== undefined) n = Math.min(fx.param.max, n);
      nv = n;
      display = (fx.op === 'set' ? '= ' : fx.op === 'mul' ? '× ' : (fx.amount >= 0 ? '+' : '')) + U.fmt(fx.op === 'mul' || fx.op === 'set' ? fx.amount : fx.amount);
      cls = fx.op === 'add' ? (fx.amount >= 0 ? 'fx-pos' : 'fx-neg') : 'fx-set';
    }

    this.values[fx.paramId] = nv;

    this.log(
      '[' + U.fmt(this.time) + 'с] ' + fx.srcEntity.name + ' ▸ ' + fx.srcNode.name + ': ' +
      fx.target.name + '.' + fx.param.name + ' ' + display +
      ' (' + U.fmtVal(old) + ' → ' + U.fmtVal(nv) + ')',
      cls === 'fx-pos' ? 'pos' : cls === 'fx-neg' ? 'neg' : 'rep'
    );

    if (this.hooks.onApply) this.hooks.onApply({
      srcEntityId: fx.srcEntity.id, srcNodeId: fx.srcNode.id,
      targetEntityId: fx.target.id, targetName: fx.target.name,
      paramId: fx.paramId, paramName: fx.param.name, type: fx.param.type,
      op: fx.op, amount: fx.mode === 'num' ? fx.amount : null,
      display, cls, old, val: nv,
    });
  },

  /* ---------- выбор следующего узла ---------- */

  _nextNode(e, node, pr) {
    const en = e.events;
    const resolver = this.makeResolver(e.id);
    const where = e.name + ' ▸ ' + node.name;

    // кандидаты: повтор (сам в себя) и переходы — конкурируют по приоритету
    const cands = [];
    if (parseFloat(String(node.repeatChance)) > 0 || !/^-?\d+(\.\d+)?$/.test(String(node.repeatChance).trim())) {
      cands.push({ kind: 'repeat', prio: node.repeatPriority || 0 });
    }
    for (const ed of en.edges.filter(x => x.from === node.id)) {
      cands.push({ kind: 'edge', ed, prio: ed.priority || 0 });
    }
    cands.sort((a, b) => b.prio - a.prio);

    for (const c of cands) {
      if (c.kind === 'repeat') {
        const ch = this.evalChance(node.repeatChance, resolver, where + ' (повтор)');
        if (!(ch > 0 && Math.random() < ch)) continue;
        if (node.repeatCond && node.repeatCond.trim()) {
          const r = Formula.eval(node.repeatCond, resolver);
          if (!r.ok) { this.log('⚠ ' + where + ': ошибка условия повтора: ' + r.error, 'err'); continue; }
          if (!Formula.isTruthy(r.value)) continue;
        }
        if (node.repeatLimit && pr.repeats >= node.repeatLimit) continue;
        pr.repeats++;
        this.log('⟳ ' + e.name + ': повтор события «' + node.name + '» (' + pr.repeats + (node.repeatLimit ? '/' + node.repeatLimit : '') + ')', 'rep');
        return node;
      } else {
        const ed = c.ed;
        if (ed.condition && ed.condition.trim()) {
          const r = Formula.eval(ed.condition, resolver);
          if (!r.ok) { this.log('⚠ ' + e.name + ': ошибка условия перехода «' + ed.condition + '»: ' + r.error, 'err'); continue; }
          if (!Formula.isTruthy(r.value)) continue;
        }
        const ch = this.evalChance(ed.chance, resolver, e.name + ' (переход)');
        if (ch < 1 && Math.random() >= ch) continue;
        const tn = en.nodes.find(n => n.id === ed.to);
        if (tn) return tn;
      }
    }

    // автоцикл
    if (en.autoLoop) {
      const entry = en.nodes.find(n => n.id === en.entryId) || en.nodes[0];
      if (entry) return entry;
    }
    return null;
  },
};
