/* Ecrã Início: painel em grelha "bento" — o que fazer hoje, indicadores e melhores correspondências. */
import * as dados from "../dados.js";
import { perfilValidado } from "../perfil.js";
import * as tracker from "../tracker.js";
import { avatar, botao, card, cfg, dataCurta, el, estado, FASES, gauge, icone, irPara } from "./comum.js";
import { folhaManual, recolherGmail } from "./vagas.js";

function saudacao() {
  const h = new Date().getHours();
  return h < 6 ? "Boa noite" : h < 13 ? "Bom dia" : h < 20 ? "Boa tarde" : "Boa noite";
}

const kpi = (ic, k, v, d) => el("div", { class: "kpi" }, [el("div", { class: "k" }, [icone(ic), k]), el("div", { class: "v", text: v }), d ? el("div", { class: "d", text: d }) : null]);

function todo(ic, tom, t, s, onclick) {
  return el("div", { class: "todo", onclick }, [el("div", { class: "ic " + tom }, [icone(ic)]), el("div", { class: "grow" }, [el("div", { class: "t", text: t }), s ? el("div", { class: "s", text: s }) : null]), icone("right")]);
}

export function vistaInicio() {
  const e = estado(), c = cfg();
  const perfil = perfilValidado(e, c);
  const vagas = dados.listarVagas(e);
  const m = tracker.metricas(e, c);
  const atraso = tracker.followupsEmAtraso(e);
  const pend = dados.pendentesNaoReconhecidos(e);
  const rascunhos = dados.listarCvs(e, { estado: "rascunho" });
  const primeiro = ((perfil && perfil.dados_pessoais.nome) || "").split(" ")[0];
  const ativas = vagas.filter((v) => v.estado !== tracker.DESCARTADA);
  const novas = vagas.filter((v) => String(v.data_recolha).slice(0, 10) === UI.todayISO()).length;

  // Próximos passos: primeiro a configuração em falta, depois o trabalho do dia.
  const passos = [];
  if (!perfil) passos.push(todo("user", "brand", "Validar o perfil-base", "Importe o CV e valide-o: é a fonte de verdade dos CVs.", () => irPara("perfil")));
  if (!c.cv.modelo_aprovado) passos.push(todo("file", "brand", "Aprovar o formato do CV", "Uma vez, nas Definições. Sem isto não há exportação.", () => document.getElementById("btnDefinicoes").click()));
  if (!Object.values(c.gmail.remetentes).some((l) => l.length)) passos.push(todo("mail", "brand", "Ligar o Gmail", "Confirme os remetentes dos alertas e crie os filtros.", () => document.getElementById("btnDefinicoes").click()));
  atraso.slice(0, 3).forEach((v) => passos.push(todo("bell", "warn", `Follow-up: ${v.empresa || v.cargo}`, `${v.cargo} · previsto ${dataCurta(v.data_followup)}`, () => irPara("vaga", { vagaId: v.id }))));
  rascunhos.slice(0, 2).forEach((d) => { const v = dados.obterVaga(e, d.vaga_id) || {}; passos.push(todo("shield", "", `Rever ${d.tipo === "carta" ? "carta" : "CV"} por aprovar`, `${v.cargo || ""} — ${v.empresa || ""}`, () => irPara("cv", { cvId: d.id }))); });
  if (pend.length) passos.push(todo("alert", "bad", `${pend.length} e-mail(s) não reconhecido(s)`, "Reveja-os na lista de vagas.", () => irPara("vagas")));

  const top = ativas.filter((v) => v.pontuacao_global != null && v.estado === tracker.POR_CANDIDATAR).slice(0, 5);
  const totalFunil = tracker.ESTADOS.reduce((a, s) => a + m.por_estado[s], 0);

  const hero = el("div", { class: "hero span-2" }, [
    el("div", { class: "eyebrow", text: new Date().toLocaleDateString("pt-PT", { weekday: "long", day: "numeric", month: "long" }) }),
    el("h2", { text: `${saudacao()}${primeiro ? ", " + primeiro : ""}` }),
    el("p", { text: ativas.length ? `${ativas.length} vagas ativas${novas ? ` · ${novas} recolhidas hoje` : ""}${c.ultima_recolha ? ` · última recolha ${dataCurta(c.ultima_recolha)}` : ""}.` : "Comece por recolher os alertas do Gmail ou por adicionar uma vaga." }),
    el("div", { class: "row wrap-row", style: "margin-top:16px" }, [
      botao("Recolher do Gmail", recolherGmail, "btn btn-on-dark", { icone: "inbox" }),
      botao("Adicionar vaga", folhaManual, "btn btn-glass", { icone: "plus" }),
    ]),
    el("div", { class: "pattern", html: '<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="1.2"><rect width="20" height="14" x="2" y="6" rx="2"/><path d="M16 20V4a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/></svg>' }),
  ]);

  const funil = card("Pipeline", [
    el("div", { class: "funnel" }, [tracker.POR_CANDIDATAR, tracker.CANDIDATADO, tracker.ENTREVISTA, tracker.OFERTA, tracker.REJEITADO, tracker.DESCARTADA].filter((s) => m.por_estado[s]).map((s) => el("i", { style: `width:${(100 * m.por_estado[s]) / Math.max(1, totalFunil)}%;background:${FASES[s].cor}`, title: `${s}: ${m.por_estado[s]}` }))),
    el("div", { class: "legend" }, [tracker.POR_CANDIDATAR, tracker.CANDIDATADO, tracker.ENTREVISTA, tracker.OFERTA, tracker.REJEITADO, tracker.DESCARTADA].map((s) => el("span", {}, [el("i", { class: "dot", style: `background:${FASES[s].cor}` }), `${FASES[s].curto} ${m.por_estado[s]}`]))),
  ], { icone: "kanban", acoes: [botao("Abrir", () => irPara("pipeline"), "btn btn-sm btn-ghost", { icone: "right" })], class: "span-2" });

  const corpo = el("div", { class: "stack" }, [
    el("div", { class: "bento" }, [
      hero,
      el("div", { class: "span-2", style: "display:grid;gap:14px" }, [
        el("div", { class: "kpis", style: "grid-template-columns:repeat(2,1fr)" }, [
          kpi("briefcase", "Vagas ativas", ativas.length, `${m.por_estado[tracker.POR_CANDIDATAR]} por candidatar`),
          kpi("send", "Candidaturas", m.candidaturas, `${m.aguardam_resposta} a aguardar resposta`),
          kpi("trend", "Taxa de resposta", m.taxa_resposta == null ? "—" : Math.round(m.taxa_resposta * 100) + "%", "entrevista, rejeição ou oferta"),
          kpi("chat", "Entrevistas", m.entrevistas, `${m.por_estado.Oferta} oferta(s)`),
        ]),
      ]),
      card("Próximos passos", passos.length ? [el("div", {}, passos)] : [el("div", { class: "empty", text: "Tudo em dia." })], { icone: "check", class: "span-2", sub: passos.length ? `${passos.length} por fazer` : "" }),
      card("Melhores correspondências", top.length ? [el("div", { class: "jobs", style: "margin:0 -18px -18px" }, top.map((v) => el("div", { class: "job", onclick: () => irPara("vaga", { vagaId: v.id }) }, [
        avatar(v.empresa || v.cargo), el("div", { class: "grow" }, [el("div", { class: "t", text: v.cargo }), el("div", { class: "m", text: [v.empresa, v.localizacao].filter(Boolean).join(" · ") })]),
        gauge(v.pontuacao_global, { tam: 40, preliminar: v.preliminar }),
      ])))] : [el("div", { class: "empty", text: perfil ? "Ainda não há vagas pontuadas por candidatar." : "Valide o perfil para pontuar as vagas." })],
      { icone: "target", class: "span-2", acoes: [botao("Ver todas", () => irPara("vagas"), "btn btn-sm btn-ghost", { icone: "right" })] }),
      funil,
    ]),
    el("p", { class: "tiny faint center", style: "margin-top:4px", text: "A pontuação mede a adequação do perfil aos requisitos da vaga. Não é uma probabilidade de contratação." }),
  ]);
  return { titulo: "Início", sub: null, corpo };
}

