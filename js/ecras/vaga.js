/* Ecrã Detalhe da vaga: cabeçalho, progresso da candidatura, compatibilidade decomposta,
   descrição, requisitos/lacunas e geração do CV/carta. */
import { AVISO, analisarVaga } from "../compat.js";
import { NOMES_DIMENSOES, pesosNormalizados } from "../config.js";
import { criarRascunho } from "../cv.js";
import * as dados from "../dados.js";
import { indexar, perfilValidado } from "../perfil.js";
import * as tracker from "../tracker.js";
import { avatar, botao, card, cfg, chip, dataCurta, el, estado, FASES, gauge, icone, irPara, mut, mutAsync, toast, tomScore, ui, vazio, verificar } from "./comum.js";
import { folhaEstado } from "./pipeline.js";

function folhaEditar(v) {
  const f = { cargo: UI.field("Cargo", { value: v.cargo }), empresa: UI.field("Empresa", { value: v.empresa }), local: UI.field("Localização", { value: v.localizacao }) };
  const s = UI.sheet("Editar vaga", [f.cargo, el("div", { class: "grid-2" }, [f.empresa, f.local]),
    botao("Guardar", () => { mut((st) => dados.atualizarVaga(st, v.id, { cargo: f.cargo.input.value.trim() || v.cargo, empresa: f.empresa.input.value.trim(), localizacao: f.local.input.value.trim() })); s.close(); }, "btn btn-primary btn-block btn-lg"),
    botao("Apagar vaga", async () => {
      if (!(await UI.confirm("Apagar esta vaga, as análises e os CVs dela?", { ok: "Apagar", danger: true }))) return;
      mut((st) => dados.apagarVaga(st, v.id)); s.close(); irPara("vagas", { vagaId: null });
    }, "btn btn-ghost btn-block btn-danger", { icone: "trash" }),
  ]);
}

function stepper(v) {
  const ordem = [tracker.POR_CANDIDATAR, tracker.CANDIDATADO, tracker.ENTREVISTA, tracker.OFERTA];
  const fim = [tracker.REJEITADO, tracker.DESCARTADA].includes(v.estado);
  const atual = fim ? (v.data_entrevista ? 2 : v.data_candidatura ? 1 : 0) : ordem.indexOf(v.estado);
  return el("div", { class: "stepper" }, ordem.map((s, i) => {
    let cls = i < atual ? "done" : i === atual ? (fim ? "done" : "cur") : "";
    if (fim && i === atual + 1) cls = "end";
    const rot = fim && i === atual + 1 ? v.estado : FASES[s].curto;
    return el("div", { class: "st " + cls }, [el("div", { class: "b" }, cls === "done" ? [icone("check")] : cls === "end" ? [icone("x")] : []), el("span", { text: rot })]);
  }));
}

function requisito(r, idx, ok) {
  return el("div", { class: "req" }, [
    el("div", { class: "ic " + (ok ? "ok" : "no") }, [icone(ok ? "check" : "x")]),
    el("div", { class: "grow" }, [
      el("div", { class: "row", style: "gap:6px;flex-wrap:wrap" }, [el("span", { class: "t", text: r.descricao }), r.eliminatorio ? chip("Eliminatório", "bad") : r.obrigatorio ? chip("Obrigatório", "outline") : null]),
      r.evidencia_ids.length ? el("div", { class: "e", text: r.evidencia_ids.map((i) => (idx.has(i) ? idx.get(i).texto.slice(0, 80) : i)).join(" · ") }) : r.justificacao ? el("div", { class: "e", text: r.justificacao }) : null,
    ]),
  ]);
}

