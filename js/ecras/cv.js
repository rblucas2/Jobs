/* Ecrã Revisão de CV: original vs. adaptado lado a lado, origem de cada ponto, edição revalidada,
   pré-visualização, aprovação explícita e exportação (Word e PDF). */
import * as cvM from "../cv.js";
import * as dados from "../dados.js";
import { indexar, normalizarPerfil, obterVersao } from "../perfil.js";
import { pontosDe, problemas, VERIFICADO } from "../validador.js";
import { avatar, botao, card, carregarScript, CDN, cfg, chip, dataCurta, download, el, estado, icone, irPara, mut, render, toast, ui, vazio, verificar } from "./comum.js";

const esc = (s) => String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function pontoLado(p, idx) {
  const origem = cvM.textoOrigem(p.source_ids, idx);
  const ok = p.estado === VERIFICADO;
  return el("div", { class: "lado" }, [
    el("div", { class: "origem" }, [el("div", { class: "tiny", style: "font-weight:700;margin-bottom:2px", text: "Origem no perfil" }), origem || "—"]),
    el("div", {}, [
      el("div", { class: "estado " + (ok ? "ok" : "no") }, [icone(ok ? "checkCircle" : "xCircle"), ok ? "Verificado" : "Não verificado"]),
      el("div", { class: "diff", html: cvM.diffHtml(origem, p.texto) }),
      el("div", { class: "ids", style: "margin-top:4px", text: p.source_ids.join(" · ") || "sem origem" }),
      p.motivos.length ? el("ul", { class: "motivos" }, p.motivos.map((m) => el("li", { text: m }))) : null,
    ]),
  ]);
}

function vistaLado(doc, perfil, idx) {
  if (doc.paragrafos) return card("Parágrafos", doc.paragrafos.map((p) => pontoLado(p, idx)), { icone: "mail" });
  const exps = new Map(perfil.experiencia.map((e) => [e.id, e]));
  const usados = new Set(doc.experiencia.map((b) => b.experiencia_id));
  const omitidas = perfil.experiencia.filter((e) => !usados.has(e.id));
  const nomes = (ids) => ids.filter((i) => idx.has(i)).map((i) => idx.get(i).texto).join(" · ") || "—";
  return el("div", { class: "stack" }, [
    el("div", { class: "row tiny muted diff", style: "gap:14px;flex-wrap:wrap" }, [el("span", { html: "<ins>verde</ins> texto novo" }), el("span", { html: "<del>vermelho</del> retirado da origem" })]),
    doc.resumo.length ? card("Perfil", doc.resumo.map((p) => pontoLado(p, idx)), { icone: "user" }) : null,
    ...doc.experiencia.map((b) => {
      const e = exps.get(b.experiencia_id);
      return card(e ? e.cargo : b.experiencia_id, b.pontos.length ? b.pontos.map((p) => pontoLado(p, idx)) : [el("div", { class: "empty", text: "Sem pontos." })], { icone: "briefcase", sub: e ? e.empresa : "experiência inexistente" });
    }),
    omitidas.length ? el("p", { class: "tiny faint", text: "Omitidas: " + omitidas.map((e) => `${e.cargo} — ${e.empresa}`).join("; ") }) : null,
    card("Outras secções", [
      ...[["Formação", doc.formacao_ids], ["Competências", doc.competencias_ids], ["Línguas", doc.linguas_ids], ["Certificações", doc.certificacoes_ids]].map(([t, ids]) =>
        el("div", { class: "item" }, [el("span", { class: "small", style: "font-weight:650;width:110px;flex:none", text: t }), el("span", { class: "small muted grow", text: nomes(ids) })])),
    ], { icone: "layers", sub: "copiadas do perfil-base" }),
  ].filter(Boolean));
}

// ---------------------------------------------------------------- edição

