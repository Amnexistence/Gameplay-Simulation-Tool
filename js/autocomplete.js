'use strict';
/* ============================================================
   AC — автоподстановка имён сущностей/параметров в формулы.
   Работает для любых input.ac: при вводе показывает выпадающий
   список подходящих имён (сущность, сущность.параметр, свой
   параметр); имена с пробелами и спецсимволами вставляются
   в кавычках. Выбор — кликом по элементу списка.
   ============================================================ */

const AC = {
  listEl: null,
  input: null,
  items: [],
  token: '',
  start: 0,
  end: 0,

  init() {
    this.listEl = document.createElement('div');
    this.listEl.id = 'acList';
    document.body.appendChild(this.listEl);

    document.addEventListener('focusin', e => {
      if (e.target.matches && e.target.matches('input.ac')) { this.input = e.target; this.refresh(); }
    });
    document.addEventListener('focusout', e => {
      if (e.target === this.input) setTimeout(() => this.hide(), 140);
    });
    document.addEventListener('input', e => {
      if (e.target.matches && e.target.matches('input.ac')) { this.input = e.target; this.refresh(); }
    });
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && this.listEl.style.display === 'block') { this.hide(); e.stopPropagation(); }
    }, true);
    this.listEl.addEventListener('mousedown', e => {
      const it = e.target.closest('.ac-item');
      if (!it) return;
      e.preventDefault();
      this.apply(it.dataset.insert);
    });
    window.addEventListener('scroll', () => this.hide(), true);
    window.addEventListener('resize', () => this.hide());
  },

  /* токен (начало имени) под курсором */
  tokenAt() {
    const v = this.input.value;
    const pos = this.input.selectionStart === null ? v.length : this.input.selectionStart;
    const head = v.slice(0, pos);
    const m = head.match(/[^+\-*/%^<>=!&|?():,;]*$/);
    let token = m ? m[0] : '';
    const lead = token.length - token.replace(/^\s+/, '').length;
    token = token.slice(lead);
    return { token, start: pos - token.length, end: pos };
  },

  candidates() {
    const page = Store.page();
    const out = [];
    if (!page) return out;
    for (const e of page.entities) {
      out.push({ label: e.name, insert: U.quoteName(e.name), kind: 'сущность' });
    }
    const seen = new Set();
    for (const e of page.entities) {
      for (const p of e.params) {
        out.push({ label: e.name + '.' + p.name, insert: U.quoteName(e.name) + '.' + U.quoteName(p.name), kind: 'параметр' });
        if (!seen.has(p.name)) {
          seen.add(p.name);
          out.push({ label: p.name, insert: U.quoteName(p.name), kind: 'свой параметр' });
        }
      }
    }
    return out;
  },

  refresh() {
    if (!this.input || !document.body.contains(this.input)) { this.hide(); return; }
    const { token, start, end } = this.tokenAt();
    this.token = token; this.start = start; this.end = end;
    const q = token.replace(/^["']/, '').toLowerCase();
    let items = this.candidates();
    if (q) items = items.filter(c => c.label.toLowerCase().includes(q));
    this.items = items.slice(0, 40);
    if (!this.items.length) { this.hide(); return; }
    this.listEl.innerHTML = this.items.map(c =>
      '<div class="ac-item" data-insert="' + U.esc(c.insert) + '">' + U.esc(c.label) +
      '<span class="kind">' + c.kind + '</span></div>').join('');
    const r = this.input.getBoundingClientRect();
    this.listEl.style.display = 'block';
    this.listEl.style.left = Math.max(4, Math.min(r.left, window.innerWidth - 280)) + 'px';
    this.listEl.style.top = (r.bottom + 2) + 'px';
    this.listEl.style.width = Math.max(230, Math.min(r.width, 420)) + 'px';
  },

  apply(insert) {
    if (!this.input) return;
    const v = this.input.value;
    this.input.value = v.slice(0, this.start) + insert + v.slice(this.end);
    const pos = this.start + insert.length;
    this.input.setSelectionRange(pos, pos);
    this.input.focus();
    this.input.dispatchEvent(new Event('input', { bubbles: true }));
    this.hide();
  },

  hide() { if (this.listEl) this.listEl.style.display = 'none'; },
};
