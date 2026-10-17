// Animação do vídeo de boas-vindas Be Mind Marketing.
// Tudo é função pura do tempo: window.render(t) desenha o quadro exato do segundo t,
// o que permite exportar quadro a quadro (scripts/render-frames.mjs) sem perder sincronia.
(() => {
  const TL = window.TIMELINE;
  const S = TL.scenes;            // início de cada cena (s)
  const LOGO = TL.logoForm;       // início da formação do logotipo
  const END = TL.duration;
  const SSL = S[3] + 1.7;         // "configura o certificado SSL"

  // ---------- utilitários ----------
  const $ = (id) => document.getElementById(id);
  const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
  const p = (t, a, b) => clamp((t - a) / (b - a));
  const eo = (x) => 1 - Math.pow(1 - x, 3);
  const eo5 = (x) => 1 - Math.pow(1 - x, 5);
  const eio = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
  const back = (x) => 1 + 2.4 * Math.pow(x - 1, 3) + 1.4 * Math.pow(x - 1, 2);
  const lerp = (a, b, x) => a + (b - a) * x;
  const rng = (seed) => () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let r = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };

  // Aplica opacidade/transformação/desfoque a um elemento.
  function set(el, { o = 1, x = 0, y = 0, s = 1, blur = 0, r = 0 } = {}) {
    el.style.opacity = o;
    el.style.transform = `translate(${x}px, ${y}px) scale(${s})` + (r ? ` rotate(${r}deg)` : "");
    el.style.filter = blur > 0.05 ? `blur(${blur}px)` : "none";
  }
  // Entrada padrão (sobe e desfoca → nítido).
  function rise(el, t, a, d = 0.6, dist = 34) {
    const k = eo(p(t, a, a + d));
    set(el, { o: k, y: (1 - k) * dist, blur: (1 - k) * 8 });
    return k;
  }
  // Envelope de cena: entra deslizando da direita, sai para a esquerda.
  function sceneEnv(t, k) {
    const a = S[k], b = k + 1 < S.length ? S[k + 1] : Infinity;
    const i = k === 0 ? 1 : eo(p(t, a - 0.02, a + 0.6));
    const o = b === Infinity ? 0 : eio(p(t, b - 0.3, b + 0.12));
    return { i, o, vis: i * (1 - o) };
  }
  function applyEnv(el, env) {
    set(el, { o: env.vis, x: (1 - env.i) * 120 - env.o * 120, s: 1 - env.o * 0.03, blur: (1 - env.i) * 10 + env.o * 10 });
    el.style.visibility = env.vis <= 0.001 ? "hidden" : "visible";
  }

  // ---------- fundo ----------
  const bg = $("bg").getContext("2d");
  const dust = Array.from({ length: 46 }, (_, i) => { const r = rng(100 + i); return [r() * 1920, r() * 1080, 0.6 + r() * 1.6, r() * 6.28, 0.2 + r() * 0.5]; });
  function camPan(t) {
    let x = t * 14;
    for (let k = 1; k < S.length; k++) x += eio(p(t, S[k] - 0.25, S[k] + 0.7)) * 300;
    return x;
  }
  function drawBg(t) {
    const g = bg.createLinearGradient(0, 0, 0, 1080);
    g.addColorStop(0, "#070a12"); g.addColorStop(1, "#0b111c");
    bg.fillStyle = g; bg.fillRect(0, 0, 1920, 1080);
    const cam = camPan(t);
    // brilhos ambientes que acompanham a jornada
    const glow = (x, y, r, c) => { const rg = bg.createRadialGradient(x, y, 0, x, y, r); rg.addColorStop(0, c); rg.addColorStop(1, "rgba(0,0,0,0)"); bg.fillStyle = rg; bg.fillRect(0, 0, 1920, 1080); };
    glow(1350 + Math.sin(t * 0.35) * 140, 380 + Math.cos(t * 0.27) * 60, 820, "rgba(253,112,98,0.13)");
    glow(420 + Math.cos(t * 0.3) * 120, 820, 760, "rgba(70,110,200,0.10)");
    // piso em perspectiva
    const hor = 640, f = 560, h = 380;
    bg.lineWidth = 1;
    const off = cam % 140;
    for (let i = -30; i <= 30; i++) {
      const xw = i * 140 - off;
      const z0 = 260, z1 = 7000;
      const a = 0.09 * (1 - Math.min(Math.abs(xw) / 4200, 1));
      bg.strokeStyle = `rgba(150,170,210,${a})`;
      bg.beginPath(); bg.moveTo(960 + (xw * f) / z0, hor + (h * f) / z0); bg.lineTo(960 + (xw * f) / z1, hor + (h * f) / z1); bg.stroke();
    }
    const zoff = (t * 160) % 260;
    for (let j = 0; j < 26; j++) {
      const z = 260 + j * 260 - zoff;
      if (z < 200) continue;
      const y = hor + (h * f) / z;
      const a = 0.11 * Math.min(1, (y - hor) / 160);
      bg.strokeStyle = `rgba(150,170,210,${a})`;
      bg.beginPath(); bg.moveTo(0, y); bg.lineTo(1920, y); bg.stroke();
    }
    // horizonte: brilho suave
    const hg = bg.createLinearGradient(0, hor - 120, 0, hor + 60);
    hg.addColorStop(0, "rgba(7,10,18,0)"); hg.addColorStop(0.75, "rgba(253,112,98,0.05)"); hg.addColorStop(1, "rgba(7,10,18,0)");
    bg.fillStyle = hg; bg.fillRect(0, hor - 120, 1920, 180);
    // poeira digital discreta
    for (const [x, y, sz, ph, sp] of dust) {
      const xx = ((x - cam * sp * 0.6) % 1920 + 1920) % 1920;
      const a = 0.12 + 0.12 * Math.sin(t * 1.3 + ph);
      bg.fillStyle = `rgba(220,230,255,${a})`;
      bg.beginPath(); bg.arc(xx, y + Math.sin(t * 0.4 + ph) * 10, sz, 0, 6.283); bg.fill();
    }
    // vinheta
    const v = bg.createRadialGradient(960, 540, 500, 960, 540, 1250);
    v.addColorStop(0, "rgba(0,0,0,0)"); v.addColorStop(1, "rgba(0,0,0,0.55)");
    bg.fillStyle = v; bg.fillRect(0, 0, 1920, 1080);
  }

  // ---------- cena 1: domínio + rede ----------
  const NS = "http://www.w3.org/2000/svg";
  const svgEl = (tag, attrs, parent) => { const e = document.createElementNS(NS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); parent && parent.appendChild(e); return e; };
  const net = $("net");
  const defs = svgEl("defs", {}, net);
  const lg = svgEl("linearGradient", { id: "lg", x1: 0, x2: 1 }, defs);
  svgEl("stop", { offset: 0, "stop-color": "#fd7062", "stop-opacity": 0.9 }, lg);
  svgEl("stop", { offset: 1, "stop-color": "#ffb3aa", "stop-opacity": 0.5 }, lg);
  const glowF = svgEl("filter", { id: "glow", x: "-50%", y: "-50%", width: "200%", height: "200%" }, defs);
  svgEl("feGaussianBlur", { stdDeviation: 4, result: "b" }, glowF);
  const mg = svgEl("feMerge", {}, glowF); svgEl("feMergeNode", { in: "b" }, mg); svgEl("feMergeNode", { in: "SourceGraphic" }, mg);

  const nodes = [[150, 250], [260, 480], [130, 720], [360, 870], [1770, 250], [1660, 480], [1790, 720], [1560, 870]];
  const links = nodes.map(([nx, ny], i) => {
    const left = i < 4, sx = left ? 560 : 1360, sy = 600;
    const c1 = left ? sx - 160 : sx + 160;
    const d = `M${sx} ${sy} C ${c1} ${sy}, ${(c1 + nx) / 2} ${ny}, ${nx} ${ny}`;
    const path = svgEl("path", { d, fill: "none", stroke: "url(#lg)", "stroke-width": 2, filter: "url(#glow)" }, net);
    return { path, len: path.getTotalLength(), i };
  });
  const mesh = [[0, 1], [1, 2], [2, 3], [4, 5], [5, 6], [6, 7], [0, 4], [3, 7]].map(([a, b]) => {
    const [ax, ay] = nodes[a], [bx, by] = nodes[b];
    const d = a === 0 && b === 4 ? `M${ax} ${ay} Q 960 90 ${bx} ${by}` : a === 3 && b === 7 ? `M${ax} ${ay} Q 960 960 ${bx} ${by}` : `M${ax} ${ay} L ${bx} ${by}`;
    const path = svgEl("path", { d, fill: "none", stroke: "rgba(160,180,220,.22)", "stroke-width": 1.2 }, net);
    return { path, len: path.getTotalLength() };
  });
  const nodeEls = nodes.map(([x, y]) => {
    const g = svgEl("g", { transform: `translate(${x} ${y})` }, net);
    const halo = svgEl("circle", { r: 18, fill: "rgba(253,112,98,.15)" }, g);
    const dot = svgEl("circle", { r: 6.5, fill: "#fd7062", filter: "url(#glow)" }, g);
    return { g, halo, dot };
  });
  const pulses = links.map(() => svgEl("circle", { r: 4.5, fill: "#fff", filter: "url(#glow)" }, net));
  const DOMAIN = "www.seunegocio.com.br";

  function scene1(t) {
    const env = sceneEnv(t, 0);
    applyEnv($("s1"), env);
    if (env.vis <= 0) return;
    // domínio digitado
    const pk = eo(p(t, 0.05, 0.6));
    set($("s1-pill"), { o: pk, s: 0.92 + 0.08 * pk, blur: (1 - pk) * 10 });
    const n = Math.floor(clamp((t - 0.35) / 0.9) * DOMAIN.length);
    $("s1-domain").textContent = DOMAIN.slice(0, n);
    $("s1-caret").style.opacity = t < 1.4 ? 1 : (Math.floor(t * 2.2) % 2 ? 0 : 1);
    const rk = back(p(t, 1.35, 1.75));
    set($("s1-reg"), { o: clamp(rk), s: 0.6 + 0.4 * rk });
    rise($("s1-title"), t, 1.0, 0.8, 40);
    // linhas luminosas conectando o domínio à rede
    links.forEach(({ path, len, i }, j) => {
      const k = eio(p(t, 1.6 + (i % 4) * 0.12, 2.6 + (i % 4) * 0.12));
      path.style.strokeDasharray = len; path.style.strokeDashoffset = len * (1 - k);
      const ne = nodeEls[i], nk = back(p(t, 2.45 + (i % 4) * 0.12, 2.85 + (i % 4) * 0.12));
      ne.g.style.opacity = clamp(nk);
      ne.halo.setAttribute("r", 10 + 10 * clamp(nk) + 4 * Math.sin(t * 4 + i));
      const ph = (t - 2.6 - j * 0.13) / 1.1;
      if (ph > 0) {
        const pt = path.getPointAtLength(len * (ph % 1));
        pulses[j].setAttribute("cx", pt.x); pulses[j].setAttribute("cy", pt.y);
        pulses[j].style.opacity = Math.sin(Math.PI * (ph % 1));
      } else pulses[j].style.opacity = 0;
    });
    mesh.forEach(({ path, len }, i) => {
      const k = eio(p(t, 2.8 + i * 0.08, 3.6 + i * 0.08));
      path.style.strokeDasharray = len; path.style.strokeDashoffset = len * (1 - k);
    });
  }

  // ---------- cena 2: DNS ----------
  function scene2(t) {
    const env = sceneEnv(t, 1);
    applyEnv($("s2"), env);
    if (env.vis <= 0) return;
    const u = t - S[1];
    rise($("s2-lead"), u, 0.35, 0.6);
    const pk = eo(p(u, 0.05, 0.75));
    set($("dns"), { o: pk, y: (1 - pk) * 50, s: 0.96 + 0.04 * pk });
    [["r1", 0.75], ["r2", 1.05]].forEach(([id, a]) => {
      const row = $(id), ko = eio(p(u, a, a + 0.35)), kn = eo(p(u, a + 0.15, a + 0.6));
      set(row.querySelector(".old"), { o: 1 - ko, x: -60 * ko, blur: ko * 6 });
      set(row.querySelector(".new"), { o: kn, x: 60 * (1 - kn), blur: (1 - kn) * 6 });
      row.classList.toggle("hl", u > a && u < a + 1.4);
    });
    const done = u >= 3.0;
    const bk = eio(p(u, 1.45, 3.0));
    $("dns-bar").style.width = `${bk * 100}%`;
    const sk = eo(p(u, 1.35, 1.7));
    set($("dns-status"), { o: sk, y: (1 - sk) * 20 });
    $("dns-spin").style.transform = `rotate(${u * 420}deg)`;
    $("dns-spin").style.opacity = done ? 0 : 1;
    const ok = back(p(u, 3.0, 3.35));
    set($("dns-ok"), { o: clamp(ok * 2), s: ok });
    const sw = eo(p(u, 2.95, 3.3));
    set($("st-a"), { o: 1 - sw, y: -16 * sw });
    set($("st-b"), { o: sw, y: 16 * (1 - sw) });
  }

  // ---------- cena 3: Cloud próprio ----------
  const cw = $("cloudworld");
  const cdefs = svgEl("defs", {}, cw);
  const mkGrad = (id, a, b, x2 = 0, y2 = 1) => { const g = svgEl("linearGradient", { id, x1: 0, y1: 0, x2, y2 }, cdefs); svgEl("stop", { offset: 0, "stop-color": a }, g); svgEl("stop", { offset: 1, "stop-color": b }, g); };
  mkGrad("top", "#2b3650", "#1c2537", 1, 1);
  mkGrad("lf", "#161d2b", "#0f1520");
  mkGrad("rf", "#1d2638", "#121927");
  mkGrad("cg", "rgba(253,112,98,.28)", "rgba(253,112,98,.04)");
  const cf = svgEl("filter", { id: "cglow", x: "-50%", y: "-50%", width: "200%", height: "200%" }, cdefs);
  svgEl("feGaussianBlur", { stdDeviation: 7, result: "b" }, cf);
  const cm = svgEl("feMerge", {}, cf); svgEl("feMergeNode", { in: "b" }, cm); svgEl("feMergeNode", { in: "SourceGraphic" }, cm);

  // Instância isométrica (centro do topo cx,cy; largura w; altura h)
  function isoBox(parent, cx, cy, w, h, opts = {}) {
    const g = svgEl("g", {}, parent), hw = w / 2, hh = w / 4;
    const T = [cx, cy - hh], R = [cx + hw, cy], B = [cx, cy + hh], L = [cx - hw, cy];
    const pt = (a) => a.join(" ");
    const down = (a) => [a[0], a[1] + h];
    const ring = svgEl("g", {}, g);
    const f = 1.55, bcy = cy + h + 8;
    const bound = svgEl("path", { d: `M${cx} ${bcy - hh * f} L${cx + hw * f} ${bcy} L${cx} ${bcy + hh * f} L${cx - hw * f} ${bcy} Z`, fill: "rgba(253,112,98,.05)", stroke: "#fd7062", "stroke-width": opts.small ? 1.5 : 2, "stroke-dasharray": opts.small ? "6 8" : "10 10", opacity: 0.8 }, ring);
    svgEl("path", { d: `M${pt(L)} L${pt(B)} L${pt(down(B))} L${pt(down(L))} Z`, fill: "url(#lf)", stroke: "rgba(255,255,255,.08)" }, g);
    svgEl("path", { d: `M${pt(B)} L${pt(R)} L${pt(down(R))} L${pt(down(B))} Z`, fill: "url(#rf)", stroke: "rgba(255,255,255,.08)" }, g);
    const top = svgEl("path", { d: `M${pt(T)} L${pt(R)} L${pt(B)} L${pt(L)} Z`, fill: "url(#top)", stroke: "rgba(253,112,98,.65)", "stroke-width": 1.5 }, g);
    const leds = [];
    for (let i = 0; i < 3; i++) {
      const yo = h * (0.25 + i * 0.25);
      const a = [B[0] + hw * 0.12, B[1] - hh * 0.12 + yo], b = [B[0] + hw * 0.62, B[1] - hh * 0.62 + yo];
      svgEl("line", { x1: a[0], y1: a[1], x2: b[0], y2: b[1], stroke: "rgba(255,255,255,.12)", "stroke-width": opts.small ? 2 : 5, "stroke-linecap": "round" }, g);
      leds.push(svgEl("circle", { cx: B[0] + hw * 0.8, cy: B[1] - hh * 0.8 + yo, r: opts.small ? 2 : 4.5, fill: "#fd7062", filter: "url(#cglow)" }, g));
    }
    return { g, ring, bound, top, leds, len: bound.getTotalLength() };
  }
  const others = [isoBox(cw, 960, 640, 130, 52, { small: true }), isoBox(cw, 1790, 600, 130, 52, { small: true })];
  const box = isoBox(cw, 1320, 690, 340, 130);
  const beam = svgEl("rect", { x: 1300, y: 548, width: 40, height: 60, fill: "url(#cg)" }, cw);
  const envLabel = svgEl("g", {}, cw);
  svgEl("rect", { x: 1520, y: 836, width: 268, height: 46, rx: 23, fill: "rgba(16,22,34,.9)", stroke: "rgba(253,112,98,.6)" }, envLabel);
  const lt = svgEl("text", { x: 1654, y: 866, "text-anchor": "middle", fill: "#f4f6fa", "font-size": 20, "font-weight": 600, "font-family": "Inter" }, envLabel);
  lt.textContent = "Ambiente dedicado";
  const cloud = svgEl("g", {}, cw);
  const cloudPath = svgEl("path", { d: "M-150 70 H150 A85 85 0 0 0 128 -96 A120 120 0 0 0 -70 -120 A100 100 0 0 0 -175 -10 A80 80 0 0 0 -150 70 Z", fill: "url(#cg)", stroke: "#fd7062", "stroke-width": 3.5, filter: "url(#cglow)" }, cloud);
  const cloudLen = cloudPath.getTotalLength();

  function scene3(t) {
    const env = sceneEnv(t, 2);
    applyEnv($("s3"), env);
    if (env.vis <= 0) return;
    const u = t - S[2];
    const h = $("s3-h");
    rise(h.querySelector(".l1"), u, 0.0, 0.6);
    rise(h.querySelector(".l2"), u, 0.25, 0.6);
    h.querySelector(".l2").style.color = "#fd7062";
    rise($("s3-sub"), u, 0.7, 0.6);
    // nuvem desenhada → se condensa em uma instância
    const ck = eio(p(u, 0.1, 1.0)), cs = eio(p(u, 1.2, 1.9));
    cloudPath.style.strokeDasharray = cloudLen; cloudPath.style.strokeDashoffset = cloudLen * (1 - ck);
    cloudPath.style.fillOpacity = ck;
    const cy = lerp(430, 690, cs), sc = lerp(1.25, 0.35, cs);
    cloud.setAttribute("transform", `translate(1320 ${cy}) scale(${sc})`);
    cloud.style.opacity = 1 - p(u, 1.6, 1.95);
    const bk = back(p(u, 1.45, 2.05));
    box.g.style.opacity = clamp(bk * 1.5);
    box.g.style.transformOrigin = "1320px 760px";
    box.g.style.transform = `translateY(${(1 - clamp(bk)) * 40}px) scale(${0.7 + 0.3 * bk})`;
    box.leds.forEach((l, i) => (l.style.opacity = 0.35 + 0.65 * (Math.sin(u * 7 + i * 2.1) > 0.2 ? 1 : 0)));
    const rk = eio(p(u, 1.9, 2.6));
    box.bound.style.strokeDashoffset = 0;
    box.ring.style.opacity = rk;
    box.ring.style.transformOrigin = "1320px 830px";
    box.ring.style.transform = `scale(${0.85 + 0.15 * rk})`;
    set(envLabel, { o: eo(p(u, 2.3, 2.8)), x: (1 - eo(p(u, 2.3, 2.8))) * 20 });
    others.forEach((o, i) => {
      const k = eo(p(u, 2.3 + i * 0.15, 2.9 + i * 0.15));
      o.g.style.opacity = 0.32 * k; o.ring.style.opacity = 0.32 * k;
      o.leds.forEach((l, j) => (l.style.opacity = Math.sin(u * 5 + j + i) > 0 ? 1 : 0.3));
    });
    // site começa a ser construído dentro do ambiente
    const wk = eo(p(u, 2.4, 3.0));
    set($("s3-browser"), { o: wk, y: (1 - wk) * 60, s: 0.85 + 0.15 * wk });
    beam.style.opacity = wk * (0.7 + 0.3 * Math.sin(u * 6));
    $("s3-browser").querySelectorAll(".w").forEach((w, i) => {
      const k = eo(p(u, 2.9 + i * 0.2, 3.3 + i * 0.2));
      set(w, { o: k, y: (1 - k) * 12, s: 0.96 + 0.04 * k });
    });
  }

  // ---------- site do cliente (cenas 4 e 5) ----------
  const SITE = `
    <div class="s-nav"><div class="brand"><i></i>Seu Negócio</div><div class="menu"><span>Início</span><span>Serviços</span><span>Contato</span></div></div>
    <div class="hero"><div class="h-text"><h3>Seu negócio,<br>agora online.</h3><div class="h-sub"><p>Produtos, serviços e contato<br>em um só lugar.</p><span class="cta">Fale conosco</span></div></div><div class="h-img"></div></div>
    <div class="cards"><div class="card"><i></i><b></b><b></b></div><div class="card"><i></i><b></b><b></b></div><div class="card"><i></i><b></b><b></b></div></div>`;
  ["site4", "site5", "site5m"].forEach((id) => ($(id).innerHTML = SITE));
  const parts4 = [".s-nav", "h3", ".h-sub", ".h-img", ".cards"].map((q) => $("site4").querySelector(q));

  const CODE = [
    [["t", "<nav"], ["a", " class="], ["s", '"menu"'], ["t", ">"], ["x", "…"], ["t", "</nav>"]],
    [["t", "<section"], ["a", " class="], ["s", '"hero"'], ["t", ">"]],
    [["x", "  "], ["t", "<h1>"], ["x", "Seu negócio, agora online."], ["t", "</h1>"]],
    [["x", "  "], ["t", "<a"], ["a", " class="], ["s", '"btn"'], ["t", ">"], ["x", "Fale conosco"], ["t", "</a>"]],
    [["x", "  "], ["t", "<img"], ["a", " src="], ["s", '"destaque.webp"'], ["t", ">"]],
    [["t", "</section>"]],
    [["t", "<div"], ["a", " class="], ["s", '"cards"'], ["t", ">"], ["x", "…"], ["t", "</div>"]],
  ];
  const codeEl = $("code");
  const codeLines = CODE.map((segs, i) => {
    const ln = document.createElement("span"); ln.className = "ln";
    ln.innerHTML = `<span class="n">${i + 1}</span>`;
    const spans = segs.map(([c, txt]) => { const s = document.createElement("span"); s.className = c; s.dataset.full = txt; ln.appendChild(s); return s; });
    codeEl.appendChild(ln);
    return spans;
  });
  const codeLen = CODE.map((l) => l.reduce((n, [, s]) => n + s.length, 0));
  const codeTotal = codeLen.reduce((a, b) => a + b, 0);
  const lineToPart = { 0: 0, 2: 1, 3: 2, 4: 3, 6: 4 };

  function scene4(t) {
    const env = sceneEnv(t, 3);
    applyEnv($("s4"), env);
    if (env.vis <= 0) return;
    const u = t - S[3], us = t - SSL;
    rise($("st2"), u, 0.05, 0.6);
    rise($("st3"), us, -0.1, 0.6);
    const ck = eo(p(us, -0.1, 0.4));
    $("st2").querySelector(".okico").style.width = `${40 * ck}px`;
    $("st2").style.opacity = 1 - 0.45 * ck;
    const ek = eo(p(u, 0.1, 0.6));
    set(codeEl, { o: ek * (1 - 0.5 * eo(p(us, 0.1, 0.6))), y: (1 - ek) * 40 });
    // digitação do código
    let chars = Math.floor(clamp((u - 0.25) / 1.35) * codeTotal);
    codeLines.forEach((spans, i) => {
      let left = Math.max(0, Math.min(chars, codeLen[i]));
      chars -= codeLen[i];
      spans.forEach((s) => { const n = Math.min(left, s.dataset.full.length); s.textContent = s.dataset.full.slice(0, n); left -= n; });
      if (i in lineToPart) {
        const doneAt = 0.25 + (1.35 * codeLen.slice(0, i + 1).reduce((a, b) => a + b, 0)) / codeTotal;
        const k = eo(p(u, doneAt - 0.05, doneAt + 0.4));
        set(parts4[lineToPart[i]], { o: k, y: (1 - k) * 24, s: 0.97 + 0.03 * k });
      }
    });
    const bk = eo(p(u, 0.0, 0.6));
    set($("s4-browser"), { o: bk, x: (1 - bk) * 80 });
    // cadeado SSL
    const lk = back(p(us, 0.15, 0.55)), fly = eio(p(us, 1.2, 1.7));
    const closed = eo(p(us, 0.45, 0.7));
    $("big-shackle").setAttribute("transform", `translate(0 ${-3.2 * (1 - closed)})`);
    set($("bigLock"), { o: clamp(lk * 1.4) * (1 - p(us, 1.55, 1.75)), s: (0.6 + 0.4 * lk) * lerp(1, 0.2, fly), x: -320 * fly, y: -330 * fly });
    [["ring1", 0.65], ["ring2", 0.85]].forEach(([id, a]) => { const k = p(us, a, a + 0.7); set($(id), { o: (1 - k) * (k > 0 ? 1 : 0), s: 1 + k * 1.2 }); });
    const secure = us >= 1.62;
    $("proto").textContent = secure ? "https://" : "http://";
    $("proto").style.color = secure ? "#dfe4ee" : "#7d879a";
    $("url-lock").classList.toggle("on", secure);
    $("url-shackle").setAttribute("transform", `translate(0 ${secure ? 0 : -3})`);
    const sk = eo(p(us, 1.65, 2.05));
    set($("secure"), { o: sk, x: (1 - sk) * 20 });
  }

  // ---------- cena 5: publicação + suporte ----------
  function scene5(t) {
    const env = sceneEnv(t, 4);
    applyEnv($("s5"), env);
    if (env.vis <= 0) return;
    const u = t - S[4];
    const out = eio(p(u, 2.55, 3.0));
    const ck = eo(p(u, 0.0, 0.55));
    set($("checklist"), { o: ck * (1 - out), y: (1 - ck) * 40, s: 1 - 0.08 * out, x: -160 * out, blur: out * 8 });
    [["ck1", 0.55], ["ck2", 1.35]].forEach(([id, a]) => {
      const k = back(p(u, a, a + 0.35)), box = $(id).querySelector(".box");
      box.style.background = u > a ? "#fd7062" : "transparent";
      box.style.borderColor = u > a ? "#fd7062" : "#3b465c";
      set(box.querySelector("svg"), { o: clamp(k), s: k });
    });
    const CLICK = 2.2;
    const mv = eio(p(u, 1.55, 2.1));
    const press = u > CLICK && u < CLICK + 0.12 ? 0.85 : 1;
    set($("cursor"), { o: eo(p(u, 1.5, 1.7)) * (1 - out), x: lerp(1560, 1010, mv), y: lerp(930, 590, mv), s: press });
    const pb = $("publish");
    pb.style.transform = `scale(${u > CLICK && u < CLICK + 0.15 ? 0.97 : 1})`;
    const rp = p(u, CLICK, CLICK + 0.6);
    set($("ripple"), { o: rp > 0 ? 1 - rp : 0, s: 1 + rp * 18 });
    const sw = eo(p(u, CLICK + 0.05, CLICK + 0.3));
    set($("pub-a"), { o: 1 - sw, y: -20 * sw });
    set($("pub-b"), { o: sw, y: 20 * (1 - sw) });
    // dispositivos com o site no ar
    const lk = eo(p(u, 2.7, 3.35)), pk = eo(p(u, 2.9, 3.5));
    set($("laptop"), { o: lk, y: (1 - lk) * 70, s: 0.94 + 0.06 * lk });
    set($("phone"), { o: pk, y: (1 - pk) * 110 });
    const ok = back(p(u, 3.25, 3.6));
    set($("online"), { o: clamp(ok * 1.5), s: 0.7 + 0.3 * ok });
    $("online").querySelector("i").style.opacity = 0.6 + 0.4 * Math.sin(u * 6);
    rise($("s5-h"), u, 2.65, 0.7, 40);
    rise($("support"), u, 3.35, 0.6, 30);
  }

  // ---------- cena 6: oferta + logotipo ----------
  const ringEls = [...$("rings").children];
  function scene6(t) {
    const env = sceneEnv(t, 5);
    applyEnv($("s6"), env);
    if (env.vis <= 0) return;
    const u = t - S[5], ex = eio(p(t, LOGO - 0.05, LOGO + 0.45));
    ringEls.forEach((r, i) => {
      const d = 760 + i * 330, k = eo(p(u, 0.0 + i * 0.12, 0.9 + i * 0.12));
      r.style.width = r.style.height = `${d}px`;
      r.style.left = r.style.top = `${-d / 2}px`;
      r.style.opacity = k * (0.9 - i * 0.22);
      r.style.transform = `rotateX(74deg) rotateZ(${u * (12 - i * 4)}deg) scale(${0.8 + 0.2 * k})`;
    });
    const off = $("offer");
    set(off, { o: 1 - ex, s: 1 - 0.06 * ex, blur: ex * 10 });
    rise(off.querySelector(".eyebrow"), u, 0.1, 0.6, 24);
    const pk = eo5(p(u, 0.25, 1.0));
    set(off.querySelector(".price"), { o: pk, s: 1.12 - 0.12 * pk, blur: (1 - pk) * 14 });
    rise(off.querySelector(".incl"), u, 0.75, 0.6, 30);
  }

  // Partículas que formam o logotipo
  const pc = $("particles").getContext("2d");
  const LW = 520, LH = 474, LX = 700, LY = 176;
  let parts = [];
  function buildParticles() {
    const c = document.createElement("canvas"); c.width = LW; c.height = LH;
    const x = c.getContext("2d"); x.drawImage($("logoImg"), 0, 0, LW, LH);
    const d = x.getImageData(0, 0, LW, LH).data, r = rng(7), STEP = 5;
    for (let yy = 0; yy < LH; yy += STEP) for (let xx = 0; xx < LW; xx += STEP) {
      const i = (yy * LW + xx) * 4;
      if (d[i + 3] < 140) continue;
      const ang = r() * Math.PI * 2, rad = 380 + r() * 820;
      parts.push({
        tx: LX + xx, ty: LY + yy,
        sx: 960 + Math.cos(ang) * rad, sy: 470 + Math.sin(ang) * rad * 0.62,
        c: `rgb(${d[i]},${d[i + 1]},${d[i + 2]})`,
        delay: 0.42 * r() + 0.3 * (xx / LW), curl: (r() - 0.5) * 260, sz: 1.5 + r() * 1.5,
      });
    }
  }
  function drawParticles(t) {
    pc.clearRect(0, 0, 1920, 1080);
    const u = t - LOGO - 0.1;
    const fadeOut = 1 - p(t, LOGO + 1.5, LOGO + 1.85);
    if (u < 0 || fadeOut <= 0) return;
    for (const q of parts) {
      const k = eio(p(u, q.delay, q.delay + 0.95));
      if (u < q.delay) continue;
      const bend = Math.sin(k * Math.PI) * q.curl;
      const x = lerp(q.sx, q.tx, k) + bend * 0.5, y = lerp(q.sy, q.ty, k) - bend * 0.3;
      const sz = lerp(q.sz, 4.6, k);
      pc.globalAlpha = clamp((u - q.delay) / 0.15) * fadeOut;
      pc.fillStyle = q.c;
      pc.fillRect(x - sz / 2, y - sz / 2, sz, sz);
    }
    pc.globalAlpha = 1;
  }
  function endcard(t) {
    const r = eio(p(t, LOGO, LOGO + 0.75)) * 1300;
    $("light").style.clipPath = `circle(${r}px at 50% 50%)`;
    drawParticles(t);
    const lk = eo(p(t, LOGO + 1.45, LOGO + 1.9));
    set($("logoWrap"), { o: lk, s: 0.985 + 0.015 * lk });
    const sh = eio(p(t, LOGO + 1.95, LOGO + 2.75));
    $("shine").style.backgroundPosition = `${lerp(110, -10, sh)}% 0`;
    $("shine").style.opacity = sh > 0 && sh < 1 ? 1 : 0;
    rise($("tagline"), t, LOGO + 1.85, 0.7, 26);
    const ok = eo(p(t, LOGO + 2.25, LOGO + 2.9));
    $("endoffer").style.opacity = ok;
    $("endoffer").style.transform = `translate(-50%, ${(1 - ok) * 20}px)`;
  }

  // ---------- elementos persistentes ----------
  const STEPS = ["Domínio", "DNS", "Cloud", "Desenvolvimento", "SSL", "Publicação"];
  const STEP_AT = [0, S[1], S[2], S[3], SSL, S[4]];
  const rail = $("rail");
  const railEls = STEPS.map((name, i) => {
    if (i) { const seg = document.createElement("div"); seg.className = "seg"; seg.innerHTML = "<i></i>"; rail.appendChild(seg); }
    const st = document.createElement("div"); st.className = "st"; st.innerHTML = `<span class="dot"></span>${name}`;
    rail.appendChild(st);
    return { st, seg: rail.querySelectorAll(".seg")[i - 1] };
  });
  function persistent(t) {
    const rk = eo(p(t, 1.1, 1.7)) * (1 - eio(p(t, S[5] - 0.2, S[5] + 0.3)));
    rail.style.opacity = rk;
    rail.style.transform = `translate(-50%, ${(1 - eo(p(t, 1.1, 1.7))) * -16}px)`;
    railEls.forEach(({ st, seg }, i) => {
      const active = t >= STEP_AT[i] && (i === STEPS.length - 1 || t < STEP_AT[i + 1]);
      const done = i < STEPS.length - 1 && t >= STEP_AT[i + 1];
      st.style.color = active ? "#f4f6fa" : done ? "#a3aec2" : "#5d677a";
      const dot = st.firstChild;
      dot.style.background = active || done ? "#fd7062" : "transparent";
      dot.style.borderColor = active || done ? "#fd7062" : "#4a5468";
      dot.style.boxShadow = active ? `0 0 0 ${4 + 2 * Math.sin(t * 5)}px rgba(253,112,98,.25), 0 0 14px #fd7062` : "none";
      if (seg) seg.firstChild.style.transform = `scaleX(${eio(p(t, STEP_AT[i] - 0.35, STEP_AT[i] + 0.15))})`;
    });
    // logotipo em selo branco no canto
    const bk = back(p(t, 0.7, 1.3)), bo = 1 - eio(p(t, LOGO, LOGO + 0.35));
    const b = $("badge");
    b.style.opacity = clamp(eo(p(t, 0.7, 1.1))) * bo;
    b.style.transform = `translate(48px, 30px) scale(${0.26 * (0.7 + 0.3 * bk)})`;
    b.style.filter = t < 1.1 ? `blur(${(1 - eo(p(t, 0.7, 1.1))) * 6}px)` : "none";
    // legendas
    const caps = TL.captions;
    let txt = "", o = 0;
    for (let i = 0; i < caps.length; i++) {
      const c = caps[i], prev = caps[i - 1], next = caps[i + 1];
      if (t >= c.start - 0.08 && t < c.end) {
        txt = c.text;
        const fi = prev && c.start - prev.end < 0.05 ? 1 : p(t, c.start - 0.08, c.start + 0.08);
        const fo = next && next.start - c.end < 0.05 ? 1 : 1 - p(t, c.end - 0.15, c.end);
        o = Math.min(fi, fo);
        break;
      }
    }
    $("captext").textContent = txt;
    $("caption").style.opacity = txt ? o : 0;
  }

  window.render = (t) => {
    t = clamp(t, 0, END);
    drawBg(t);
    scene1(t); scene2(t); scene3(t); scene4(t); scene5(t); scene6(t);
    endcard(t);
    persistent(t);
  };

  window.READY = (async () => {
    await document.fonts.ready;
    await Promise.all([...document.images].map((im) => im.decode().catch(() => {})));
    buildParticles();
    window.render(new URLSearchParams(location.search).has("t") ? +new URLSearchParams(location.search).get("t") : 0);
    return true;
  })();

  // Pré-visualização em tempo real no navegador: abra index.html?play
  if (new URLSearchParams(location.search).has("play")) {
    window.READY.then(() => {
      const t0 = performance.now();
      const loop = () => { window.render(((performance.now() - t0) / 1000) % END); requestAnimationFrame(loop); };
      loop();
    });
  }
})();