function editorPontos(lista, rotuloIds) {
  const caixa = el("div", {});
  lista.forEach((p, i) => {
    const t = el("textarea", { rows: 3, "aria-label": "Texto" }); t.value = p.texto; t.addEventListener("input", () => { p.texto = t.value; });
    const ids = el("input", { type: "text", value: p.source_ids.join(", "), placeholder: "IDs de origem, separados por vírgulas", "aria-label": rotuloIds });
    ids.addEventListener("input", () => { p.source_ids = ids.value.split(",").map((x) => x.trim()).filter(Boolean); });
    caixa.appendChild(el("div", { class: "ponto-ed stack-sm" }, [t,
      el("div", { class: "row" }, [el("div", { class: "grow" }, [ids]),
        i > 0 ? el("button", { class: "btn btn-sm btn-icon btn-ghost", title: "Subir", onclick: () => { [lista[i - 1], lista[i]] = [lista[i], lista[i - 1]]; render(); } }, [icone("up")]) : null,
        el("button", { class: "btn btn-sm btn-icon btn-ghost", title: "Remover", onclick: () => { lista.splice(i, 1); render(); } }, [icone("trash")])])]));
  });
  caixa.appendChild(el("button", { class: "btn btn-sm btn-soft", style: "margin-top:10px", onclick: () => { lista.push({ texto: "", source_ids: [] }); render(); } }, [icone("plus"), "Ponto"]));
  return caixa;
}

function escolhaIds(rascunho, campo, idx, tipo, titulo) {
  const opcoes = [...idx.values()].filter((i) => i.tipo === tipo);
  if (!opcoes.length) return null;
  return card(titulo, [el("div", { class: "chips" }, opcoes.map((o) => {
    const on = rascunho[campo].includes(o.id);
    return el("span", { class: "chip click" + (on ? " on" : ""), onclick: () => { rascunho[campo] = on ? rascunho[campo].filter((x) => x !== o.id) : [...rascunho[campo], o.id]; render(); } }, [on ? icone("check") : null, o.texto.slice(0, 40)]);
  }))], { sub: "toque para incluir ou retirar" });
}

function vistaEditar(reg, perfil, idx) {
  if (reg.estado !== "rascunho") return el("div", { class: "card" }, [vazio("shield", "Documento imutável", "Depois de aprovado ou rejeitado, o conteúdo não muda. Gere um novo rascunho a partir da vaga.")]);
  if (!ui.rascunhoCv || ui.rascunhoCv.id !== reg.id) ui.rascunhoCv = { id: reg.id, doc: JSON.parse(JSON.stringify(reg.conteudo)) };
  const d = ui.rascunhoCv.doc;
  const ajuda = el("div", { class: "card tint row tiny" }, [icone("shield"), el("span", { text: "Pode reformular, reordenar, selecionar e omitir. Para acrescentar um facto, edite o perfil-base. O validador corre ao gravar." })]);
  const guardar = el("div", { class: "actionbar" }, [
    el("button", { class: "btn btn-ghost", onclick: () => { ui.rascunhoCv = null; render(); } }, ["Descartar"]),
    botao("Guardar e revalidar", () => {
      const novo = mut((s, c) => cvM.editar(s, c, reg.id, d));
      ui.rascunhoCv = null;
      const n = problemas(novo).length;
      toast(n ? `Guardado · ${n} ponto(s) por resolver` : "Guardado · tudo verificado", 4000);
      irPara("cv", { cvTab: n ? "lado" : "prev" });
    }, "btn btn-primary grow", { icone: "check" }),
  ]);
  if (d.paragrafos) return el("div", { class: "stack" }, [ajuda, card("Parágrafos", [editorPontos(d.paragrafos, "IDs de origem")]), guardar]);
  const exps = new Map(perfil.experiencia.map((e) => [e.id, e]));
  const incluidas = new Set(d.experiencia.map((b) => b.experiencia_id));
  return el("div", { class: "stack" }, [
    ajuda,
    card("Perfil", [editorPontos(d.resumo, "IDs de origem (qualquer item do perfil)")], { icone: "user" }),
    ...d.experiencia.map((b, i) => {
      const e = exps.get(b.experiencia_id);
      return card(e ? e.cargo : b.experiencia_id, [
        el("div", { class: "ids", style: "margin-bottom:10px", text: "Origens possíveis: " + (e ? [e.id, ...e.itens.map((x) => x.id)].join(", ") : "—") }),
        editorPontos(b.pontos, "IDs de origem (só desta experiência)"),
      ], { icone: "briefcase", sub: e ? e.empresa : "", acoes: [
        i > 0 ? el("button", { class: "btn btn-sm btn-icon btn-ghost", title: "Subir experiência", onclick: () => { [d.experiencia[i - 1], d.experiencia[i]] = [d.experiencia[i], d.experiencia[i - 1]]; render(); } }, [icone("up")]) : null,
        el("button", { class: "btn btn-sm btn-ghost", onclick: () => { d.experiencia.splice(i, 1); render(); } }, ["Omitir"]),
      ].filter(Boolean) });
    }),
    perfil.experiencia.some((e) => !incluidas.has(e.id)) ? card("Repor experiências", [el("div", { class: "chips" }, perfil.experiencia.filter((e) => !incluidas.has(e.id)).map((e) =>
      el("span", { class: "chip click", onclick: () => { d.experiencia.push({ experiencia_id: e.id, pontos: e.itens.map((x) => ({ texto: x.texto, source_ids: [x.id] })) }); render(); } }, [icone("plus"), `${e.cargo} — ${e.empresa}`])))]) : null,
    escolhaIds(d, "formacao_ids", idx, "formacao", "Formação"),
    escolhaIds(d, "competencias_ids", idx, "competencia", "Competências"),
    escolhaIds(d, "linguas_ids", idx, "lingua", "Línguas"),
    escolhaIds(d, "certificacoes_ids", idx, "certificacao", "Certificações"),
    guardar,
  ].filter(Boolean));
}

