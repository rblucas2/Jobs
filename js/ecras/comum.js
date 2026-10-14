/* Estado da interface e componentes partilhados pelos ecrãs. */
import { configCompleta } from "../config.js";
import { garantirEstrutura } from "../dados.js";

export const NS = "jobs";
export const { el, toast } = globalThis.UI;

export const CDN = {
  pdf: "https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.min.js",
  pdfWorker: "https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js",
  mammoth: "https://cdn.jsdelivr.net/npm/mammoth@1.8.0/mammoth.browser.min.js",
  docx: "https://cdn.jsdelivr.net/npm/docx@8.5.0/build/index.umd.js",
};

/** Estado da navegação (por dispositivo; não é sincronizado). */
export const ui = {
  tab: "inicio", vagaId: null, cvId: null, cvTab: "lado",
  filtros: { fonte: "", estado: "ativas", texto: "" },
  perfilVersao: null, rascunhoPerfil: null, rascunhoCv: null,
};
try {
  const g = JSON.parse(localStorage.getItem("jobs:ui") || "{}");
  Object.assign(ui, g, { rascunhoPerfil: null, rascunhoCv: null });
  if (!["inicio", "vagas", "vaga", "pipeline", "cv", "perfil"].includes(ui.tab)) ui.tab = "inicio";
} catch (e) { /* sem armazenamento */ }
export function guardarUi() {
  try { const { rascunhoPerfil, rascunhoCv, ...resto } = ui; localStorage.setItem("jobs:ui", JSON.stringify(resto)); } catch (e) { /* ignorar */ }
}

export const estado = () => garantirEstrutura(Store.get(NS));
export const cfg = () => configCompleta(estado().config);

/** Altera o estado de forma síncrona (grava, sincroniza e volta a desenhar). */
export function mut(fn) {
  let r;
  Store.update(NS, (s) => { garantirEstrutura(s); const c = configCompleta(s.config); r = fn(s, c); s.config = c; });
  return r;
}

/** Para operações assíncronas (Gmail, modelo local): trabalha numa cópia e grava no fim. */
export async function mutAsync(fn) {
  const copia = JSON.parse(JSON.stringify(estado()));
  const c = configCompleta(copia.config);
  const r = await fn(copia, c);
  copia.config = c;
  Store.update(NS, (s) => { for (const k of Object.keys(copia)) if (!k.startsWith("_")) s[k] = copia[k]; });
  return r;
}

let redesenhar = () => {};
export const definirRender = (f) => { redesenhar = f; };
export const render = () => redesenhar();
export function irPara(tab, extra = {}) { Object.assign(ui, extra, { tab }); guardarUi(); render(); window.scrollTo(0, 0); }
export const ecraLargo = () => matchMedia("(min-width: 1140px)").matches;

const scripts = {};
export function carregarScript(url) {
  if (!scripts[url]) {
    scripts[url] = new Promise((res, rej) => {
      const s = document.createElement("script");
      s.src = url; s.async = true;
      s.onload = () => res(); s.onerror = () => { delete scripts[url]; rej(new Error("Não foi possível carregar " + url.split("/npm/")[1] + " (sem ligação?)")); };
      document.head.appendChild(s);
    });
  }
  return scripts[url];
}

export const parseHTML = (html) => new DOMParser().parseFromString(html, "text/html");

// ---------------------------------------------------------------- ícones (Lucide, licença ISC)

