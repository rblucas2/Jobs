/* Estado da interface e utilitários partilhados pelos ecrãs. */
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
  tab: "vagas", vagaId: null, cvId: null, cvTab: "lado",
  filtros: { fonte: "", estado: "ativas", texto: "" },
  trackerEstados: ["Candidatado", "Entrevista", "Oferta"],
  perfilVersao: null, rascunhoPerfil: null, rascunhoCv: null, propostaCv: null,
};
try { Object.assign(ui, JSON.parse(localStorage.getItem("jobs:ui") || "{}"), { rascunhoPerfil: null, rascunhoCv: null, propostaCv: null }); } catch (e) { /* sem armazenamento */ }
export function guardarUi() {
  try { const { rascunhoPerfil, rascunhoCv, propostaCv, ...resto } = ui; localStorage.setItem("jobs:ui", JSON.stringify(resto)); } catch (e) { /* ignorar */ }
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

export function classeScore(p, preliminar) {
  if (p == null) return "score";
  return "score " + (p >= 70 ? "alta" : p >= 50 ? "media" : "baixa") + (preliminar ? " prelim" : "");
}

export function card(titulo, filhos = [], extra = {}) {
  return el("div", { class: "card " + (extra.class || "") }, [titulo ? el("strong", { text: titulo }) : null, ...filhos].filter(Boolean));
}

export function botao(texto, onclick, cls = "btn", extra = {}) {
  return el("button", { class: cls, text: texto, onclick: UI.guardClick(async (e) => {
    try { await onclick(e); } catch (err) { console.error(err); toast(err.message || String(err), 5000); }
  }, 600), ...extra });
}

export function linhaInfo(rotulo, valor) {
  return el("div", { class: "row tiny", style: "justify-content:space-between;gap:10px;padding:3px 0" }, [el("span", { class: "muted", text: rotulo }), el("span", { text: valor || "—" })]);
}

/** Campo de texto ligado diretamente a um objeto (sem redesenhar a cada tecla). */
export function campoLigado(rotulo, obj, chave, opts = {}) {
  const f = UI.field(rotulo, { value: obj[chave] ?? "", ...opts });
  const ev = opts.type === "select" ? "change" : "input";
  f.input.addEventListener(ev, () => { obj[chave] = opts.type === "number" ? Number(f.input.value) : f.input.value; });
  return f;
}

export const download = (blob, nome) => {
  const a = el("a", { href: URL.createObjectURL(blob), download: nome });
  document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
};
