// ══════════════════════════════════════════════════════════════════════════
// EU RESOLVO — Núcleo compartilhado: API client, auth, tema, toast, WS.
// ══════════════════════════════════════════════════════════════════════════
(function (global) {
  'use strict';

  const API_BASE = (function () {
    // detecta se o app está em subdiretório
    const p = location.pathname.replace(/\/(portal|legal|site)\/.+$|\/index\.html$/, '');
    return p.replace(/\/$/, '') + '/api/v1';
  })();

  const TOKEN_KEY   = 'er_token';
  const REFRESH_KEY = 'er_refresh';
  const USER_KEY    = 'er_user';
  const THEME_KEY   = 'er_theme';

  const store = {
    get token()   { return localStorage.getItem(TOKEN_KEY); },
    set token(v)  { v ? localStorage.setItem(TOKEN_KEY, v) : localStorage.removeItem(TOKEN_KEY); },
    get refresh() { return localStorage.getItem(REFRESH_KEY); },
    set refresh(v){ v ? localStorage.setItem(REFRESH_KEY, v) : localStorage.removeItem(REFRESH_KEY); },
    get user()    { try { return JSON.parse(localStorage.getItem(USER_KEY) || 'null'); } catch { return null; } },
    set user(v)   { v ? localStorage.setItem(USER_KEY, JSON.stringify(v)) : localStorage.removeItem(USER_KEY); },
    clear() { this.token = null; this.refresh = null; this.user = null; },
  };

  async function api(path, opts = {}) {
    const url = API_BASE + path;
    const headers = Object.assign({ 'Content-Type': 'application/json' }, opts.headers || {});
    if (store.token) headers['Authorization'] = 'Bearer ' + store.token;
    // FormData → não seta Content-Type
    if (opts.body instanceof FormData) delete headers['Content-Type'];
    const body = opts.body instanceof FormData
      ? opts.body
      : (opts.body !== undefined ? JSON.stringify(opts.body) : undefined);
    let res = await fetch(url, { method: opts.method || 'GET', headers, body });
    if (res.status === 401 && store.refresh && !opts._retry) {
      // Tenta refresh
      const r = await fetch(API_BASE + '/auth/refresh', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh: store.refresh }),
      });
      if (r.ok) {
        const d = await r.json();
        store.token = d.token; store.refresh = d.refresh; store.user = d.user;
        return api(path, Object.assign({}, opts, { _retry: true }));
      } else {
        store.clear();
        if (!location.pathname.endsWith('/login')) location.href = '/portal/login';
        throw new Error('Sessão expirada');
      }
    }
    const text = await res.text();
    let data; try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    if (!res.ok) {
      const err = new Error((data && data.error) || res.statusText || 'Erro na requisição');
      err.status = res.status; err.code = (data && data.code) || null; err.payload = data;
      throw err;
    }
    return data;
  }

  const toast = {
    stack: null,
    ensure() { if (!this.stack) { this.stack = document.createElement('div'); this.stack.className = 'er-toast-stack'; document.body.appendChild(this.stack); } return this.stack; },
    show(msg, kind = 'info', ms = 3500) {
      this.ensure();
      const el = document.createElement('div');
      el.className = 'er-toast ' + kind;
      el.textContent = msg;
      this.stack.appendChild(el);
      setTimeout(() => el.remove(), ms);
    },
    success(m) { this.show(m, 'success'); },
    error(m)   { this.show(m, 'error', 5000); },
    info(m)    { this.show(m, 'info'); },
  };

  const theme = {
    apply(t) {
      document.documentElement.setAttribute('data-theme', t);
      localStorage.setItem(THEME_KEY, t);
    },
    toggle() { this.apply(this.current() === 'dark' ? 'light' : 'dark'); },
    current() { return document.documentElement.getAttribute('data-theme') || 'dark'; },
    init() {
      const saved = localStorage.getItem(THEME_KEY);
      this.apply(saved || (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'));
    },
  };
  theme.init();

  // WebSocket com auto-reconnect + auth
  const ws = {
    conn: null, listeners: {}, reconnectMs: 2000, url: null,
    connect(url) {
      this.url = url || this.url;
      if (!this.url || !store.token) return;
      try { this.conn = new WebSocket(this.url); } catch { return; }
      this.conn.onopen = () => {
        this.reconnectMs = 2000;
        this.conn.send(JSON.stringify({ type: 'auth', token: store.token }));
      };
      this.conn.onmessage = (e) => {
        try {
          const m = JSON.parse(e.data);
          if (m.type === 'event' && this.listeners[m.event]) {
            this.listeners[m.event].forEach((f) => f(m.data));
          }
        } catch {}
      };
      this.conn.onclose = () => {
        setTimeout(() => this.connect(), this.reconnectMs);
        this.reconnectMs = Math.min(this.reconnectMs * 1.5, 30000);
      };
    },
    on(event, fn) { (this.listeners[event] = this.listeners[event] || []).push(fn); },
  };

  // Auth helpers
  const auth = {
    async login(email, password) {
      const d = await api('/auth/login', { method: 'POST', body: { email, password } });
      store.token = d.token; store.refresh = d.refresh; store.user = d.user;
      return d.user;
    },
    async register(payload) {
      const d = await api('/auth/register', { method: 'POST', body: payload });
      store.token = d.token; store.refresh = d.refresh; store.user = d.user;
      return d.user;
    },
    async logout() {
      try { await api('/auth/logout', { method: 'POST', body: { refresh: store.refresh } }); } catch {}
      store.clear(); location.href = '/portal/login';
    },
    require(roles) {
      const u = store.user;
      if (!u || !store.token) { location.href = '/portal/login'; return null; }
      if (roles && roles.length && !roles.includes(u.role)) {
        toast.error('Você não tem acesso a este portal.');
        location.href = '/portal/login';
        return null;
      }
      return u;
    },
  };

  // Format helpers
  const fmt = {
    brl(n)   { return (Number(n) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }); },
    dt(s)    { return s ? new Date(s.replace(' ', 'T')).toLocaleString('pt-BR') : '—'; },
    dtRel(s) {
      if (!s) return '—';
      const d = new Date(s.replace(' ', 'T'));
      const diff = (Date.now() - d.getTime()) / 1000;
      if (diff < 60) return 'agora';
      if (diff < 3600) return Math.floor(diff / 60) + ' min';
      if (diff < 86400) return Math.floor(diff / 3600) + ' h';
      return Math.floor(diff / 86400) + ' d';
    },
    phone(v) { return (v || '').replace(/(\d{2})(\d{5})(\d{4})/, '($1) $2-$3'); },
    doc(v) {
      v = (v || '').replace(/\D/g, '');
      if (v.length === 11) return v.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
      if (v.length === 14) return v.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5');
      return v;
    },
    cep(v) { return (v || '').replace(/(\d{5})(\d{3})/, '$1-$2'); },
  };

  const badgeForStatus = {
    draft:      { cls: 'er-badge-neutral', label: 'Rascunho' },
    published:  { cls: 'er-badge-info',    label: 'Publicado' },
    matched:    { cls: 'er-badge-info',    label: 'Aguardando aceite' },
    accepted:   { cls: 'er-badge-info',    label: 'Aceita' },
    en_route:   { cls: 'er-badge-warn',    label: 'A caminho' },
    checked_in: { cls: 'er-badge-warn',    label: 'No local' },
    in_progress:{ cls: 'er-badge-warn',    label: 'Em execução' },
    completed:  { cls: 'er-badge-success', label: 'Concluída' },
    paid_out:   { cls: 'er-badge-success', label: 'Paga' },
    cancelled:  { cls: 'er-badge-danger',  label: 'Cancelada' },
    disputed:   { cls: 'er-badge-danger',  label: 'Em disputa' },
  };

  // Topbar renderer (compartilhado nos 3 portais)
  function renderTopbar(active) {
    const u = store.user;
    if (!u) return '';
    const links = {
      empresa:    '/portal/empresa',
      instalador: '/portal/instalador',
      admin:      '/portal/admin',
    };
    const themeLabel = theme.current() === 'dark' ? 'Escuro' : 'Claro';
    const themeIcon = theme.current() === 'dark'
      ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>'
      : '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M21 12.8A9 9 0 1111.2 3 7 7 0 0021 12.8z"/></svg>';
    return `
      <div class="er-topbar">
        <div class="er-logo">
          <div class="er-logo-mark">ER</div>
          <div>
            <div class="er-logo-name">EU RESOLVO</div>
            <div class="er-logo-slogan">A instalação certa, no profissional certo.</div>
          </div>
        </div>
        <div class="er-flex er-gap-16" style="align-items:center;flex-wrap:wrap">
          <div class="er-dim" style="font-size:12.5px">Olá, <strong>${escapeHtml(u.name)}</strong></div>
          <button class="er-theme-btn" onclick="ER.theme.toggle();location.reload()">${themeIcon}<span>${themeLabel}</span></button>
          <button class="er-btn er-btn-ghost" onclick="ER.auth.logout()">Sair</button>
        </div>
      </div>
    `;
  }

  function escapeHtml(s) {
    return (s == null ? '' : String(s))
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  global.ER = {
    api, store, auth, theme, toast, ws, fmt,
    API_BASE, badgeForStatus, renderTopbar, escapeHtml,
  };
})(window);