const ICONES = {
  home: '<path d="M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8"/><path d="M3 10a2 2 0 0 1 .7-1.5l7-6a2 2 0 0 1 2.6 0l7 6A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  briefcase: '<path d="M16 20V4a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/><rect width="20" height="14" x="2" y="6" rx="2"/>',
  kanban: '<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M8 7v7"/><path d="M12 7v4"/><path d="M16 7v9"/>',
  file: '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M10 9H8"/><path d="M16 13H8"/><path d="M16 17H8"/>',
  user: '<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
  settings: '<path d="M20 7h-9"/><path d="M14 17H5"/><circle cx="17" cy="17" r="3"/><circle cx="7" cy="7" r="3"/>',
  search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
  plus: '<path d="M5 12h14"/><path d="M12 5v14"/>',
  mail: '<rect width="20" height="16" x="2" y="4" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/>',
  inbox: '<polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/>',
  refresh: '<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  checkCircle: '<circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/>',
  alert: '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
  x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  xCircle: '<circle cx="12" cy="12" r="10"/><path d="m15 9-6 6"/><path d="m9 9 6 6"/>',
  left: '<path d="m15 18-6-6 6-6"/>',
  right: '<path d="m9 18 6-6-6-6"/>',
  up: '<path d="m18 15-6-6-6 6"/>',
  external: '<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
  pin: '<path d="M20 10c0 4.99-5.54 10.19-7.4 11.8a1 1 0 0 1-1.2 0C9.54 20.19 4 14.99 4 10a8 8 0 0 1 16 0"/><circle cx="12" cy="10" r="3"/>',
  building: '<rect width="16" height="20" x="4" y="2" rx="2"/><path d="M9 22v-4h6v4"/><path d="M8 6h.01"/><path d="M16 6h.01"/><path d="M12 6h.01"/><path d="M12 10h.01"/><path d="M12 14h.01"/><path d="M16 10h.01"/><path d="M16 14h.01"/><path d="M8 10h.01"/><path d="M8 14h.01"/>',
  calendar: '<rect width="18" height="18" x="3" y="4" rx="2"/><path d="M16 2v4"/><path d="M8 2v4"/><path d="M3 10h18"/>',
  clock: '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
  trash: '<path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/>',
  pencil: '<path d="M21.17 6.81a1 1 0 0 0-3.99-3.99L3.84 16.17a2 2 0 0 0-.5.83l-1.32 4.35a.5.5 0 0 0 .62.62l4.35-1.32a2 2 0 0 0 .83-.5z"/><path d="m15 5 4 4"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/>',
  upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" x2="12" y1="3" y2="15"/>',
  printer: '<path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><path d="M6 9V3a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v6"/><rect x="6" y="14" width="12" height="8" rx="1"/>',
  cloud: '<path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z"/>',
  target: '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>',
  bell: '<path d="M10.27 21a2 2 0 0 0 3.46 0"/><path d="M3.26 15.33A1 1 0 0 0 4 17h16a1 1 0 0 0 .74-1.67C19.41 13.96 18 12.5 18 8A6 6 0 0 0 6 8c0 4.5-1.41 5.96-2.74 7.33"/>',
  trend: '<polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/><polyline points="16 7 22 7 22 13"/>',
  shield: '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/><path d="m9 12 2 2 4-4"/>',
  send: '<path d="M14.54 21.69a.5.5 0 0 0 .94-.03l6.5-19a.5.5 0 0 0-.64-.64l-19 6.5a.5.5 0 0 0-.03.94l7.93 3.18a2 2 0 0 1 1.11 1.11z"/><path d="m21.85 2.15-10.94 10.94"/>',
  chat: '<path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/>',
  award: '<path d="m15.48 12.89 1.51 8.53a.5.5 0 0 1-.81.47l-3.58-2.69a1 1 0 0 0-1.2 0l-3.59 2.69a.5.5 0 0 1-.81-.47l1.51-8.53"/><circle cx="12" cy="8" r="6"/>',
  archive: '<rect width="20" height="5" x="2" y="3" rx="1"/><path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8"/><path d="M10 12h4"/>',
  link: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
  layers: '<path d="m12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83Z"/><path d="m22 17.65-9.17 4.16a2 2 0 0 1-1.66 0L2 17.65"/><path d="m22 12.65-9.17 4.16a2 2 0 0 1-1.66 0L2 12.65"/>',
  eye: '<path d="M2.06 12.35a1 1 0 0 1 0-.7 10.75 10.75 0 0 1 19.88 0 1 1 0 0 1 0 .7 10.75 10.75 0 0 1-19.88 0"/><circle cx="12" cy="12" r="3"/>',
  globe: '<circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/>',
  more: '<circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/>',
};

export function icone(nome, tamanho) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("class", "i");
  svg.setAttribute("aria-hidden", "true");
  if (tamanho) { svg.style.width = tamanho + "px"; svg.style.height = tamanho + "px"; }
  svg.innerHTML = ICONES[nome] || "";
  return svg;
}
export const iconeHtml = (nome) => `<svg viewBox="0 0 24 24" class="i" aria-hidden="true">${ICONES[nome] || ""}</svg>`;

// ---------------------------------------------------------------- componentes

const PALETA = [["#e4ecfb", "#2a5bb7"], ["#e2f2ea", "#1c7a52"], ["#fbe9dc", "#b4561a"], ["#f1e4fa", "#7a3fa8"], ["#fbe3e6", "#b33148"],
  ["#e0f1f4", "#16707f"], ["#f4efd9", "#8a6d10"], ["#e9e7fb", "#4b43b5"]];
const PALETA_ESCURA = [["#16243e", "#8db2f5"], ["#123024", "#6fd3a3"], ["#36220f", "#f1a874"], ["#2a1838", "#cf9df0"], ["#3a1820", "#f39aa9"],
  ["#102c31", "#77cbd8"], ["#2f2a10", "#e1c661"], ["#1f1d3d", "#a9a3f3"]];

export function iniciais(nome) {
  const ps = String(nome || "?").replace(/[^\p{L}\p{N} &]/gu, " ").split(/\s+/).filter((p) => p && !/^(de|da|do|e|&|the|of|sa|lda|s\.a\.)$/i.test(p));
  return ((ps[0] || "?")[0] + (ps[1] ? ps[1][0] : (ps[0] || "").slice(1, 2))).toUpperCase();
}

export function avatar(nome, tam = "") {
  let h = 0; for (const c of String(nome || "")) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const escuro = document.documentElement.getAttribute("data-theme") === "dark" ||
    (!document.documentElement.getAttribute("data-theme") && matchMedia("(prefers-color-scheme: dark)").matches);
  const [bg, fg] = (escuro ? PALETA_ESCURA : PALETA)[h % PALETA.length];
  return el("div", { class: "avatar " + tam, style: `background:${bg};color:${fg}`, text: iniciais(nome), "aria-hidden": "true" });
}

