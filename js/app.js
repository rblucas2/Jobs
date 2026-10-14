/* Arranque: tema, service worker, sincronização e a estrutura da app
   (barra lateral no PC, barra de navegação inferior no telemóvel, barra de topo e ecrã dividido). */
import { cfg, definirRender, ecraLargo, el, estado, guardarUi, icone, NS, ui } from "./ecras/comum.js";
import { vistaCv } from "./ecras/cv.js";
import { abrirDefinicoes } from "./ecras/definicoes.js";
import { vistaInicio } from "./ecras/inicio.js";
import { vistaPerfil } from "./ecras/perfil.js";
import { vistaPipeline } from "./ecras/pipeline.js";
import { vistaVaga } from "./ecras/vaga.js";
import { listaVagas, vistaVagas } from "./ecras/vagas.js";
import * as dados from "./dados.js";
import { followupsEmAtraso } from "./tracker.js";

const NAV = [
  { id: "inicio", rotulo: "Início", ic: "home" },
  { id: "vagas", rotulo: "Vagas", ic: "briefcase", tambem: ["vaga"] },
  { id: "pipeline", rotulo: "Pipeline", ic: "kanban" },
  { id: "cv", rotulo: "CV", ic: "file" },
  { id: "perfil", rotulo: "Perfil", ic: "user" },
];
const VISTAS = { inicio: vistaInicio, vagas: vistaVagas, vaga: vistaVaga, pipeline: vistaPipeline, cv: vistaCv, perfil: vistaPerfil };

function aplicarTema() {
  const pref = Store.get("sys").theme || "auto";
  const root = document.documentElement;
  if (pref === "auto") root.removeAttribute("data-theme"); else root.setAttribute("data-theme", pref);
  const escuro = pref === "dark" || (pref === "auto" && matchMedia("(prefers-color-scheme: dark)").matches);
  document.querySelector('meta[name="theme-color"]').setAttribute("content", escuro ? "#0c0e11" : "#f5f5f2");
}
matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => { aplicarTema(); render(); });

let pedidoInstalar = null;
window.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); pedidoInstalar = e; });
async function instalar() {
  if (pedidoInstalar) { pedidoInstalar.prompt(); await pedidoInstalar.userChoice; pedidoInstalar = null; }
  else UI.toast("No telemóvel: menu do browser → “Adicionar ao ecrã principal”.", 4000);
}
const definicoes = () => abrirDefinicoes(aplicarTema, instalar);

function ir(tab) { ui.tab = tab; ui.rascunhoCv = null; guardarUi(); render(); window.scrollTo(0, 0); }

function contagens() {
  const e = estado();
  return { pipeline: followupsEmAtraso(e).length, cv: dados.listarCvs(e, { estado: "rascunho" }).length, vagas: dados.pendentesNaoReconhecidos(e).length };
}

const syncEstado = { off: ["Só neste dispositivo", "var(--ink-3)"], ready: ["Sincronizado", "var(--good)"], syncing: ["A sincronizar…", "var(--info)"], error: ["Erro de sincronização", "var(--bad)"] };
const syncPill = () => { const [t, cor] = syncEstado[Sync.status] || syncEstado.off; return el("span", { class: "sync", title: t }, [el("i", { class: "dot", style: `background:${cor}` }), t]); };

function desenharNavegacao() {
  const n = contagens();
  const ativo = (it) => it.id === ui.tab || (it.tambem || []).includes(ui.tab);
  const badge = (it) => (n[it.id] ? el("span", { class: "badge", text: n[it.id] }) : null);
  const link = (it) => el("a", { href: "#" + it.id, class: ativo(it) ? "on" : "", "aria-current": ativo(it) ? "page" : null, onclick: (e) => { e.preventDefault(); ir(it.id); } }, [icone(it.ic), el("span", { text: it.rotulo }), badge(it)]);

  document.getElementById("tabbar").replaceChildren(...NAV.map(link));
  document.getElementById("sidebar").replaceChildren(
    el("div", { class: "brand" }, [el("div", { class: "mark" }, [icone("briefcase")]), el("div", {}, [el("b", { text: "Emprego" }), el("span", { text: "Procura de emprego" })])]),
    el("nav", { class: "nav" }, NAV.map(link)),
    el("div", { class: "side-foot" }, [syncPill(), el("button", { class: "btn btn-ghost", style: "justify-content:flex-start", id: "btnDefinicoesLateral", onclick: definicoes }, [icone("settings"), "Definições"])]),
  );
}

