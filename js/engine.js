'use strict';
/* ============================================================
   Engine — симуляция в реальном времени.
   Каждая включённая сущность — независимый процесс, идущий по
   своему дереву событий. Процесс: входит в ноду, ждёт duration
   (с учётом скорости), применяет воздействия (по условиям и
   шансам), выбирает следующий переход (приоритет → условие →
   шанс), иначе автоцикл в точку входа, иначе останавливается.
   Воздействия, завершившиеся в одном кадре, применяются в
   порядке приоритета (больший приоритет — раньше).
   ============================================================ */

const Engine = {
  running: false,
  time: 0,
  speed: 1,
  values: {},      // paramId -> текущее значение
  procs: [],       // { entityId, nodeId, timer, repeats, state: 'enter'|'run'|'done' }
  _raf: null,
  _last: 0,
  _ready: false,
  _fxOrder: 0,

  hooks: {
    onEnter: null,   // (entityId, nodeId)
    onExit: null,    // (entityId, nodeId)
    onApply: null,   // (info)
    onLog: null,     // (text, cls)
    onState: null,   // старт/пауза/сброс — для обновления кнопок
    onTick: null,    // каждый кадр — для таймера
  },

  log(text, cls) { if (this.hooks.onLog) this.hooks.onLog(text, cls); },

  /* Разрешение переменных формул: ['золото'] — параметр контекстной
     сущности (или первый найденный глобально), ['Враг','армия'] — явно. */
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
      if (path.length === 1) {
        const name = path[0];
        if (contextEntityId) {
          const ce = page.entities.find(e => e.id === contextEntityId);
          if (ce) { const v = val(ce, name); if (v !== null) return v; }
        }
        for (const e of page.entities) { const v = val(e, name); if (v !== null) return v; }
        throw new Error('Параметр «' + name + '» не найден');
      }
      const ent = page.entities.find(e => e.name === path[0]);
      if (!ent) throw new Error('Сущность «' + path[0] + '» не найдена');
      const pname = path.slice(1).join('.');
      const v = val(ent, pname);
      if (v === null) throw new Error('Параметр «' + pname + '» не найден у сущности «' + ent.name + '»');
      return v;
    };
  },

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

  activeNode(entityId) {
    const pr = this.procs.find(p => p.entityId === entityId);
    return pr && pr.state === 'run' ? pr.nodeId : null;
  },

  /* ---------- внутренний шаг ---------- */

  _frame(ts) {
    let dt = (ts - this._last) / 1000;
    this._last = ts;
    if (dt > 0.25) dt = 0.25;
    const sdt = dt * this.speed;
    this.time += sdt;

    const pending = [];
    for (const pr of this.procs) this._step(pr, sdt, pending);

    if (pending.length) {
      pending.sort((a, b) => (b.priority - a.priority) || (a.order - b.order));
      for (const fx of pending) this._apply(fx);
    }

    if (this.hooks.onTick) this.hooks.onTick();

    if (this.procs.length && this.procs.every(p => p.state === 'done')) {
      this.running = false;
      if (this._raf) cancelAnimationFrame(this._raf);
      this._raf = null;
      this.log('■ Все цепочки событий завершены', 'sys');
      if (this.hooks.onState) this.hooks.onState();
    }
  },

  _step(pr, sdt, pending) {
    if (pr.state === 'done') return;
    const e = Store.entity(pr.entityId);
    if (!e || !e.enabled) { pr.state = 'done'; return; }
    const node = e.events.nodes.find(n => n.id === pr.nodeId);
    if (!node) { pr.state = 'done'; return; }

    if (pr.state === 'enter') {
      pr.state = 'run';
      pr.timer = Math.max(0.02, node.duration);
      if (this.hooks.onEnter) this.hooks.onEnter(e.id, node.id);
      return;
    }

    pr.timer -= sdt;
    let guard = 0;
    while (pr.timer <= 0 && pr.state === 'run' && guard++ < 8) {
      this._complete(e, node, pending);
      if (this.hooks.onExit) this.hooks.onExit(e.id, node.id);
      const next = this._nextNode(e, node, pr);
      if (!next) {
        pr.state = 'done';
        this.log(e.name + ': цепочка событий завершена (нет доступных переходов)', 'sys');
        break;
      }
      pr.nodeId = next.id;
      pr.timer += Math.max(0.02, next.duration);
      pr.state = 'run';
      if (this.hooks.onEnter) this.hooks.onEnter(e.id, next.id);
    }
  },

  _complete(e, node, pending) {
    const resolver = this.makeResolver(e.id);
    for (const fx of node.effects) {
      const te = Store.entity(fx.targetEntityId);
      if (!te) continue;
      const tp = te.params.find(p => p.id === fx.paramId);
      if (!tp) continue;

      if (fx.condition && fx.condition.trim()) {
        const r = Formula.eval(fx.condition, resolver);
        if (!r.ok) {
          this.log('⚠ ' + e.name + ' ▸ ' + node.name + ': ошибка условия «' + fx.condition + '»: ' + r.error, 'err');
          continue;
        }
        if (!Formula.isTruthy(r.value)) continue;
      }

      const chance = typeof fx.chance === 'number' ? fx.chance : 1;
      if (chance < 1 && Math.random() >= chance) continue;

      const vr = Formula.eval(fx.value, resolver);
      if (!vr.ok) {
        this.log('⚠ ' + e.name + ' ▸ ' + node.name + ': ошибка значения «' + fx.value + '»: ' + vr.error, 'err');
        continue;
      }

      pending.push({
        order: this._fxOrder++,
        priority: fx.priority || 0,
        paramId: tp.id, param: tp, target: te,
        op: fx.op, amount: vr.value,
        srcEntity: e, srcNode: node, srcFx: fx,
      });
    }
  },

  _nextNode(e, node, pr) {
    const en = e.events;
    const resolver = this.makeResolver(e.id);

    // повтор текущего события
    const rc = node.repeatChance || 0;
    if (rc > 0) {
      let ok = Math.random() < rc;
      if (ok && node.repeatCond && node.repeatCond.trim()) {
        const r = Formula.eval(node.repeatCond, resolver);
        if (!r.ok) { this.log('⚠ ' + e.name + ' ▸ ' + node.name + ': ошибка условия повтора: ' + r.error, 'err'); ok = false; }
        else ok = Formula.isTruthy(r.value);
      }
      if (ok && (!node.repeatLimit || pr.repeats < node.repeatLimit)) {
        pr.repeats++;
        this.log('⟳ ' + e.name + ': повтор события «' + node.name + '» (' + pr.repeats + (node.repeatLimit ? '/' + node.repeatLimit : '') + ')', 'rep');
        return node;
      }
    }
    pr.repeats = 0;

    // переходы: приоритет → условие → шанс
    const outs = en.edges.filter(ed => ed.from === node.id)
      .sort((a, b) => (b.priority || 0) - (a.priority || 0));
    for (const ed of outs) {
      if (ed.condition && ed.condition.trim()) {
        const r = Formula.eval(ed.condition, resolver);
        if (!r.ok) { this.log('⚠ ' + e.name + ': ошибка условия перехода «' + ed.condition + '»: ' + r.error, 'err'); continue; }
        if (!Formula.isTruthy(r.value)) continue;
      }
      const ch = typeof ed.chance === 'number' ? ed.chance : 1;
      if (ch < 1 && Math.random() >= ch) continue;
      const tn = en.nodes.find(n => n.id === ed.to);
      if (tn) return tn;
    }

    // автоцикл
    if (en.autoLoop) {
      const entry = en.nodes.find(n => n.id === en.entryId) || en.nodes[0];
      if (entry) return entry;
    }
    return null;
  },

  _apply(fx) {
    const cur = this.values[fx.paramId];
    const old = cur === undefined ? fx.param.value : cur;
    let nv;
    if (fx.op === 'set') nv = fx.amount;
    else if (fx.op === 'mul') nv = old * fx.amount;
    else nv = old + fx.amount;
    if (typeof nv !== 'number' || isNaN(nv)) {
      this.log('⚠ Результат не число: ' + fx.target.name + '.' + fx.param.name, 'err');
      return;
    }
    this.values[fx.paramId] = nv;

    const sign = fx.op === 'set' ? '= ' : fx.op === 'mul' ? '× ' : (fx.amount >= 0 ? '+' : '');
    this.log(
      '[' + U.fmt(this.time) + 'с] ' + fx.srcEntity.name + ' ▸ ' + fx.srcNode.name + ': ' +
      fx.target.name + '.' + fx.param.name + ' ' + sign + U.fmt(fx.amount) +
      ' (' + U.fmt(old) + ' → ' + U.fmt(nv) + ')',
      fx.amount >= 0 && fx.op !== 'mul' ? 'pos' : 'neg'
    );

    if (this.hooks.onApply) this.hooks.onApply({
      srcEntityId: fx.srcEntity.id, srcNodeId: fx.srcNode.id,
      targetEntityId: fx.target.id, targetName: fx.target.name,
      paramId: fx.paramId, paramName: fx.param.name,
      op: fx.op, amount: fx.amount, old, val: nv,
    });
  },
};