export const tomScore = (p) => (p == null ? "none" : p >= 70 ? "good" : p >= 50 ? "warn" : "bad");
const COR_TOM = { good: "var(--good)", warn: "var(--warn)", bad: "var(--bad)", none: "var(--ink-3)" };

/** Indicador circular da pontuação. Preliminar = anel tracejado. */
export function gauge(p, { tam = 46, preliminar = false, rotulo } = {}) {
  const tr = Math.max(4, Math.round(tam / 11)), r = (tam - tr) / 2, c = 2 * Math.PI * r;
  const v = p == null ? 0 : Math.max(0, Math.min(100, p));
  const cor = COR_TOM[tomScore(p)];
  const w = el("div", { class: "gauge", style: `width:${tam}px;height:${tam}px`, title: p == null ? "Sem análise" : `${p}/100${preliminar ? " · preliminar" : ""}` });
  w.innerHTML = `<svg width="${tam}" height="${tam}" viewBox="0 0 ${tam} ${tam}"><circle cx="${tam / 2}" cy="${tam / 2}" r="${r}" fill="none" stroke="var(--surface-3)" stroke-width="${tr}"${preliminar ? ' stroke-dasharray="2 3"' : ""}/>` +
    `<circle cx="${tam / 2}" cy="${tam / 2}" r="${r}" fill="none" stroke="${cor}" stroke-width="${tr}" stroke-linecap="round" stroke-dasharray="${c * v / 100} ${c}"${preliminar ? ' opacity=".55"' : ""}/></svg>`;
  w.appendChild(el("b", { style: `font-size:${Math.round(tam * (rotulo ? .3 : .32))}px;${rotulo ? `margin-top:-${Math.round(tam * .1)}px` : ""}`, text: p == null ? "–" : String(p) }));
  if (rotulo) w.appendChild(el("small", { text: rotulo }));
  return w;
}

export function chip(texto, tom = "", ic) {
  return el("span", { class: "chip " + tom }, [ic ? icone(ic) : null, texto]);
}

export function card(titulo, filhos = [], extra = {}) {
  const cab = titulo ? el("div", { class: "card-h" }, [
    extra.icone ? el("div", { style: "color:var(--ink-3);display:flex" }, [icone(extra.icone)]) : null,
    el("div", { class: "grow" }, [el("h3", { text: titulo }), extra.sub ? el("div", { class: "sub", text: extra.sub }) : null]),
    ...(extra.acoes || []),
  ]) : null;
  return el("div", { class: "card " + (extra.class || "") }, [cab, ...filhos].filter(Boolean));
}

export function vazio(ic, titulo, texto, acoes = []) {
  return el("div", { class: "empty-state" }, [el("div", { class: "ic" }, [icone(ic)]), el("h3", { text: titulo }), texto ? el("p", { text: texto }) : null,
    acoes.length ? el("div", { class: "row wrap-row", style: "justify-content:center" }, acoes) : null]);
}

export function botao(texto, onclick, cls = "btn", extra = {}) {
  const { icone: ic, ...resto } = extra;
  return el("button", { class: cls, onclick: UI.guardClick(async (e) => {
    try { await onclick(e); } catch (err) { console.error(err); toast(err.message || String(err), 5000); }
  }, 600), ...resto }, [ic ? icone(ic) : null, texto ? el("span", { text: texto }) : null]);
}

export function verificar(rotulo) {
  const cb = el("input", { type: "checkbox" });
  const lab = el("label", { class: "check" }, [cb, el("span", { text: rotulo })]);
  lab.cb = cb;
  return lab;
}

export const download = (blob, nome) => {
  const a = el("a", { href: URL.createObjectURL(blob), download: nome });
  document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
};

export function dataCurta(iso) {
  if (!iso) return "";
  const d = new Date(String(iso).slice(0, 10) + "T00:00:00");
  if (isNaN(d)) return "";
  const dias = Math.round((new Date(UI.todayISO() + "T00:00:00") - d) / 86400000);
  if (dias === 0) return "hoje";
  if (dias === 1) return "ontem";
  if (dias > 1 && dias < 7) return `há ${dias} dias`;
  if (dias === -1) return "amanhã";
  if (dias < -1 && dias > -7) return `em ${-dias} dias`;
  return d.toLocaleDateString("pt-PT", { day: "numeric", month: "short" });
}

/** Cores de cada fase do pipeline (consistentes em todos os ecrãs). */
export const FASES = {
  "Por candidatar": { cor: "#8b9099", ic: "target", curto: "Guardadas" },
  "Candidatado": { cor: "#2f69c9", ic: "send", curto: "Candidatei-me" },
  "Entrevista": { cor: "#c97d12", ic: "chat", curto: "Entrevista" },
  "Oferta": { cor: "#18925f", ic: "award", curto: "Oferta" },
  "Rejeitado": { cor: "#cf4436", ic: "xCircle", curto: "Rejeitado" },
  "Descartada": { cor: "#b8bcc3", ic: "archive", curto: "Descartada" },
};