function desenharTopo(v) {
  const bar = document.getElementById("appbar");
  bar.replaceChildren(...[
    v.voltar ? el("button", { class: "btn btn-icon btn-ghost back only-mobile", "aria-label": "Voltar", onclick: v.voltar }, [icone("left")]) : null,
    el("div", { class: "grow", style: "min-width:0" }, [el("div", { class: "t truncate", text: v.titulo || "" }), v.sub ? el("div", { class: "s truncate", text: v.sub }) : null]),
    ...(v.acoes || []),
    el("button", { class: "btn btn-icon btn-ghost", id: "btnDefinicoes", "aria-label": "Definições", title: "Definições", onclick: definicoes }, [icone("settings")]),
  ].filter(Boolean));
}

let pendente = false;
function render() {
  // Não redesenhar enquanto se escreve num campo (a sincronização pode chegar a meio).
  const a = document.activeElement;
  if (a && ["INPUT", "TEXTAREA", "SELECT"].includes(a.tagName) && a.type !== "checkbox" && document.getElementById("view").contains(a)) { pendente = true; return; }
  pendente = false;
  let v;
  try {
    // No PC, a lista de vagas e o detalhe aparecem lado a lado.
    if (ecraLargo() && (ui.tab === "vagas" || ui.tab === "vaga")) {
      const base = vistaVagas();
      if (ui.tab === "vagas" && !ui.vagaId) {
        const primeira = dados.listarVagas(estado()).find((x) => x.estado !== "Descartada");
        if (primeira) ui.vagaId = primeira.id;
      }
      const detalhe = vistaVaga();
      ui.tab = "vaga";
      v = { ...base, corpo: el("div", { class: "split" }, [el("div", { class: "pane-list" }, [listaVagas()]), el("div", {}, [detalhe.corpo])]) };
    } else {
      v = (VISTAS[ui.tab] || vistaInicio)();
    }
  } catch (e) {
    console.error(e);
    v = { titulo: "Erro", corpo: el("div", { class: "card bad" }, [el("b", { text: "Erro ao mostrar este ecrã" }), el("p", { class: "tiny", text: e.message })]) };
  }
  desenharNavegacao();
  desenharTopo(v);
  document.getElementById("view").replaceChildren(...[v.corpo, v.fab ? el("button", { class: "fab", "aria-label": "Adicionar vaga", onclick: v.fab }, [icone("plus")]) : null].filter(Boolean));
  document.title = (v.titulo && v.titulo !== "Início" ? v.titulo + " · " : "") + "Emprego";
}
definirRender(render);
document.addEventListener("focusout", () => setTimeout(() => { if (pendente) render(); }, 0));
let redim;
window.addEventListener("resize", () => { clearTimeout(redim); redim = setTimeout(render, 150); });
window.addEventListener("scroll", () => document.getElementById("appbar").classList.toggle("scrolled", window.scrollY > 4), { passive: true });

Sync.onStatus(() => { const s = document.querySelector(".sidebar .sync"); if (s) s.replaceWith(syncPill()); });

Store.ensure("sys", { theme: "auto" });
aplicarTema();
if ("serviceWorker" in navigator && location.protocol.startsWith("http")) navigator.serviceWorker.register("./sw.js").catch((e) => console.warn("SW", e));
Store.subscribe(NS, render);
Sync.init();
cfg();
render();
