/* Ecrã Detalhe da vaga: descrição, pontuação decomposta, requisitos cumpridos e lacunas, gerar CV/carta. */
import { AVISO, analisarVaga } from "../compat.js";
import { NOMES_DIMENSOES, pesosNormalizados } from "../config.js";
import { criarRascunho } from "../cv.js";
import * as dados from "../dados.js";
import { indexar, perfilValidado } from "../perfil.js";
import * as tracker from "../tracker.js";
import { botao, card, cfg, classeScore, el, estado, irPara, linhaInfo, mut, mutAsync, toast, ui } from "./comum.js";

function folhaEditar(v) {
  const f = { cargo: UI.field("Cargo", { value: v.cargo }), empresa: UI.field("Empresa", { value: v.empresa }), local: UI.field("Localização", { value: v.localizacao }) };
  const s = UI.sheet("Corrigir dados da vaga", [f.cargo, f.empresa, f.local,
    botao("Guardar", () => { mut((st) => dados.atualizarVaga(st, v.id, { cargo: f.cargo.input.value.trim() || v.cargo, empresa: f.empresa.input.value.trim(), localizacao: f.local.input.value.trim() })); s.close(); }, "btn btn-primary btn-block"),
    botao("Apagar vaga", async () => {
      if (!(await UI.confirm("Apagar esta vaga, as análises e os CVs dela?", { ok: "Apagar", danger: true }))) return;
      mut((st) => dados.apagarVaga(st, v.id)); s.close(); irPara("vagas", { vagaId: null });
    }, "btn btn-ghost btn-block"),
  ]);
}

function listaRequisitos(reqs, idx, vazio) {
  if (!reqs.length) return el("div", { class: "empty tiny", text: vazio });
  return el("div", { class: "list" }, reqs.map((r) => el("div", { class: "item" }, [el("div", { class: "grow" }, [
    el("div", { class: "t wrap", text: r.descricao }),
    el("div", {}, [r.obrigatorio ? el("span", { class: "tag", text: "obrigatório" }) : null, r.eliminatorio ? el("span", { class: "tag bad", text: "eliminatório" }) : null]),
    r.evidencia_ids.length ? el("div", { class: "s wrap", text: "Evidência: " + r.evidencia_ids.map((i) => (idx.has(i) ? `${idx.get(i).texto.slice(0, 70)}` : i)).join(" · ") }) : null,
    r.justificacao ? el("div", { class: "s wrap", text: r.justificacao }) : null,
  ])])));
}