// ---------------------------------------------------------------- exportação

function imprimir(blocos, titulo) {
  const html = `<!doctype html><html lang="pt"><head><meta charset="utf-8"><title>${esc(titulo)}</title><style>@page{size:A4;margin:15mm 17mm}html,body{margin:0;background:#fff}${cvM.CSS_DOCUMENTO}</style></head>` +
    `<body>${cvM.htmlDocumento(blocos)}<script>window.onload=function(){setTimeout(function(){window.print()},250)}<\/script></body></html>`;
  const w = window.open("", "_blank");
  if (!w) { toast("O browser bloqueou a janela de impressão. Permita pop-ups para este site.", 5000); return; }
  w.document.open(); w.document.write(html); w.document.close();
}

async function exportar(reg, formato) {
  const blocos = mut((s, c) => cvM.prepararExportacao(s, c, reg.id)); // valida e liga ao tracker
  const nome = cvM.nomeFicheiro(reg, dados.obterVaga(estado(), reg.vaga_id));
  if (formato === "pdf") { imprimir(blocos, nome); toast("Na janela de impressão escolha “Guardar como PDF”.", 5000); return; }
  await carregarScript(CDN.docx);
  download(await cvM.gerarDocx(blocos), nome + ".docx");
}

// ---------------------------------------------------------------- vista

