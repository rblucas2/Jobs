/* Ecrã Vagas: lista ordenada por pontuação, recolha do Gmail, inserção manual, filtros. */
import { analisarVaga } from "../compat.js";
import { FONTES } from "../config.js";
import * as dados from "../dados.js";
import * as gmail from "../gmail.js";
import { perfilValidado } from "../perfil.js";
import { inserirManual, novoResultado } from "../recolha.js";
import * as tracker from "../tracker.js";
import { avatar, botao, cfg, chip, dataCurta, el, estado, FASES, gauge, guardarUi, icone, irPara, mut, mutAsync, parseHTML, render, toast, ui, vazio, verificar } from "./comum.js";

export async function pontuar(ids) {
  const e = estado(), c = cfg();
  const perfil = perfilValidado(e, c);
  if (!perfil) { toast("Valide o perfil-base (Perfil) para as vagas serem pontuadas.", 4000); return 0; }
  let n = 0;
  for (const id of ids) {
    const vaga = dados.obterVaga(estado(), id);
    if (!vaga) continue;
    const r = await analisarVaga(c, perfil, vaga);
    mut((s) => dados.guardarAnalise(s, id, r, perfil.versao));
    n++;
  }
  return n;
}

export function clientIdGoogle(c) {
  return c.gmail.client_id || ((Store.peekVidaOS("sys").gcal || {}).clientId) || "";
}

export async function recolherGmail() {
  const c = cfg();
  const clientId = clientIdGoogle(c);
  if (!clientId) { toast("Ligue primeiro o Gmail nas Definições.", 4000); return; }
  toast("A ler os alertas do Gmail…");
  const res = await mutAsync(async (s, cc) => {
    const r = await gmail.recolher(gmail.apiReal(clientId), s, cc, novoResultado(), parseHTML);
    cc.ultima_recolha = new Date().toISOString();
    return r;
  });
  toast(`${res.vagas_novas.length} vagas novas · ${res.duplicadas} duplicadas · ${res.emails_lidos} e-mails lidos${res.nao_reconhecidos ? ` · ${res.nao_reconhecidos} não reconhecidos` : ""}`, 6000);
  res.avisos.slice(0, 2).forEach((a) => toast(a, 6000));
  if (res.vagas_novas.length) await pontuar(res.vagas_novas);
}

export function folhaManual() {
  const f = { cargo: UI.field("Cargo *", { placeholder: "ex.: Analista de Valuation" }), empresa: UI.field("Empresa"), local: UI.field("Localização", { placeholder: "ex.: Lisboa" }),
    link: UI.field("Link da vaga", { placeholder: "https://… (a app não o abre)" }),
    desc: UI.field("Descrição da vaga", { type: "textarea", rows: 6, placeholder: "Cole aqui a descrição completa" }) };
  const completa = verificar("É a descrição completa");
  completa.cb.checked = true;
  const s = UI.sheet("Nova vaga", [
    f.cargo, el("div", { class: "grid-2" }, [f.empresa, f.local]), f.link, f.desc, completa,
    botao("Adicionar vaga", async () => {
      const [id, nova] = mut((st) => inserirManual(st, { cargo: f.cargo.input.value, empresa: f.empresa.input.value, localizacao: f.local.input.value,
        link: f.link.input.value.trim(), descricao: f.desc.input.value, descricao_completa: completa.cb.checked }));
      s.close();
      if (!nova) { toast("Esta vaga já existia."); irPara("vaga", { vagaId: id }); return; }
      toast("Vaga adicionada");
      await pontuar([id]);
      irPara("vaga", { vagaId: id });
    }, "btn btn-primary btn-block btn-lg"),
  ]);
}

function naoReconhecidos(e) {
  const pend = dados.pendentesNaoReconhecidos(e);
  if (!pend.length) return null;
  return el("details", { class: "card warn" }, [
    el("summary", {}, [icone("alert"), `${pend.length} e-mail(s) não reconhecido(s)`, el("span", { class: "spacer" }), el("span", { class: "tiny faint", text: "rever" })]),
    el("p", { class: "tiny muted", style: "margin:8px 0 4px", text: "Estão em Vagas/* mas nenhum parser encontrou vagas. Não foram marcados como processados e serão lidos de novo. Pode inserir as vagas à mão e marcá-los como revistos." }),
    el("div", { class: "list" }, pend.map((p) => el("div", { class: "item" }, [
      el("div", { class: "grow" }, [el("div", { class: "t", text: p.assunto || "(sem assunto)" }), el("div", { class: "s", text: `${p.remetente} · ${p.data_email} · ${p.motivo}` })]),
      botao("Revisto", () => mut((s) => dados.resolverNaoReconhecido(s, p.id)), "btn btn-sm"),
    ]))),
  ]);
}

