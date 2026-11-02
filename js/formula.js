'use strict';
/* ============================================================
   Formula — парсер и вычислитель выражений.
   Поддерживает: + - * / % ^, скобки, сравнения (== != < > <= >=),
   логические && || !, тернарный оператор ?:, функции
   (min, max, abs, round, floor, ceil, sqrt, pow, log, exp, sin, cos, rand),
   переменные вида «Параметр» (контекстная сущность) или «Сущность.Параметр».
   Без eval — собственный рекурсивный спуск.
   ============================================================ */
const Formula = (() => {

  const FUNCS = {
    min: Math.min, max: Math.max, abs: Math.abs, round: Math.round,
    floor: Math.floor, ceil: Math.ceil, sqrt: Math.sqrt, pow: Math.pow,
    log: Math.log, exp: Math.exp, sin: Math.sin, cos: Math.cos,
  };

  const ID_START = /[A-Za-z_А-Яа-яЁё]/;
  const ID_PART = /[A-Za-z0-9_А-Яа-яЁё]/;

  function tokenize(s) {
    const t = [];
    let i = 0;
    while (i < s.length) {
      const c = s[i];
      if (/\s/.test(c)) { i++; continue; }
      if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(s[i + 1] || ''))) {
        let j = i;
        while (j < s.length && /[0-9.]/.test(s[j])) j++;
        const num = parseFloat(s.slice(i, j));
        if (isNaN(num)) throw new Error('Некорректное число «' + s.slice(i, j) + '»');
        t.push({ k: 'num', v: num });
        i = j;
        continue;
      }
      if (ID_START.test(c)) {
        let j = i;
        while (j < s.length && ID_PART.test(s[j])) j++;
        t.push({ k: 'id', v: s.slice(i, j) });
        i = j;
        continue;
      }
      if (c === '"' || c === "'") {
        // цитируемое имя (параметры/сущности с пробелами и др. разделителями)
        let j = i + 1;
        while (j < s.length && s[j] !== c) j++;
        if (j >= s.length) throw new Error('Незакрытая кавычка в имени');
        t.push({ k: 'qid', v: s.slice(i + 1, j) });
        i = j + 1;
        continue;
      }
      const two = s.slice(i, i + 2);
      if (['==', '!=', '<=', '>=', '&&', '||'].includes(two)) {
        t.push({ k: 'op', v: two }); i += 2; continue;
      }
      if ('+-*/%^<>!?:(),.'.includes(c)) {
        t.push({ k: 'op', v: c }); i++; continue;
      }
      throw new Error('Недопустимый символ «' + c + '»');
    }
    return t;
  }

  function parse(tk) {
    let i = 0;
    const peek = () => tk[i];
    const eat = v => { const t = tk[i]; if (t && t.k === 'op' && t.v === v) { i++; return true; } return false; };
    const expect = v => { if (!eat(v)) throw new Error('Ожидался символ «' + v + '»'); };

    function expr() {
      const c = orExpr();
      if (eat('?')) {
        const a = expr();
        expect(':');
        const b = expr();
        return { t: 'tern', c, a, b };
      }
      return c;
    }
    function orExpr() { let l = andExpr(); while (eat('||')) { const r = andExpr(); l = { t: 'bin', op: '||', l, r }; } return l; }
    function andExpr() { let l = cmp(); while (eat('&&')) { const r = cmp(); l = { t: 'bin', op: '&&', l, r }; } return l; }
    function cmp() {
      let l = add();
      while (true) {
        const t = peek();
        if (t && t.k === 'op' && ['==', '!=', '<=', '>=', '<', '>'].includes(t.v)) { i++; const r = add(); l = { t: 'bin', op: t.v, l, r }; }
        else break;
      }
      return l;
    }
    function add() {
      let l = mul();
      while (true) {
        const t = peek();
        if (t && t.k === 'op' && (t.v === '+' || t.v === '-')) { i++; const r = mul(); l = { t: 'bin', op: t.v, l, r }; }
        else break;
      }
      return l;
    }
    function mul() {
      let l = unary();
      while (true) {
        const t = peek();
        if (t && t.k === 'op' && (t.v === '*' || t.v === '/' || t.v === '%')) { i++; const r = unary(); l = { t: 'bin', op: t.v, l, r }; }
        else break;
      }
      return l;
    }
    function unary() {
      const t = peek();
      if (t && t.k === 'op' && (t.v === '-' || t.v === '!')) { i++; return { t: 'un', op: t.v, a: unary() }; }
      return pow();
    }
    function pow() {
      const b = primary();
      if (eat('^')) return { t: 'bin', op: '^', l: b, r: unary() };
      return b;
    }
    function primary() {
      const t = peek();
      if (!t) throw new Error('Неожиданный конец выражения');
      if (t.k === 'num') { i++; return { t: 'num', v: t.v }; }
      if (t.k === 'id' || t.k === 'qid') {
        i++;
        const nx = peek();
        if (t.k === 'id' && nx && nx.k === 'op' && nx.v === '(') {
          i++;
          const args = [];
          if (!eat(')')) {
            args.push(expr());
            while (eat(',')) args.push(expr());
            expect(')');
          }
          return { t: 'call', name: t.v, args };
        }
        const path = [t.v];
        while (peek() && peek().k === 'op' && peek().v === '.') {
          i++;
          const nt = peek();
          if (!nt || (nt.k !== 'id' && nt.k !== 'qid')) throw new Error('Ожидалось имя параметра после «.»');
          i++;
          path.push(nt.v);
        }
        return { t: 'var', path };
      }
      if (t.k === 'op' && t.v === '(') { i++; const e = expr(); expect(')'); return e; }
      throw new Error('Неожиданный символ «' + t.v + '»');
    }

    const ast = expr();
    if (i < tk.length) throw new Error('Лишнее в выражении: «' + tk[i].v + '»');
    return ast;
  }

  function isTruthy(v) { return typeof v === 'number' && !isNaN(v) && v !== 0; }

  function evalAst(n, rv) {
    switch (n.t) {
      case 'num': return n.v;
      case 'var': {
        const v = rv(n.path);
        if (typeof v !== 'number' || isNaN(v)) throw new Error('Переменная «' + n.path.join('.') + '» не является числом');
        return v;
      }
      case 'un': {
        const a = evalAst(n.a, rv);
        return n.op === '-' ? -a : (isTruthy(a) ? 0 : 1);
      }
      case 'tern':
        return isTruthy(evalAst(n.c, rv)) ? evalAst(n.a, rv) : evalAst(n.b, rv);
      case 'bin': {
        const op = n.op;
        if (op === '&&') return (isTruthy(evalAst(n.l, rv)) && isTruthy(evalAst(n.r, rv))) ? 1 : 0;
        if (op === '||') return (isTruthy(evalAst(n.l, rv)) || isTruthy(evalAst(n.r, rv))) ? 1 : 0;
        const l = evalAst(n.l, rv), r = evalAst(n.r, rv);
        switch (op) {
          case '+': return l + r;
          case '-': return l - r;
          case '*': return l * r;
          case '/': if (r === 0) throw new Error('Деление на ноль'); return l / r;
          case '%': if (r === 0) throw new Error('Деление на ноль'); return l % r;
          case '^': return Math.pow(l, r);
          case '==': return l === r ? 1 : 0;
          case '!=': return l !== r ? 1 : 0;
          case '<': return l < r ? 1 : 0;
          case '>': return l > r ? 1 : 0;
          case '<=': return l <= r ? 1 : 0;
          case '>=': return l >= r ? 1 : 0;
        }
        throw new Error('Неизвестный оператор «' + op + '»');
      }
      case 'call': {
        const name = n.name.toLowerCase();
        if (name === 'rand' || name === 'random') {
          const a = n.args.map(x => evalAst(x, rv));
          if (a.length === 0) return Math.random();
          if (a.length === 1) return Math.random() * a[0];
          return a[0] + Math.random() * (a[1] - a[0]);
        }
        const f = FUNCS[name];
        if (!f) throw new Error('Неизвестная функция «' + n.name + '»');
        const a = n.args.map(x => evalAst(x, rv));
        if (a.some(x => typeof x !== 'number' || isNaN(x))) throw new Error('Аргумент функции «' + n.name + '» — не число');
        return f(...a);
      }
    }
    throw new Error('Неизвестный узел выражения');
  }

  const cache = new Map();

  function compile(src) {
    if (cache.has(src)) return cache.get(src);
    let res;
    try { res = { ast: parse(tokenize(src)) }; }
    catch (e) { res = { error: e.message }; }
    if (cache.size > 500) cache.clear();
    cache.set(src, res);
    return res;
  }

  /* Вычислить выражение. resolveVar(path: string[]) -> number.
     Пустое выражение считается 0 (ok, empty). */
  function evalSrc(src, resolveVar) {
    if (src === undefined || src === null || String(src).trim() === '') return { ok: true, value: 0, empty: true };
    const c = compile(String(src).trim());
    if (c.error) return { ok: false, error: c.error };
    try {
      const v = evalAst(c.ast, resolveVar);
      if (typeof v !== 'number' || isNaN(v)) return { ok: false, error: 'Результат не является числом' };
      return { ok: true, value: v };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }

  /* Только проверка синтаксиса (без переменных). Вернёт текст ошибки или null. */
  function syntaxError(src) {
    if (!src || !String(src).trim()) return null;
    const c = compile(String(src).trim());
    return c.error || null;
  }

  return { eval: evalSrc, isTruthy, syntaxError };
})();
