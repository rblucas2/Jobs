/* =====================================================================
   ui.js — utilitários de interface partilhados (sem dependências)
   ===================================================================== */
(function (global) {
  // --- Criação de elementos -------------------------------------------
  function el(tag, attrs = {}, children = []) {
    const e = document.createElement(tag);
    for (const k in attrs) {
      const v = attrs[k];
      if (k === "class") e.className = v;
      else if (k === "html") e.innerHTML = v;
      else if (k === "text") e.textContent = v;
      else if (k === "dataset") Object.assign(e.dataset, v);
      else if (k.startsWith("on") && typeof v === "function") e.addEventListener(k.slice(2).toLowerCase(), v);
      else if (v === true) e.setAttribute(k, "");
      else if (v !== false && v != null) e.setAttribute(k, v);
    }
    (Array.isArray(children) ? children : [children]).forEach((c) => {
      if (c == null || c === false) return;
      e.appendChild(typeof c === "string" || typeof c === "number" ? document.createTextNode(String(c)) : c);
    });
    return e;
  }
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const clear = (n) => { while (n && n.firstChild) n.removeChild(n.firstChild); return n; };

  // --- Formatação ------------------------------------------------------
  const eur = (n) => (isFinite(n) ? n : 0).toLocaleString("pt-PT", { style: "currency", currency: "EUR" });
  const eur0 = (n) => (isFinite(n) ? n : 0).toLocaleString("pt-PT", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
  const num = (n, d = 0) => (isFinite(n) ? n : 0).toLocaleString("pt-PT", { maximumFractionDigits: d });
  const pad = (n) => String(n).padStart(2, "0");
  const todayISO = () => isoDate(new Date());
  function isoDate(d) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
  function monthKey(d = new Date()) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`; }
  const MONTHS = ["janeiro","fevereiro","março","abril","maio","junho","julho","agosto","setembro","outubro","novembro","dezembro"];
  const DAYS = ["dom","seg","ter","qua","qui","sex","sáb"];
  function prettyDate(iso) {
    if (!iso) return "";
    const d = new Date(iso + (iso.length === 10 ? "T00:00:00" : ""));
    return `${d.getDate()} ${MONTHS[d.getMonth()].slice(0,3)}`;
  }
  function prettyMonth(mk) {
    const [y, m] = mk.split("-").map(Number);
    return `${MONTHS[m - 1]} ${y}`;
  }

  // --- Toast -----------------------------------------------------------
  function toast(msg, ms = 2200) {
    let host = $("#toast");
    if (!host) { host = el("div", { id: "toast" }); document.body.appendChild(host); }
    const t = el("div", { class: "t", text: msg });
    host.appendChild(t);
    setTimeout(() => { t.style.opacity = "0"; t.style.transition = "opacity .3s"; setTimeout(() => t.remove(), 300); }, ms);
  }

  // Toast com ação "Anular" (undo)
  function undo(msg, fn, ms = 5000) {
    let host = $("#toast"); if (!host) { host = el("div", { id: "toast" }); document.body.appendChild(host); }
    const btn = el("button", { style: "background:none;border:0;color:var(--accent);font-weight:700;margin-left:12px;padding:0;font-size:.85rem;cursor:pointer", text: "Anular" });
    const t = el("div", { class: "t" }, [document.createTextNode(msg), btn]);
    host.appendChild(t);
    let done = false;
    btn.addEventListener("click", () => { if (done) return; done = true; fn(); t.remove(); toast("Reposto ✓"); });
    setTimeout(() => { if (!done) { t.style.opacity = "0"; t.style.transition = "opacity .3s"; setTimeout(() => t.remove(), 300); } }, ms);
  }

  // --- Sheet / Modal ---------------------------------------------------
  function sheet(title, contentNodes, { onClose } = {}) {
    const body = el("div", { class: "form-grid" }, contentNodes);
    const sheetEl = el("div", { class: "sheet" }, [el("h2", { text: title }), body]);
    const scrim = el("div", { class: "scrim" }, [sheetEl]);
    function close() { scrim.remove(); document.body.style.overflow = ""; onClose && onClose(); }
    scrim.addEventListener("click", (e) => { if (e.target === scrim) close(); });
    document.body.appendChild(scrim);
    document.body.style.overflow = "hidden";
    return { close, body, el: sheetEl };
  }

  function confirm(msg, { ok = "Confirmar", danger = false } = {}) {
    return new Promise((resolve) => {
      const s = sheet("Confirmar", [
        el("p", { class: "muted", text: msg }),
        el("div", { class: "row", style: "gap:10px;margin-top:6px" }, [
          el("button", { class: "btn btn-block", text: "Cancelar", onclick: () => { s.close(); resolve(false); } }),
          el("button", { class: "btn btn-block " + (danger ? "" : "btn-primary"), style: danger ? "background:var(--bad);color:#fff" : "", text: ok, onclick: () => { s.close(); resolve(true); } }),
        ]),
      ]);
    });
  }

  /** Campo de formulário rápido. type: text|number|date|select|textarea */
  function field(label, opts = {}) {
    const { type = "text", value = "", options, ...rest } = opts;
    let input;
    if (type === "select") {
      input = el("select", rest);
      (options || []).forEach((o) => {
        const ov = typeof o === "object" ? o.value : o;
        const ol = typeof o === "object" ? o.label : o;
        input.appendChild(el("option", { value: ov, selected: String(ov) === String(value) }, ol));
      });
    } else if (type === "textarea") {
      input = el("textarea", rest); input.value = value;
    } else {
      input = el("input", { type, ...rest }); input.value = value;
    }
    const wrap = el("label", { class: "field" }, [label ? el("span", { text: label }) : null, input]);
    wrap.input = input;
    return wrap;
  }

  // --- Progress bar ----------------------------------------------------
  function bar(pct, tone) {
    const p = Math.max(0, Math.min(100, pct));
    const cls = tone ? " " + tone : "";
    return el("div", { class: "bar" + cls }, [el("i", { style: `width:${p}%` })]);
  }
  function toneFor(pct) { return pct >= 100 ? "bad" : pct >= 85 ? "warn" : "good"; }

  // --- Anel SVG (progresso circular) ----------------------------------
  function ring(pct, { size = 120, stroke = 11, label, sub, color } = {}) {
    const r = (size - stroke) / 2;
    const c = 2 * Math.PI * r;
    const p = Math.max(0, Math.min(100, pct));
    const off = c * (1 - p / 100);
    const ns = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(ns, "svg");
    svg.setAttribute("class", "ring"); svg.setAttribute("width", size); svg.setAttribute("height", size);
    svg.setAttribute("viewBox", `0 0 ${size} ${size}`);
    const mk = (extra) => { const ci = document.createElementNS(ns, "circle"); ci.setAttribute("cx", size/2); ci.setAttribute("cy", size/2); ci.setAttribute("r", r); ci.setAttribute("fill", "none"); ci.setAttribute("stroke-width", stroke); for (const k in extra) ci.setAttribute(k, extra[k]); return ci; };
    svg.appendChild(mk({ stroke: "var(--surface-2)" }));
    svg.appendChild(mk({ stroke: color || "var(--accent)", "stroke-linecap": "round", "stroke-dasharray": c, "stroke-dashoffset": off, transform: `rotate(-90 ${size/2} ${size/2})`, style: "transition:stroke-dashoffset .5s cubic-bezier(.2,.8,.2,1)" }));
    if (label != null) { const t = document.createElementNS(ns, "text"); t.setAttribute("x", "50%"); t.setAttribute("y", sub ? "46%" : "52%"); t.setAttribute("text-anchor", "middle"); t.setAttribute("font-size", size * .2); t.setAttribute("font-weight", "700"); t.textContent = label; svg.appendChild(t); }
    if (sub) { const t = document.createElementNS(ns, "text"); t.setAttribute("x", "50%"); t.setAttribute("y", "62%"); t.setAttribute("text-anchor", "middle"); t.setAttribute("font-size", size * .1); t.setAttribute("fill", "var(--text-soft)"); t.textContent = sub; svg.appendChild(t); }
    return svg;
  }

  // --- Donut categórico (lista de {label,value,color}) -----------------
  // onSelect(part, index): opcional — se dado, cada fatia fica tocável (destaca-se a si
  // própria, esbate as outras) e chama onSelect ao ser tocada. Quem chama trata do resto
  // (ex.: mostrar o detalhe da fatia, ligar a legenda) — o donut só sabe desenhar e avisar.
  function donut(parts, { size = 150, stroke = 22, onSelect } = {}) {
    const ns = "http://www.w3.org/2000/svg";
    const r = (size - stroke) / 2, c = 2 * Math.PI * r, cx = size / 2;
    const total = parts.reduce((a, b) => a + b.value, 0) || 1;
    const svg = document.createElementNS(ns, "svg");
    svg.setAttribute("width", size); svg.setAttribute("height", size); svg.setAttribute("viewBox", `0 0 ${size} ${size}`);
    let acc = 0;
    const base = document.createElementNS(ns, "circle");
    base.setAttribute("cx", cx); base.setAttribute("cy", cx); base.setAttribute("r", r); base.setAttribute("fill", "none"); base.setAttribute("stroke", "var(--surface-2)"); base.setAttribute("stroke-width", stroke);
    svg.appendChild(base);
    parts.forEach((p, i) => {
      if (p.value <= 0) return;
      const frac = p.value / total;
      const ci = document.createElementNS(ns, "circle");
      ci.setAttribute("cx", cx); ci.setAttribute("cy", cx); ci.setAttribute("r", r); ci.setAttribute("fill", "none");
      ci.setAttribute("stroke", p.color); ci.setAttribute("stroke-width", stroke);
      ci.setAttribute("stroke-dasharray", `${c * frac} ${c * (1 - frac)}`);
      ci.setAttribute("stroke-dashoffset", -c * acc);
      ci.setAttribute("transform", `rotate(-90 ${cx} ${cx})`);
      ci.dataset.idx = i;
      ci.style.transition = "opacity .15s";
      if (onSelect) {
        ci.setAttribute("pointer-events", "stroke");
        ci.style.cursor = "pointer";
        ci.addEventListener("click", () => onSelect(p, i));
      }
      svg.appendChild(ci);
      acc += frac;
    });
    return svg;
  }

  /** Donut + legenda + total central, com interatividade: tocar numa fatia (ou na
   *  linha da legenda correspondente) mostra o nome/valor/percentagem dessa fatia no
   *  centro do anel e esbate as restantes; tocar de novo volta ao total. Usado nos
   *  gráficos de categorias das Finanças. Com onOpen(part) definido, o detalhe da
   *  fatia ganha um link "Ver movimentos" que chama onOpen — quem chama decide o que
   *  mostrar (ex.: a lista de transações dessa categoria). */
  function donutCard({ title, parts, totalValue, totalLabel, legendLimit = 7, empty, onOpen } = {}) {
    const total = parts.reduce((a, p) => a + p.value, 0) || 1;
    if (!parts.length) return el("div", { class: "card" }, [title ? el("strong", { text: title }) : null, el("div", { class: "empty tiny", html: empty || "—" })].filter(Boolean));

    const centerEl = el("div", { style: "position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:0 12px;text-align:center;gap:1px" });
    const fitText = (text) => el("div", { class: "num", style: "font-weight:800;font-size:1.05rem;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap", text });
    function showTotal() {
      centerEl.innerHTML = "";
      centerEl.appendChild(fitText(totalValue));
      centerEl.appendChild(el("div", { class: "tiny muted", style: "font-size:.62rem;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap", text: totalLabel || "" }));
    }
    function showPart(p) {
      centerEl.innerHTML = "";
      centerEl.appendChild(el("div", { class: "tiny", style: "font-weight:750;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap", text: p.label }));
      centerEl.appendChild(fitText(eur0(p.value)));
      centerEl.appendChild(el("div", { class: "tiny muted", style: "font-size:.62rem", text: Math.round(p.value / total * 100) + "%" }));
      if (onOpen) centerEl.appendChild(el("div", { class: "tiny", style: "font-size:.6rem;font-weight:750;color:var(--accent);margin-top:2px;cursor:pointer", text: "Ver movimentos ›", onclick: (e) => { e.stopPropagation(); onOpen(p); } }));
    }
    let selectedIdx = null;
    const legendRows = [];
    function paintSelection() {
      [...svg.querySelectorAll("circle[data-idx]")].forEach((c) => { c.style.opacity = (selectedIdx === null || Number(c.dataset.idx) === selectedIdx) ? "1" : ".3"; });
      legendRows.forEach((row, i) => row.classList.toggle("sel", selectedIdx === i));
    }
    function select(i) {
      selectedIdx = selectedIdx === i ? null : i;
      if (selectedIdx === null) showTotal(); else showPart(parts[selectedIdx]);
      paintSelection();
    }
    const svg = donut(parts, { size: 132, onSelect: (p, i) => select(i) });
    showTotal();
    const legend = el("div", { class: "legend", style: "flex:1" }, parts.slice(0, legendLimit).map((p, i) => {
      const row = el("div", { class: "lg", dataset: { idx: i }, onclick: () => select(i) }, [
        el("span", { class: "nm" }, [el("span", { class: "sw", style: "background:" + p.color }), el("span", { class: "tiny", text: p.label })]),
        el("span", { class: "vl tiny", text: eur0(p.value) + " · " + Math.round(p.value / total * 100) + "%" }),
      ]);
      legendRows.push(row);
      return row;
    }));
    return el("div", { class: "card" }, [
      title ? el("strong", { text: title }) : null,
      el("div", { class: "row", style: "gap:18px;margin-top:14px;align-items:center" }, [
        el("div", { class: "ringwrap", style: "flex:none;position:relative" }, [svg, centerEl]),
        legend,
      ]),
    ].filter(Boolean));
  }

  // --- Mini gráfico de barras / linha (histórico) ----------------------
  function sparkBars(values, { height = 60, color = "var(--accent)", labels } = {}) {
    const max = Math.max(1, ...values.map((v) => Math.abs(v)));
    const wrap = el("div", { class: "row", style: `align-items:flex-end;gap:6px;height:${height}px` });
    values.forEach((v, i) => {
      const h = Math.max(3, (Math.abs(v) / max) * height);
      const col = el("div", { style: "flex:1;display:flex;flex-direction:column;justify-content:flex-end;height:100%;gap:4px;align-items:center" }, [
        el("div", { style: `width:100%;max-width:34px;height:${h}px;border-radius:5px;background:${v < 0 ? "var(--bad)" : color};opacity:${0.45 + 0.55 * (Math.abs(v) / max)}` }),
        labels ? el("div", { class: "tiny muted", style: "font-size:.62rem", text: labels[i] || "" }) : null,
      ]);
      wrap.appendChild(col);
    });
    return wrap;
  }

  // Gráfico de linha (escala min–max) — ideal para peso/património
  function lineChart(values, { height = 70, color = "var(--accent)", labels } = {}) {
    const w = 300, h = height, pad = 8;
    const min = Math.min(...values), max = Math.max(...values), range = (max - min) || 1, n = values.length;
    const X = (i) => (n <= 1 ? w / 2 : pad + i * (w - 2 * pad) / (n - 1));
    const Y = (v) => pad + (1 - (v - min) / range) * (h - 2 * pad);
    const ns = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(ns, "svg");
    svg.setAttribute("viewBox", `0 0 ${w} ${h}`); svg.setAttribute("width", "100%"); svg.setAttribute("height", h); svg.setAttribute("preserveAspectRatio", "none");
    const poly = document.createElementNS(ns, "polyline");
    poly.setAttribute("points", values.map((v, i) => `${X(i).toFixed(1)},${Y(v).toFixed(1)}`).join(" "));
    poly.setAttribute("fill", "none"); poly.setAttribute("stroke", color); poly.setAttribute("stroke-width", "2.5");
    poly.setAttribute("stroke-linecap", "round"); poly.setAttribute("stroke-linejoin", "round"); poly.setAttribute("vector-effect", "non-scaling-stroke");
    svg.appendChild(poly);
    const dot = document.createElementNS(ns, "circle");
    dot.setAttribute("cx", X(n - 1)); dot.setAttribute("cy", Y(values[n - 1])); dot.setAttribute("r", "3.5"); dot.setAttribute("fill", color); dot.setAttribute("vector-effect", "non-scaling-stroke");
    svg.appendChild(dot);
    const wrap = el("div", { style: "margin-top:8px" }, [svg]);
    if (labels) wrap.appendChild(el("div", { class: "row", style: "justify-content:space-between;margin-top:2px" }, [el("span", { class: "tiny muted", text: labels[0] }), el("span", { class: "tiny muted", text: labels[labels.length - 1] })]));
    return wrap;
  }

  // Paleta categórica (série 1-8, ver --series-N em base.css).
  const PALETTE = ["var(--series-1)","var(--series-2)","var(--series-3)","var(--series-4)","var(--series-5)","var(--series-6)","var(--series-7)","var(--series-8)"];
  // Cor determinística por nome — só para usos isolados (uma cor de cada vez, sem mais
  // nenhuma à vista para comparar). NÃO usar para colorir uma lista inteira: com só 8 cores,
  // duas categorias quaisquer têm forte probabilidade de calhar na mesma cor por acaso
  // (ex.: "Supermercado" e "Outros" no mesmo gráfico) — foi exatamente o bug reportado.
  function colorFor(str) {
    let h = 0; for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0;
    return PALETTE[h % PALETTE.length];
  }
  // Cores para uma lista de N categorias mostradas AO MESMO TEMPO (ex.: fatias de um donut):
  // atribui por posição, garantindo que nenhuma se repete enquanto N <= 8. A cor de cada
  // categoria pode mudar de um dia para o outro se a lista/ordem mudar — aceitável, porque
  // a legenda ao lado de cada fatia já identifica a categoria pelo nome, não pela cor.
  function colorsForCount(n) {
    const out = []; for (let i = 0; i < n; i++) out.push(PALETTE[i % PALETTE.length]); return out;
  }

  function svgIcon(path, size = 24) {
    return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${path}</svg>`;
  }

  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

  /** Protege um botão contra duplo-toque/duplo-clique (evita criar o mesmo registo 2x).
   *  Desativa o botão de imediato; volta a ativá-lo passado `cooldownMs` (o botão pode já
   *  não existir se o handler fechou um sheet — nesse caso não faz nada). */
  function guardClick(fn, cooldownMs = 700) {
    return function (e) {
      const btn = e.currentTarget;
      if (btn.disabled) return;
      btn.disabled = true;
      setTimeout(() => { if (btn && btn.isConnected) btn.disabled = false; }, cooldownMs);
      return fn(e);
    };
  }

  // Navegador de datas: ‹  [Hoje / data]  › — clicar no centro volta a hoje
  function dateNav(curIso, onChange) {
    const isToday = curIso === todayISO();
    const d = new Date(curIso + "T00:00:00");
    const yest = isoDate(new Date(Date.now() - 86400000));
    const tom = isoDate(new Date(Date.now() + 86400000));
    let label = isToday ? "Hoje" : curIso === yest ? "Ontem" : curIso === tom ? "Amanhã"
      : d.toLocaleDateString("pt-PT", { weekday: "short", day: "numeric", month: "short" });
    const shift = (n) => { const nd = new Date(curIso + "T00:00:00"); nd.setDate(nd.getDate() + n); onChange(isoDate(nd)); };
    return el("div", { class: "row", style: "justify-content:center;gap:8px;margin:2px 0 12px" }, [
      el("button", { class: "btn btn-ghost btn-sm", text: "‹", onclick: () => shift(-1) }),
      el("button", { class: "btn " + (isToday ? "btn-soft" : "btn-primary") + " btn-sm", style: "min-width:140px", text: label, title: "Voltar a hoje", onclick: () => onChange(todayISO()) }),
      el("button", { class: "btn btn-ghost btn-sm", text: "›", onclick: () => shift(1) }),
    ]);
  }

  global.UI = { el, $, $$, clear, eur, eur0, num, todayISO, isoDate, monthKey, prettyDate, prettyMonth, MONTHS, DAYS, pad,
    toast, undo, sheet, confirm, field, bar, toneFor, ring, donut, donutCard, sparkBars, lineChart, colorFor, colorsForCount, svgIcon, uid, dateNav, guardClick };
})(window);