export function linhaVaga(v, ativa) {
  const atraso = v.data_followup && v.data_followup < UI.todayISO() && ["Candidatado", "Entrevista"].includes(v.estado);
  return el("div", { class: "job" + (ativa ? " on" : ""), onclick: () => irPara("vaga", { vagaId: v.id }) }, [
    avatar(v.empresa || v.cargo),
    el("div", { class: "grow" }, [
      el("div", { class: "t", text: v.cargo }),
      el("div", { class: "m", text: [v.empresa || "Empresa por identificar", v.localizacao].filter(Boolean).join(" · ") }),
      el("div", { class: "chips" }, [
        v.estado !== tracker.POR_CANDIDATAR ? el("span", { class: "chip", style: `color:${FASES[v.estado].cor}` }, [icone(FASES[v.estado].ic), v.estado]) : null,
        v.preliminar ? chip("Preliminar", "outline") : null,
        v.eliminatoria_falhada ? chip("Eliminatório", "bad", "alert") : null,
        atraso ? chip("Follow-up", "warn", "bell") : null,
        el("span", { class: "chip outline", text: `${v.fonte} · ${dataCurta(v.data_recolha)}` }),
      ]),
    ]),
    gauge(v.pontuacao_global, { tam: 44, preliminar: v.preliminar }),
  ]);
}

/** Lista de vagas (também usada no painel esquerdo do ecrã dividido, no PC). */
export function listaVagas() {
  const e = estado(), c = cfg();
  const perfil = perfilValidado(e, c);
  const todas = dados.listarVagas(e);
  const f = ui.filtros;
  const lista = todas.filter((v) => (!f.fonte || v.fonte === f.fonte)
    && (f.estado === "todas" || (f.estado === "ativas" ? v.estado !== tracker.DESCARTADA : v.estado === f.estado))
    && (!f.texto || `${v.cargo} ${v.empresa} ${v.localizacao}`.toLowerCase().includes(f.texto.toLowerCase())));
  const semAnalise = dados.vagasSemAnalise(e);

  const pesquisa = el("input", { type: "search", value: f.texto, placeholder: "Pesquisar vagas", "aria-label": "Pesquisar" });
  pesquisa.addEventListener("change", () => { f.texto = pesquisa.value; guardarUi(); render(); });
  const fonte = el("select", { "aria-label": "Fonte", style: "width:auto;min-height:36px;height:36px;font-size:13px;font-weight:600" },
    [{ value: "", label: "Todas as fontes" }, ...[...FONTES, "Manual"].map((x) => ({ value: x, label: x }))].map((o) => el("option", { value: o.value, selected: o.value === f.fonte, text: o.label })));
  fonte.addEventListener("change", () => { f.fonte = fonte.value; guardarUi(); render(); });
  const filtroEstado = (valor, rotulo) => el("span", { class: "chip click" + (f.estado === valor ? " on" : ""), text: rotulo, onclick: () => { f.estado = valor; guardarUi(); render(); } });

  return el("div", { class: "stack" }, [
    !perfil ? el("div", { class: "card warn tiny row" }, [icone("user"), el("span", { class: "grow", text: "Sem perfil-base validado: as vagas não são pontuadas." }), botao("Validar", () => irPara("perfil"), "btn btn-sm")]) : null,
    naoReconhecidos(e),
    el("div", {}, [
      el("div", { class: "toolbar" }, [el("div", { class: "search" }, [icone("search"), pesquisa]), fonte]),
      el("div", { class: "filters" }, [filtroEstado("ativas", "Ativas"), filtroEstado("Por candidatar", "Por candidatar"), filtroEstado("Candidatado", "Candidatadas"),
        filtroEstado("Entrevista", "Entrevista"), filtroEstado("Descartada", "Descartadas"), filtroEstado("todas", "Todas")]),
    ]),
    semAnalise.length ? el("div", { class: "row tiny muted" }, [el("span", { class: "grow", text: `${semAnalise.length} vaga(s) ainda sem pontuação.` }),
      botao("Pontuar agora", async () => { const n = await pontuar(semAnalise); if (n) toast(`${n} vagas pontuadas`); }, "btn btn-sm btn-soft", { icone: "target" })]) : null,
    el("div", { class: "card flush" }, [lista.length ? el("div", { class: "jobs" }, lista.map((v) => linhaVaga(v, v.id === ui.vagaId && ui.tab === "vaga")))
      : todas.length ? el("div", { class: "empty", style: "padding:28px", text: "Nenhuma vaga com estes filtros." })
        : vazio("briefcase", "Ainda não há vagas", "Recolha os alertas do Gmail ou adicione uma vaga à mão.", [
          botao("Recolher do Gmail", recolherGmail, "btn btn-primary", { icone: "inbox" }), botao("Adicionar vaga", folhaManual, "btn", { icone: "plus" })])]),
    el("p", { class: "tiny faint center", text: `${lista.length} de ${todas.length} vagas · ordenadas pela compatibilidade` }),
  ].filter(Boolean));
}

export function vistaVagas() {
  return {
    titulo: "Vagas", sub: "Ordenadas pela compatibilidade com o seu perfil",
    acoes: [botao("Recolher", recolherGmail, "btn btn-sm only-desktop", { icone: "inbox" }), botao("Nova vaga", folhaManual, "btn btn-sm btn-primary only-desktop", { icone: "plus" }),
      botao("", recolherGmail, "btn btn-icon btn-ghost only-mobile", { icone: "inbox", title: "Recolher do Gmail", "aria-label": "Recolher do Gmail" })],
    fab: folhaManual,
    corpo: listaVagas(),
  };
}