export function vistaVaga() {
  const e = estado(), c = cfg();
  const v = ui.vagaId && dados.obterVaga(e, ui.vagaId);
  if (!v) return card(null, [el("div", { class: "empty", text: "Escolha uma vaga no separador Vagas." })]);
  const perfil = perfilValidado(e, c);
  const a = dados.ultimaAnalise(e, v.id);
  const idx = perfil ? indexar(perfil) : new Map();

  const desc = UI.field(v.descricao_completa ? "Descrição completa" : "Descrição (só o resumo do alerta — cole aqui a descrição completa)", { type: "textarea", value: v.descricao, rows: 9 });
  const completa = el("input", { type: "checkbox", checked: true });

  async function analisar(usarLLM) {
    if (!perfil) { toast("Valide primeiro o perfil-base (separador Perfil)."); return; }
    toast("A analisar…");
    const r = await analisarVaga(c, perfil, dados.obterVaga(estado(), v.id), { usarLLM });
    mut((s) => dados.guardarAnalise(s, v.id, r, perfil.versao));
  }

  let pesos = {};
  try { pesos = pesosNormalizados(c); } catch (err) { /* soma 0: avisado nas Definições */ }

  const compat = a ? card("Compatibilidade", [
    el("p", { class: "tiny muted", text: AVISO }),
    el("div", { class: "row", style: "gap:14px;margin:8px 0" }, [
      el("div", { class: classeScore(a.pontuacao_global, a.preliminar), style: "width:64px;height:64px;font-size:1.5rem", text: a.pontuacao_global }),
      el("div", {}, [el("div", { style: "font-weight:700", text: a.preliminar ? "Pontuação preliminar" : "Pontuação final" }),
        el("div", { class: "tiny muted", text: `${a.metodo === "llm" ? "Modelo local" : "Regras"} · perfil v${a.versao_perfil} · ${String(a.data).replace("T", " ").slice(0, 16)}` })]),
    ]),
    a.eliminatoria_falhada ? el("div", { class: "tag bad", text: `Requisito eliminatório em falta: limitada a ${c.compatibilidade.limite_eliminatoria}` }) : null,
    a.resumo ? el("p", { text: a.resumo }) : null,
    ...Object.keys(NOMES_DIMENSOES).map((d) => {
      const val = a.subpontuacoes[d];
      return el("div", { class: "dim" }, [el("div", {}, [el("div", { text: NOMES_DIMENSOES[d] }), val == null ? el("div", { class: "tiny muted", text: "sem dados na vaga" }) : UI.bar(val, val >= 70 ? "good" : val >= 50 ? "warn" : "bad")]),
        el("span", { class: "tiny muted", text: `${Math.round((pesos[d] || 0) * 100)}%` }), el("strong", { text: val == null ? "—" : val })]);
    }),
    el("div", { class: "section-title", text: `Requisitos cumpridos (${a.requisitos_cumpridos.length})` }), listaRequisitos(a.requisitos_cumpridos, idx, "Nenhum."),
    el("div", { class: "section-title", text: `Lacunas (${a.lacunas.length})` }), listaRequisitos(a.lacunas, idx, "Nenhuma detetada."),
    botao("Repetir a análise", () => analisar(), "btn btn-block", { style: "margin-top:10px" }),
  ]) : card("Compatibilidade", [el("div", { class: "empty tiny", text: perfil ? "Ainda sem análise." : "Valide o perfil-base para analisar." }), perfil ? botao("Analisar agora", () => analisar(), "btn btn-primary btn-block") : null]);

  const idioma = UI.field("Idioma do CV", { type: "select", value: c.cv.idioma, options: [{ value: "pt", label: "Português" }, { value: "en", label: "Inglês" }, { value: "fr", label: "Francês" }] });
  const gerar = (tipo) => async () => {
    if (!perfil) { toast("Valide primeiro o perfil-base (separador Perfil)."); return; }
    toast("A gerar e a validar…");
    const id = await mutAsync((s, cc) => criarRascunho(s, cc, v.id, { tipo, idioma: idioma.input.value }));
    irPara("cv", { cvId: id, cvTab: "lado" });
  };
  const docs = dados.listarCvs(e, { vagaId: v.id });

  return el("div", { class: "stack" }, [
    card(null, [
      el("div", { class: "row", style: "gap:12px;align-items:flex-start" }, [
        el("div", { class: "grow" }, [el("h2", { style: "margin:0 0 4px;font-size:1.2rem", text: v.cargo }), el("div", { class: "muted", text: [v.empresa || "?", v.localizacao].filter(Boolean).join(" · ") })]),
        botao("Editar", () => folhaEditar(v), "btn btn-sm btn-ghost"),
      ]),
      linhaInfo("Fonte", v.fonte), linhaInfo("Publicada", v.data_publicacao), linhaInfo("Estado", v.estado),
      el("div", { class: "row", style: "gap:8px;margin-top:10px;flex-wrap:wrap" }, [
        v.link_canonico || v.link_original ? el("a", { class: "btn btn-soft", href: v.link_canonico || v.link_original, target: "_blank", rel: "noopener", text: "Abrir a vaga ↗" }) : null,
        tracker.transicoesPossiveis(v.estado).includes(tracker.DESCARTADA) ? botao("Descartar", () => mut((s, cc) => tracker.mudarEstado(s, cc, v.id, tracker.DESCARTADA)), "btn btn-ghost") : null,
        botao("Tracker", () => irPara("tracker"), "btn btn-ghost"),
      ]),
    ]),
    card("Descrição", [
      !v.descricao_completa ? el("p", { class: "tiny", text: "Esta vaga só tem o resumo do alerta: a pontuação é preliminar. Cole a descrição completa da página da vaga." }) : null,
      desc,
      el("label", { class: "row tiny", style: "gap:8px;margin:6px 0" }, [completa, el("span", { text: "É a descrição completa" })]),
      botao("Guardar e analisar", async () => {
        mut((s) => dados.atualizarVaga(s, v.id, { descricao: desc.input.value, descricao_completa: completa.checked }));
        await analisar();
      }, "btn btn-primary btn-block"),
    ]),
    compat,
    card("CV adaptado e carta", [
      !v.descricao_completa ? el("p", { class: "tiny muted", text: "Recomenda-se colar a descrição completa antes de gerar o CV." }) : null,
      idioma,
      el("div", { class: "row", style: "gap:8px;margin-top:8px" }, [botao("Gerar CV adaptado", gerar("cv"), "btn btn-primary btn-block"), botao("Gerar carta", gerar("carta"), "btn btn-block")]),
      docs.length ? el("div", { class: "list", style: "margin-top:10px" }, docs.map((d) => el("div", { class: "item", style: "cursor:pointer", onclick: () => irPara("cv", { cvId: d.id }) }, [
        el("div", { class: "grow" }, [el("div", { class: "t", text: `${d.tipo === "carta" ? "Carta" : "CV"} · ${d.estado}` }), el("div", { class: "s", text: `perfil v${d.versao_perfil} · ${String(d.data_criacao).replace("T", " ").slice(0, 16)}` })]),
        el("span", { class: "tag " + (d.estado === "aprovado" ? "good" : d.estado === "rejeitado" ? "bad" : ""), text: d.estado }),
      ]))) : null,
    ]),
  ].filter(Boolean));
}