export function vistaVaga() {
  const e = estado(), c = cfg();
  const v = ui.vagaId && dados.obterVaga(e, ui.vagaId);
  if (!v) return { titulo: "Vaga", corpo: el("div", { class: "card" }, [vazio("briefcase", "Escolha uma vaga", "Selecione uma vaga na lista para ver a compatibilidade e gerar o CV.")]) };
  const perfil = perfilValidado(e, c);
  const a = dados.ultimaAnalise(e, v.id);
  const idx = perfil ? indexar(perfil) : new Map();
  let pesos = {};
  try { pesos = pesosNormalizados(c); } catch (err) { /* soma 0: avisado nas Definições */ }

  async function analisar() {
    if (!perfil) { toast("Valide primeiro o perfil-base."); return; }
    toast("A analisar…");
    const r = await analisarVaga(c, perfil, dados.obterVaga(estado(), v.id));
    mut((s) => dados.guardarAnalise(s, v.id, r, perfil.versao));
  }
  const gerar = (tipo, idioma) => async () => {
    if (!perfil) { toast("Valide primeiro o perfil-base."); return; }
    toast(tipo === "carta" ? "A escrever a carta…" : "A adaptar o CV…");
    const id = await mutAsync((s, cc) => criarRascunho(s, cc, v.id, { tipo, idioma: idioma || c.cv.idioma }));
    irPara("cv", { cvId: id, cvTab: "lado" });
  };

  const link = v.link_canonico || v.link_original;
  const cabecalho = el("div", { class: "card" }, [
    el("div", { class: "detail-head" }, [
      avatar(v.empresa || v.cargo, "lg"),
      el("div", { class: "grow" }, [el("h2", { text: v.cargo }), el("div", { class: "co", text: v.empresa || "Empresa por identificar" }),
        el("div", { class: "meta", style: "margin-top:8px" }, [
          v.localizacao ? el("span", {}, [icone("pin"), v.localizacao]) : null,
          el("span", {}, [icone("globe"), v.fonte]),
          v.data_publicacao ? el("span", {}, [icone("calendar"), dataCurta(v.data_publicacao)]) : null,
        ])]),
      botao("", () => folhaEditar(v), "btn btn-icon btn-ghost", { icone: "pencil", title: "Editar", "aria-label": "Editar vaga" }),
    ]),
    stepper(v),
    el("div", { class: "row wrap-row", style: "margin-top:16px" }, [
      link ? el("a", { class: "btn btn-sm", href: link, target: "_blank", rel: "noopener" }, [icone("external"), "Ver anúncio"]) : null,
      botao("Atualizar estado", () => folhaEstado(v), "btn btn-sm", { icone: "kanban" }),
      tracker.transicoesPossiveis(v.estado).includes(tracker.DESCARTADA) ? botao("Descartar", () => mut((s, cc) => tracker.mudarEstado(s, cc, v.id, tracker.DESCARTADA)), "btn btn-sm btn-ghost", { icone: "archive" }) : null,
    ]),
  ]);

  const compat = a ? card("Compatibilidade", [
    el("div", { class: "score-panel" }, [
      gauge(a.pontuacao_global, { tam: 108, preliminar: a.preliminar, rotulo: a.preliminar ? "preliminar" : "de 100" }),
      el("div", { class: "grow stack-sm" }, [
        el("div", { class: "chips" }, [chip(a.metodo === "llm" ? "Modelo local" : "Regras", "outline"), chip(`Perfil v${a.versao_perfil}`, "outline"),
          a.eliminatoria_falhada ? chip(`Limitada a ${c.compatibilidade.limite_eliminatoria}`, "bad", "alert") : null]),
        a.resumo ? el("p", { class: "small", text: a.resumo }) : null,
      ]),
    ]),
    el("div", { class: "section", text: "Por dimensão" }),
    el("div", { class: "dims" }, Object.keys(NOMES_DIMENSOES).map((d) => {
      const val = a.subpontuacoes[d];
      return el("div", { class: "dim" + (val == null ? " none" : "") }, [el("span", { class: "n", text: NOMES_DIMENSOES[d] }),
        el("span", { class: "w", text: `${val == null ? "sem dados" : val} · peso ${Math.round((pesos[d] || 0) * 100)}%` }),
        el("div", { class: "track" }, [val == null ? null : el("i", { class: tomScore(val), style: `width:${val}%` })])]);
    })),
    el("p", { class: "tiny faint", style: "margin-top:14px", text: AVISO }),
  ], { icone: "target", sub: `Atualizada ${dataCurta(a.data)}`, acoes: [botao("", analisar, "btn btn-sm btn-ghost btn-icon", { icone: "refresh", title: "Repetir a análise", "aria-label": "Repetir a análise" })] })
    : card("Compatibilidade", [vazio("target", perfil ? "Ainda sem análise" : "Perfil por validar", perfil ? "Analise a vaga para ver os requisitos cumpridos e as lacunas." : "Valide o perfil-base para pontuar as vagas.",
      [perfil ? botao("Analisar agora", analisar, "btn btn-primary", { icone: "target" }) : botao("Ir para o perfil", () => irPara("perfil"), "btn btn-primary")])]);

  const reqs = a ? el("div", { class: "bento", style: "grid-template-columns:repeat(auto-fit,minmax(280px,1fr))" }, [
    card(`Cumpre (${a.requisitos_cumpridos.length})`, [a.requisitos_cumpridos.length ? el("div", {}, a.requisitos_cumpridos.map((r) => requisito(r, idx, true))) : el("div", { class: "empty", text: "Nenhum requisito cumprido detetado." })], { icone: "checkCircle" }),
    card(`Lacunas (${a.lacunas.length})`, [a.lacunas.length ? el("div", {}, a.lacunas.map((r) => requisito(r, idx, false))) : el("div", { class: "empty", text: "Nenhuma lacuna detetada." })], { icone: "alert" }),
  ]) : null;

  const desc = el("textarea", { rows: 10, "aria-label": "Descrição da vaga", placeholder: "Cole aqui a descrição completa da página da vaga" });
  desc.value = v.descricao || "";
  const completa = verificar("É a descrição completa"); completa.cb.checked = true;
  const descricao = card("Descrição", [
    !v.descricao_completa ? el("div", { class: "card tint tiny row", style: "margin-bottom:12px;padding:12px" }, [icone("alert"), el("span", { text: "Só tem o resumo do alerta: a pontuação é preliminar. Cole a descrição completa." })]) : null,
    desc, el("div", { class: "row", style: "margin-top:12px;justify-content:space-between;flex-wrap:wrap" }, [completa,
      botao("Guardar e analisar", async () => { mut((s) => dados.atualizarVaga(s, v.id, { descricao: desc.value, descricao_completa: completa.cb.checked })); await analisar(); }, "btn btn-sm btn-primary")]),
  ], { icone: "file", sub: v.descricao_completa ? "Completa" : "Resumo do alerta" });

  const docs = dados.listarCvs(e, { vagaId: v.id });
  const idioma = el("select", { "aria-label": "Idioma", style: "width:auto;min-height:36px;height:36px;font-size:13px" },
    [["pt", "Português"], ["en", "Inglês"], ["fr", "Francês"]].map(([k, t]) => el("option", { value: k, selected: k === c.cv.idioma, text: t })));
  const documentos = card("CV e carta", [
    el("div", { class: "row wrap-row" }, [idioma, botao("Gerar CV adaptado", () => gerar("cv", idioma.value)(), "btn btn-sm btn-primary", { icone: "file" }), botao("Gerar carta", () => gerar("carta", idioma.value)(), "btn btn-sm", { icone: "mail" })]),
    docs.length ? el("div", { class: "list", style: "margin-top:10px" }, docs.map((d) => el("div", { class: "item click", onclick: () => irPara("cv", { cvId: d.id }) }, [
      el("div", { class: "todo", style: "border:0;padding:0" }, [el("div", { class: "ic " + (d.estado === "aprovado" ? "brand" : "") }, [icone(d.tipo === "carta" ? "mail" : "file")])]),
      el("div", { class: "grow" }, [el("div", { class: "t", text: d.tipo === "carta" ? "Carta de apresentação" : "CV adaptado" }), el("div", { class: "s", text: `Perfil v${d.versao_perfil} · ${dataCurta(d.data_criacao)}` })]),
      chip(d.estado, d.estado === "aprovado" ? "good" : d.estado === "rejeitado" ? "bad" : "warn"),
    ]))) : el("p", { class: "tiny faint", style: "margin-top:10px", text: v.descricao_completa ? "Só com factos do seu perfil-base; cada ponto fica ligado à origem." : "Recomenda-se colar a descrição completa antes de gerar o CV." }),
  ], { icone: "layers" });

  const barra = el("div", { class: "actionbar only-mobile" }, [
    botao("Gerar CV", () => gerar("cv")(), "btn btn-primary grow", { icone: "file" }),
    botao("Estado", () => folhaEstado(v), "btn", { icone: "kanban" }),
  ]);

  return {
    titulo: v.empresa || "Vaga", sub: v.cargo, voltar: () => irPara("vagas"),
    corpo: el("div", { class: "stack" }, [cabecalho, compat, reqs, descricao, documentos, barra].filter(Boolean)),
  };
}
