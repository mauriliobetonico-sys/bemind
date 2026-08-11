(() => {
  const $  = (s, r=document) => r.querySelector(s);
  const $$ = (s, r=document) => Array.from(r.querySelectorAll(s));
  const csrf = () => (document.querySelector('meta[name="csrf-token"]')?.content) || '';

  // Máscara de moeda (pt-BR) para inputs [data-money]
  const fmt = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const parseMoney = (v) => {
    const d = String(v).replace(/[^\d]/g, '');
    return d ? parseFloat(d) / 100 : 0;
  };
  const renderMoney = (v) => 'R$ ' + fmt.format(v);

  $$('input[data-money]').forEach(el => {
    const sync = () => el.value = renderMoney(parseMoney(el.value));
    el.addEventListener('input', sync);
    if (!el.value) el.value = renderMoney(parseFloat(el.dataset.default || 0));
    else sync();
  });

  // Chips exclusivos: data-chip-group="key" data-chip-value="v"
  $$('[data-chip-group]').forEach(el => {
    el.addEventListener('click', () => {
      const g = el.dataset.chipGroup;
      $$(`[data-chip-group="${g}"]`).forEach(x => x.classList.toggle('active', x === el));
      const target = document.getElementById('input-' + g);
      if (target) { target.value = el.dataset.chipValue || ''; target.dispatchEvent(new Event('change', {bubbles:true})); }
    });
  });

  // Chips múltiplos: data-chip-multi="key"
  $$('[data-chip-multi]').forEach(el => {
    el.addEventListener('click', () => {
      el.classList.toggle('active');
      const key = el.dataset.chipMulti;
      const values = $$(`[data-chip-multi="${key}"].active`).map(x => x.dataset.chipValue);
      const target = document.getElementById('input-' + key);
      if (target) { target.value = values.join(','); target.dispatchEvent(new Event('change', {bubbles:true})); }
    });
  });

  // Contador + / − no Express
  $$('[data-counter]').forEach(el => {
    const step = parseFloat(el.dataset.step || '50');
    const min  = parseFloat(el.dataset.min  || '50');
    const disp = el.querySelector('.counter-value');
    const inp  = document.getElementById(el.dataset.target);
    const setV = (v) => {
      v = Math.max(min, v);
      if (inp) inp.value = v;
      if (disp) disp.textContent = 'R$ ' + fmt.format(v);
      inp?.dispatchEvent(new Event('change', {bubbles:true}));
    };
    el.querySelector('[data-op="minus"]')?.addEventListener('click', () => setV(parseFloat(inp?.value||min) - step));
    el.querySelector('[data-op="plus"]') ?.addEventListener('click', () => setV(parseFloat(inp?.value||min) + step));
    setV(parseFloat(inp?.value||min));
  });

  // Autosave (debounce 800ms) em <form data-autosave-url="/api/...">
  const autoForm = $('form[data-autosave-url]');
  if (autoForm) {
    let t; const status = $('#autosave-status');
    const send = async () => {
      const fd = new FormData(autoForm);
      status && (status.textContent = 'Salvando…');
      const r = await fetch(autoForm.dataset.autosaveUrl, {
        method: 'POST', body: fd, headers: {'X-CSRF-Token': csrf(), 'Accept': 'application/json'},
      });
      const j = await r.json().catch(() => ({}));
      status && (status.textContent = j.saved_at ? 'Salvo agora' : 'Salvo');
    };
    autoForm.addEventListener('input',  () => { clearTimeout(t); t = setTimeout(send, 800); });
    autoForm.addEventListener('change', () => { clearTimeout(t); t = setTimeout(send, 300); });
  }

  // Copiar link
  $$('[data-copy]').forEach(el => {
    el.addEventListener('click', async (e) => {
      e.preventDefault();
      try { await navigator.clipboard.writeText(el.dataset.copy); el.textContent = 'Copiado ✓'; }
      catch { window.prompt('Copie manualmente:', el.dataset.copy); }
    });
  });

  // Bottom sheet
  window.BM = window.BM || {};
  window.BM.openSheet = (id) => {
    $('#'+id)?.classList.remove('hidden');
    $('#backdrop-'+id)?.classList.remove('hidden');
  };
  window.BM.closeSheet = (id) => {
    $('#'+id)?.classList.add('hidden');
    $('#backdrop-'+id)?.classList.add('hidden');
  };
  $$('[data-open-sheet]').forEach(b => b.addEventListener('click', () => BM.openSheet(b.dataset.openSheet)));
  $$('[data-close-sheet]').forEach(b => b.addEventListener('click', () => BM.closeSheet(b.dataset.closeSheet)));

  // Filtro de status na página de propostas — filtra na cliente
  $$('[data-filter-list]').forEach(chip => {
    chip.addEventListener('click', () => {
      const group = chip.dataset.filterGroup;
      $$(`[data-filter-group="${group}"]`).forEach(x => x.classList.toggle('active', x === chip));
      const value = chip.dataset.filterList;
      const target = document.getElementById('list-' + group);
      if (!target) return;
      $$('.list-item', target).forEach(it => {
        it.classList.toggle('hidden', value !== 'todas' && it.dataset.status !== value);
      });
      const params = new URLSearchParams(window.location.search); params.set('status', value);
      history.replaceState({}, '', window.location.pathname + '?' + params.toString());
    });
  });

  // Aceite: só habilita o botão quando termos marcados
  const terms = $('#accept-terms'); const acceptBtn = $('#accept-btn');
  if (terms && acceptBtn) {
    const upd = () => { acceptBtn.disabled = !terms.checked; };
    terms.addEventListener('change', upd); upd();
  }
})();
