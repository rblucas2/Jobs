/* Arranque: tema, service worker, sincronização, navegação entre separadores. */
import { definirRender, el, guardarUi, NS, ui } from "./ecras/comum.js";
import { vistaCv } from "./ecras/cv.js";
import { abrirDefinicoes } from "./ecras/definicoes.js";
import { vistaPerfil } from "./ecras/perfil.js";
import { vistaTracker } from "./ecras/tracker.js";
import { vistaVaga } from "./ecras/vaga.js";
import { vistaVagas } from "./ecras/vagas.js";

const VISTAS = { vagas: vistaVagas, vaga: vistaVaga, cv: vistaCv, tracker: vistaTracker, perfil: vistaPerfil };
const SUB = { vagas: "Ordenadas pela compatibilidade", vaga: "Detalhe e compatibilidade", cv: "Revisão do CV adaptado", tracker: "Candidaturas", perfil: "Fonte única de verdade" };

function aplicarTema() {
  const pref = Store.get("sys").theme || "auto";
  const root = document.documentElement;
  if (pref === "auto") root.removeAttribute("data-theme"); else root.setAttribute("data-theme", pref);
  const escuro = pref === "dark" || (pref === "auto" && matchMedia("(prefers-color-scheme: dark)").matches);
  document.querySelector('meta[name="theme-color"]').setAttribute("content", escuro ? "#121212" : "#f6f6f4");
}
matchMedia("(prefers-color-scheme: dark)").addEventListener("change", aplicarTema);

let pedidoInstalar = null;
window.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); pedidoInstalar = e; });
async function instalar() {
  if (pedidoInstalar) { pedidoInstalar.prompt(); await pedidoInstalar.userChoice; pedidoInstalar = null; }
  else UI.toast("No telemóvel: menu do browser → “Adicionar ao ecrã principal”.", 4000);
}

let pendente = false;
function render() {
  // Não redesenhar enquanto se escreve num campo (a sincronização pode chegar a meio).
  const ativo = document.activeElement;
  if (ativo && ["INPUT", "TEXTAREA", "SELECT"].includes(ativo.tagName) && document.getElementById("view").contains(ativo) && ativo.type !== "checkbox") {
    pendente = true; return;
  }
  pendente = false;
  document.querySelectorAll("#tabs button").forEach((b) => b.classList.toggle("active", b.dataset.tab === ui.tab));
  document.getElementById("subtitle").textContent = SUB[ui.tab] || "";
  const view = document.getElementById("view");
  let conteudo;
  try { conteudo = (VISTAS[ui.tab] || vistaVagas)(); }
  catch (e) { console.error(e); conteudo = el("div", { class: "card alerta" }, [el("strong", { text: "Erro ao mostrar este ecrã" }), el("p", { class: "tiny", text: e.message })]); }
  view.replaceChildren(conteudo);
}
document.addEventListener("focusout", () => setTimeout(() => { if (pendente) render(); }, 0));
definirRender(render);

document.getElementById("tabs").addEventListener("click", (e) => {
  const b = e.target.closest("button[data-tab]");
  if (!b) return;
  ui.tab = b.dataset.tab; ui.rascunhoCv = null; guardarUi(); render(); window.scrollTo(0, 0);
});
document.getElementById("settingsBtn").addEventListener("click", () => abrirDefinicoes(aplicarTema, instalar));

const pill = document.getElementById("syncPill");
Sync.onStatus((s) => {
  const mapa = { off: ["", ""], ready: ["Sincronizado", "var(--good)"], syncing: ["A sincronizar…", "var(--accent)"], error: ["Erro de sincronização", "var(--bad)"] };
  const [t, cor] = mapa[s] || mapa.off;
  pill.style.display = t ? "" : "none";
  pill.innerHTML = t ? `<span class="dot" style="background:${cor}"></span>` : "";
  pill.title = t;
});

Store.ensure("sys", { theme: "auto" });
aplicarTema();
if ("serviceWorker" in navigator && location.protocol.startsWith("http")) navigator.serviceWorker.register("./sw.js").catch((e) => console.warn("SW", e));
Store.subscribe(NS, render);
Sync.init();
render();