export function vistaCv() {
  const e = estado(), c = cfg();
  const docs = [...e.cvs].sort((a, b) => (a.estado !== "rascunho") - (b.estado !== "rascunho") || String(b.data_criacao).localeCompare(String(a.data_criacao)));
  if (!docs.length) return { titulo: "CV", corpo: el("div", { class: "card" }, [vazio("file", "Ainda não há CVs adaptados", "Abra uma vaga e carregue em “Gerar CV adaptado”. Cada ponto fica ligado ao item do perfil de onde vem.", [botao("Ver vagas", () => irPara("vagas"), "btn btn-primary")])]) };
  const reg = docs.find((d) => d.id === ui.cvId) || docs[0];
  ui.cvId = reg.id;
  const v = obterVersao(e, reg.versao_perfil);
  if (!v) return { titulo: "CV", corpo: el("div", { class: "card" }, [vazio("alert", "Versão do perfil em falta", `A versão v${reg.versao_perfil} do perfil já não existe.`)]) };
  const perfil = { ...normalizarPerfil(v.dados), versao: v.versao };
  const idx = indexar(perfil);
  const doc = cvM.revalidar(e, c, reg); // o validador corre sempre antes de mostrar
  const falhas = problemas(doc);
  const pontos = pontosDe(doc);
  const ok = pontos.filter((p) => p.estado === VERIFICADO).length;
  const vaga = dados.obterVaga(e, reg.vaga_id) || {};

  const escolha = el("select", { "aria-label": "Documento" }, docs.map((d) => {
    const vg = dados.obterVaga(e, d.vaga_id) || {};
    return el("option", { value: d.id, selected: d.id === reg.id, text: `${d.tipo === "carta" ? "Carta" : "CV"} · ${vg.empresa || vg.cargo || "?"} · ${d.estado}` });
  }));
  escolha.addEventListener("change", () => irPara("cv", { cvId: escolha.value, rascunhoCv: null }));

  const resumo = el("div", { class: "card" }, [
    el("div", { class: "row", style: "align-items:flex-start" }, [avatar(vaga.empresa || vaga.cargo),
      el("div", { class: "grow" }, [el("div", { style: "font-weight:720", text: `${reg.tipo === "carta" ? "Carta" : "CV"} para ${vaga.cargo || "?"}` }), el("div", { class: "small muted", text: vaga.empresa || "" })]),
      chip(reg.estado, reg.estado === "aprovado" ? "good" : reg.estado === "rejeitado" ? "bad" : "warn")]),
    el("div", { class: "row", style: "margin-top:14px" }, [el("span", { class: "small", style: "font-weight:650", text: `${ok} de ${pontos.length} pontos verificados` }), el("span", { class: "spacer" }),
      el("span", { class: "tiny faint", text: `perfil v${reg.versao_perfil} · ${doc.metodo === "llm" ? "modelo local" : "regras"}` })]),
    el("div", { class: "progress", style: "margin-top:8px" }, [el("i", { class: falhas.length ? "warn" : "", style: `width:${pontos.length ? (100 * ok) / pontos.length : 0}%` })]),
    doc.metodo !== "llm" && reg.estado === "rascunho" ? el("p", { class: "tiny faint", style: "margin-top:10px", text: "Gerado sem modelo local: texto copiado do perfil-base, selecionado e ordenado pela relevância. Reformule-o em Editar." }) : null,
  ]);

  const sub = el("div", { class: "seg" }, [["lado", "Comparar"], ["editar", "Editar"], ["prev", "Documento"]].map(([k, t]) =>
    el("button", { class: ui.cvTab === k ? "active" : "", text: t, onclick: () => irPara("cv", { cvTab: k }) })));

  let corpoTab;
  if (ui.cvTab === "editar") corpoTab = vistaEditar(reg, perfil, idx);
  else if (ui.cvTab === "prev") corpoTab = el("div", { class: "doc-wrap" }, [el("style", { text: cvM.CSS_DOCUMENTO }), el("div", { html: cvM.htmlDocumento(cvM.blocos(e, c, reg)) })]);
  else corpoTab = vistaLado(doc, perfil, idx);

  let acoes = null;
  if (reg.estado === "rascunho" && ui.cvTab !== "editar") {
    const conf = verificar("Revi o documento e confirmo que todos os pontos são factos reais do meu perfil.");
    const aprovarBtn = botao("Aprovar", () => { mut((s, cc) => cvM.aprovar(s, cc, reg.id, conf.cb.checked)); toast("CV aprovado"); }, "btn btn-primary grow", { icone: "check", disabled: true });
    conf.cb.addEventListener("change", () => { aprovarBtn.disabled = !conf.cb.checked || falhas.length > 0; });
    acoes = el("div", { class: "stack-sm" }, [
      falhas.length ? null : conf,
      el("div", { class: "actionbar" }, [botao("Rejeitar", () => mut((s) => cvM.rejeitar(s, reg.id)), "btn btn-ghost"), aprovarBtn]),
    ].filter(Boolean));
  } else if (reg.estado === "aprovado") {
    const formatoOk = c.cv.modelo_aprovado;
    acoes = el("div", { class: "stack-sm" }, [
      !formatoOk ? el("div", { class: "card warn tiny row" }, [icone("alert"), el("span", { class: "grow", text: "Aprove o formato do CV nas Definições para poder exportar." }), botao("Definições", () => document.getElementById("btnDefinicoes").click(), "btn btn-sm")]) : null,
      el("div", { class: "actionbar" }, [botao("PDF", () => exportar(reg, "pdf"), "btn grow", { icone: "printer", disabled: !formatoOk }), botao("Word", () => exportar(reg, "docx"), "btn btn-primary grow", { icone: "download", disabled: !formatoOk })]),
    ].filter(Boolean));
  }

  return {
    titulo: reg.tipo === "carta" ? "Carta" : "CV",
    sub: reg.estado === "aprovado" ? `Aprovado ${dataCurta(reg.data_aprovacao)}` : reg.estado === "rejeitado" ? "Rejeitado" : "Revisão e aprovação",
    voltar: () => irPara("vaga", { vagaId: reg.vaga_id }),
    corpo: el("div", { class: "stack" }, [
      escolha, resumo,
      falhas.length ? el("div", { class: "card bad" }, [el("div", { class: "card-h", style: "margin-bottom:6px" }, [icone("alert"), el("h3", { text: `${falhas.length} ponto(s) por resolver` })]),
        el("p", { class: "tiny muted", text: "Não pode ser aprovado enquanto houver pontos não verificados. Corrija-os em Editar." })]) : null,
      sub, corpoTab, acoes,
    ].filter(Boolean)),
  };
}
