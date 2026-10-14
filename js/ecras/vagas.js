/* Ecrã Vagas: lista ordenada por pontuação, recolha do Gmail, inserção manual, filtros. */
import { AVISO, analisarVaga } from "../compat.js";
import { FONTES } from "../config.js";
import * as dados from "../dados.js";
import * as gmail from "../gmail.js";
import { perfilValidado } from "../perfil.js";
import { inserirManual, novoResultado } from "../recolha.js";
import * as tracker from "../tracker.js";
import { botao, card, cfg, classeScore, el, estado, guardarUi, irPara, mut, mutAsync, parseHTML, render, toast, ui } from "./comum.js";

export async function pontuar(ids) {
  const e = estado(), c = cfg();
  const perfil = perfilValidado(e, c);
  if (!perfil) { toast("Valide o perfil-base (separador Perfil) para as vagas serem pontuadas.", 4000); return 0; }
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

async function recolherGmail() {
  const c = cfg();
  const clientId = clientIdGoogle(c);
  if (!clientId) { toast("Configure o Gmail nas Definições (⚙︎) primeiro.", 4000); return; }
  toast("A ler os alertas do Gmail…");
  const res = await mutAsync((s, cc) => gmail.recolher(gmail.apiReal(clientId), s, cc, novoResultado(), parseHTML));
  toast(`${res.emails_lidos} e-mails lidos · ${res.vagas_novas.length} vagas novas · ${res.duplicadas} duplicadas · ${res.nao_reconhecidos} não reconhecidos`, 6000);
  res.avisos.slice(0, 3).forEach((a) => toast(a, 6000));
  if (res.vagas_novas.length) await pontuar(res.vagas_novas);
}

function folhaManual() {
  const f = { cargo: UI.field("Cargo *"), empresa: UI.field("Empresa"), local: UI.field("Localização"),
    link: UI.field("Link da vaga (a app não o abre)", { placeholder: "https://…" }),
    desc: UI.field("Descrição da vaga (colar)", { type: "textarea", rows: 6 }) };
  const completa = el("input", { type: "checkbox", checked: true });
  const s = UI.sheet("Adicionar vaga", [
    f.cargo, f.empresa, f.local, f.link, f.desc,
    el("label", { class: "row tiny", style: "gap:8px" }, [completa, el("span", { text: "É a descrição completa" })]),
    botao("Adicionar", async () => {
      const [id, nova] = mut((st) => inserirManual(st, { cargo: f.cargo.input.value, empresa: f.empresa.input.value, localizacao: f.local.input.value,
        link: f.link.input.value.trim(), descricao: f.desc.input.value, descricao_completa: completa.checked }));
      s.close();
      if (!nova) { toast("Esta vaga já existia."); irPara("vaga", { vagaId: id }); return; }
      toast("Vaga adicionada ✓");
      await pontuar([id]);
      irPara("vaga", { vagaId: id });
    }, "btn btn-primary btn-block"),
  ]);
}

function naoReconhecidos(e) {
  const pend = dados.pendentesNaoReconhecidos(e);
  if (!pend.length) return null;
  const det = el("details", { class: "card aviso" }, [
    el("summary", { style: "cursor:pointer;font-weight:650", text: `⚠️ ${pend.length} e-mail(s) não reconhecido(s) — rever` }),
    el("p", { class: "tiny muted", text: "Estes e-mails estão em Vagas/* mas nenhum parser encontrou vagas. Não foram marcados como processados e serão lidos de novo. Pode inserir as vagas à mão e marcá-los como revistos." }),
    el("div", { class: "list" }, pend.map((p) => el("div", { class: "item" }, [
      el("div", { class: "grow" }, [el("div", { class: "t wrap", text: p.assunto || "(sem assunto)" }), el("div", { class: "s", text: `${p.remetente} · ${p.data_email} · ${p.fonte} · ${p.motivo}` })]),
      botao("Revisto", () => mut((s) => dados.resolverNaoReconhecido(s, p.id)), "btn btn-sm"),
    ]))),
  ]);
  return det;
}

export function vistaVagas() {
  const e = estado(), c = cfg();
  const perfil = perfilValidado(e, c);
  const todas = dados.listarVagas(e);
  const f = ui.filtros;
  const lista = todas.filter((v) => (!f.fonte || v.fonte === f.fonte)
    && (f.estado === "todas" || (f.estado === "ativas" ? v.estado !== tracker.DESCARTADA : v.estado === f.estado))
    && (!f.texto || `${v.cargo} ${v.empresa} ${v.localizacao}`.toLowerCase().includes(f.texto.toLowerCase())));
  const semAnalise = dados.vagasSemAnalise(e);

  const filtro = (rotulo, chave, opcoes) => {
    const s = UI.field(rotulo, { type: "select", value: f[chave], options: opcoes });
    s.input.addEventListener("change", () => { f[chave] = s.input.value; guardarUi(); render(); });
    return s;
  };
  const pesquisa = UI.field("Pesquisar", { value: f.texto, placeholder: "cargo, empresa, local…" });
  pesquisa.input.addEventListener("change", () => { f.texto = pesquisa.input.value; guardarUi(); render(); });

  const itens = lista.map((v) => el("div", { class: "item", style: "cursor:pointer", onclick: () => irPara("vaga", { vagaId: v.id }) }, [
    el("div", { class: classeScore(v.pontuacao_global, v.preliminar), title: v.preliminar ? "Pontuação preliminar" : "Pontuação", text: v.pontuacao_global ?? "—" }),
    el("div", { class: "grow" }, [
      el("div", { class: "t", text: v.cargo }),
      el("div", { class: "s", text: [v.empresa || "?", v.localizacao, v.fonte].filter(Boolean).join(" · ") }),
      el("div", {}, [
        el("span", { class: "tag", text: v.estado }),
        v.preliminar ? el("span", { class: "tag", text: "preliminar" }) : null,
        v.eliminatoria_falhada ? el("span", { class: "tag bad", text: "requisito eliminatório" }) : null,
        v.data_followup && v.data_followup < UI.todayISO() && ["Candidatado", "Entrevista"].includes(v.estado) ? el("span", { class: "tag warn", text: "follow-up em atraso" }) : null,
      ]),
    ]),
  ]));

  return el("div", { class: "stack" }, [
    el("div", { class: "row", style: "gap:8px;flex-wrap:wrap;margin-top:8px" }, [
      botao("↓ Recolher do Gmail", recolherGmail, "btn btn-primary"),
      botao("+ Vaga manual", folhaManual, "btn"),
      semAnalise.length ? botao(`Pontuar ${semAnalise.length} sem análise`, async () => { const n = await pontuar(semAnalise); if (n) toast(`${n} vagas pontuadas ✓`); }, "btn btn-soft") : null,
    ]),
    !perfil ? card(null, [el("div", { class: "tiny", html: "Ainda não há perfil-base validado: as vagas não são pontuadas. Abra o separador <b>Perfil</b>." })], { class: "aviso" }) : null,
    naoReconhecidos(e),
    card(null, [el("div", { class: "grid-3", style: "gap:8px" }, [
      filtro("Fonte", "fonte", [{ value: "", label: "Todas" }, ...FONTES, "Manual"].map((o) => (typeof o === "string" ? { value: o, label: o } : o))),
      filtro("Estado", "estado", [{ value: "ativas", label: "Ativas" }, { value: "todas", label: "Todas" }, ...tracker.ESTADOS.map((s) => ({ value: s, label: s }))]),
      pesquisa,
    ])]),
    el("p", { class: "tiny muted", text: `${lista.length} de ${todas.length} vagas · ${AVISO}` }),
    card(null, [itens.length ? el("div", { class: "list" }, itens) : el("div", { class: "empty", text: todas.length ? "Nenhuma vaga com estes filtros." : "Ainda não há vagas. Recolha-as do Gmail ou adicione uma à mão." })]),
  ].filter(Boolean));
}
