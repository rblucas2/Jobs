/* Ecrã Revisão de CV: original vs. adaptado lado a lado, origem de cada ponto, edição revalidada,
   pré-visualização, aprovação explícita e exportação (Word e PDF). */
import * as cvM from "../cv.js";
import * as dados from "../dados.js";
import { indexar, normalizarPerfil, obterVersao } from "../perfil.js";
import { pontosDe, problemas, VERIFICADO } from "../validador.js";
import { botao, card, carregarScript, CDN, cfg, download, el, estado, irPara, mut, render, toast, ui } from "./comum.js";

const esc = (s) => String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function pontoLado(p, idx) {
  const origem = cvM.textoOrigem(p.source_ids, idx);
  const ok = p.estado === VERIFICADO;
  return el("div", { class: "lado" }, [
    el("div", { class: "origem", text: origem || "—" }),
    el("div", {}, [
      el("div", { class: "diff", html: (ok ? "✅ " : "⛔ <b>não verificado</b> ") + cvM.diffHtml(origem, p.texto) }),
      el("div", { class: "ids", text: "origem: " + (p.source_ids.join(", ") || "—") }),
      p.motivos.length ? el("ul", { class: "motivos" }, p.motivos.map((m) => el("li", { text: m }))) : null,
    ]),
  ]);
}

function vistaLado(doc, perfil, idx) {
  if (doc.paragrafos) return card("Parágrafos", doc.paragrafos.map((p) => pontoLado(p, idx)));
  const exps = new Map(perfil.experiencia.map((e) => [e.id, e]));
  const usados = new Set(doc.experiencia.map((b) => b.experiencia_id));
  const omitidas = perfil.experiencia.filter((e) => !usados.has(e.id));
  const nomes = (ids) => ids.filter((i) => idx.has(i)).map((i) => idx.get(i).texto).join(", ") || "—";
  return el("div", { class: "stack" }, [
    el("div", { class: "tiny muted diff", html: "À esquerda (ou em cima) a origem no perfil-base; ao lado o texto adaptado: <ins>verde</ins> = novo, <del>vermelho</del> = retirado." }),
    doc.resumo.length ? card("Perfil / resumo", doc.resumo.map((p) => pontoLado(p, idx))) : null,
    ...doc.experiencia.map((b) => {
      const e = exps.get(b.experiencia_id);
      return card(e ? `${e.cargo} — ${e.empresa}` : `⛔ ${b.experiencia_id}`, b.pontos.length ? b.pontos.map((p) => pontoLado(p, idx)) : [el("div", { class: "empty tiny", text: "(sem pontos)" })]);
    }),
    omitidas.length ? el("p", { class: "tiny muted", text: "Experiências omitidas: " + omitidas.map((e) => `${e.cargo} — ${e.empresa}`).join("; ") }) : null,
    card("Outras secções (copiadas do perfil-base)", [
      el("p", { class: "tiny", html: `<b>Formação:</b> ${esc(nomes(doc.formacao_ids))}` }),
      el("p", { class: "tiny", html: `<b>Competências:</b> ${esc(nomes(doc.competencias_ids))}` }),
      el("p", { class: "tiny", html: `<b>Línguas:</b> ${esc(nomes(doc.linguas_ids))}` }),
      el("p", { class: "tiny", html: `<b>Certificações:</b> ${esc(nomes(doc.certificacoes_ids))}` }),
    ]),
  ].filter(Boolean));
}

// ---------------------------------------------------------------- edição

function editorPontos(lista, rotuloIds) {
  const caixa = el("div", {});
  lista.forEach((p, i) => {
    const t = el("textarea", { rows: 3 }); t.value = p.texto; t.addEventListener("input", () => { p.texto = t.value; });
    const ids = el("input", { type: "text", value: p.source_ids.join(", "), placeholder: "IDs de origem, separados por vírgulas" });
    ids.addEventListener("input", () => { p.source_ids = ids.value.split(",").map((x) => x.trim()).filter(Boolean); });
    caixa.appendChild(el("div", { class: "ponto-ed" }, [
      el("label", { class: "field" }, [el("span", { text: "Texto" }), t]),
      el("label", { class: "field" }, [el("span", { text: rotuloIds }), ids]),
      el("div", { class: "row", style: "gap:6px;margin-top:6px" }, [
        i > 0 ? el("button", { class: "btn btn-sm btn-ghost", text: "↑", onclick: () => { [lista[i - 1], lista[i]] = [lista[i], lista[i - 1]]; render(); } }) : null,
        el("button", { class: "btn btn-sm btn-ghost", text: "Remover", onclick: () => { lista.splice(i, 1); render(); } }),
      ]),
    ]));
  });
  caixa.appendChild(el("button", { class: "btn btn-sm", style: "margin-top:8px", text: "+ Ponto", onclick: () => { lista.push({ texto: "", source_ids: [] }); render(); } }));
  return caixa;
}

function escolhaIds(rascunho, campo, idx, tipo, titulo) {
  const opcoes = [...idx.values()].filter((i) => i.tipo === tipo);
  if (!opcoes.length) return null;
  return card(titulo, [el("div", { class: "chips" }, opcoes.map((o) => {
    const on = rascunho[campo].includes(o.id);
    return el("span", { class: "pill" + (on ? " on" : ""), text: o.texto.slice(0, 40), onclick: () => {
      rascunho[campo] = on ? rascunho[campo].filter((x) => x !== o.id) : [...rascunho[campo], o.id]; render();
    } });
  })), el("p", { class: "tiny muted", text: "Toque para incluir/retirar (fica pela ordem em que os escolhe)." })]);
}

function vistaEditar(reg, perfil, idx) {
  if (reg.estado !== "rascunho") return card(null, [el("div", { class: "empty", text: "Este documento já não é um rascunho: é imutável." })]);
  if (!ui.rascunhoCv || ui.rascunhoCv.id !== reg.id) ui.rascunhoCv = { id: reg.id, doc: JSON.parse(JSON.stringify(reg.conteudo)) };
  const d = ui.rascunhoCv.doc;
  const ajuda = el("p", { class: "tiny muted", text: "Aqui só pode reformular, reordenar, selecionar e omitir. Para acrescentar um facto, edite o perfil-base e valide a nova versão. O validador corre ao gravar." });
  const guardar = botao("Guardar e revalidar", () => {
    const novo = mut((s, c) => cvM.editar(s, c, reg.id, d));
    ui.rascunhoCv = null;
    const n = problemas(novo).length;
    toast(n ? `Guardado. ${n} problema(s) por resolver.` : "Guardado. Tudo verificado ✓", 4000);
    irPara("cv", { cvTab: n ? "lado" : "prev" });
  }, "btn btn-primary btn-block");
  const descartar = el("button", { class: "btn btn-ghost btn-block", text: "Descartar alterações", onclick: () => { ui.rascunhoCv = null; render(); } });

  if (d.paragrafos) return el("div", { class: "stack" }, [ajuda, card("Parágrafos", [editorPontos(d.paragrafos, "IDs de origem")]), guardar, descartar]);

  const exps = new Map(perfil.experiencia.map((e) => [e.id, e]));
  const incluidas = new Set(d.experiencia.map((b) => b.experiencia_id));
  return el("div", { class: "stack" }, [
    ajuda,
    card("Resumo", [editorPontos(d.resumo, "IDs de origem (qualquer item do perfil)")]),
    ...d.experiencia.map((b, i) => {
      const e = exps.get(b.experiencia_id);
      return card(e ? `${e.cargo} — ${e.empresa}` : b.experiencia_id, [
        el("div", { class: "ids", text: "Itens disponíveis: " + (e ? [e.id, ...e.itens.map((x) => x.id)].join(", ") : "—") }),
        editorPontos(b.pontos, "IDs de origem (só desta experiência)"),
        el("div", { class: "row", style: "gap:6px;margin-top:8px" }, [
          i > 0 ? el("button", { class: "btn btn-sm btn-ghost", text: "↑ Subir experiência", onclick: () => { [d.experiencia[i - 1], d.experiencia[i]] = [d.experiencia[i], d.experiencia[i - 1]]; render(); } }) : null,
          el("button", { class: "btn btn-sm btn-ghost", text: "Omitir experiência", onclick: () => { d.experiencia.splice(i, 1); render(); } }),
        ]),
      ]);
    }),
    perfil.experiencia.some((e) => !incluidas.has(e.id)) ? card("Repor experiências omitidas", perfil.experiencia.filter((e) => !incluidas.has(e.id)).map((e) =>
      el("button", { class: "btn btn-sm", style: "margin:4px 4px 0 0", text: `+ ${e.cargo} — ${e.empresa}`, onclick: () => { d.experiencia.push({ experiencia_id: e.id, pontos: e.itens.map((x) => ({ texto: x.texto, source_ids: [x.id] })) }); render(); } }))) : null,
    escolhaIds(d, "formacao_ids", idx, "formacao", "Formação"),
    escolhaIds(d, "competencias_ids", idx, "competencia", "Competências"),
    escolhaIds(d, "linguas_ids", idx, "lingua", "Línguas"),
    escolhaIds(d, "certificacoes_ids", idx, "certificacao", "Certificações"),
    guardar, descartar,
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
  const vaga = dados.obterVaga(estado(), reg.vaga_id);
  const nome = cvM.nomeFicheiro(reg, vaga);
  if (formato === "pdf") { imprimir(blocos, nome); toast("Na janela de impressão escolha “Guardar como PDF”.", 5000); return; }
  await carregarScript(CDN.docx);
  download(await cvM.gerarDocx(blocos), nome + ".docx");
}

// ---------------------------------------------------------------- vista

export function vistaCv() {
  const e = estado(), c = cfg();
  const docs = [...e.cvs].sort((a, b) => (a.estado !== "rascunho") - (b.estado !== "rascunho") || String(b.data_criacao).localeCompare(String(a.data_criacao)));
  if (!docs.length) return card(null, [el("div", { class: "empty", text: "Ainda não há CVs. Gere um a partir de uma vaga." })]);
  let reg = docs.find((d) => d.id === ui.cvId) || docs[0];
  ui.cvId = reg.id;
  const v = obterVersao(e, reg.versao_perfil);
  if (!v) return card(null, [el("div", { class: "empty", text: `A versão v${reg.versao_perfil} do perfil já não existe.` })]);
  const perfil = { ...normalizarPerfil(v.dados), versao: v.versao };
  const idx = indexar(perfil);
  const doc = cvM.revalidar(e, c, reg); // o validador corre sempre antes de mostrar
  const falhas = problemas(doc);
  const pontos = pontosDe(doc);
  const vaga = dados.obterVaga(e, reg.vaga_id) || {};

  const escolha = UI.field("Documento", { type: "select", value: reg.id, options: docs.map((d) => {
    const vg = dados.obterVaga(e, d.vaga_id) || {};
    return { value: d.id, label: `${d.tipo === "carta" ? "Carta" : "CV"} · ${d.estado} · ${vg.cargo || "?"} — ${vg.empresa || "?"}` };
  }) });
  escolha.input.addEventListener("change", () => irPara("cv", { cvId: escolha.input.value, rascunhoCv: null }));

  const sub = el("div", { class: "seg", style: "margin:4px 0 10px" }, [["lado", "Lado a lado"], ["editar", "Editar"], ["prev", "Pré-visualização"]].map(([k, t]) =>
    el("button", { class: ui.cvTab === k ? "active" : "", text: t, onclick: () => irPara("cv", { cvTab: k }) })));

  let corpo;
  if (ui.cvTab === "editar") corpo = vistaEditar(reg, perfil, idx);
  else if (ui.cvTab === "prev") corpo = el("div", { class: "stack" }, [
    el("p", { class: "tiny muted", text: "Formato final (só os pontos verificados). É o mesmo no Word e no PDF." }),
    el("div", { class: "doc-wrap" }, [el("style", { text: cvM.CSS_DOCUMENTO }), el("div", { html: cvM.htmlDocumento(cvM.blocos(e, c, reg)) })]),
  ]);
  else corpo = vistaLado(doc, perfil, idx);

  const confirmar = el("input", { type: "checkbox" });
  let acoes;
  if (reg.estado === "rascunho") {
    const aprovarBtn = botao("Aprovar", () => {
      mut((s, cc) => cvM.aprovar(s, cc, reg.id, confirmar.checked));
      toast("Aprovado ✓");
    }, "btn btn-primary btn-block", { disabled: true });
    confirmar.addEventListener("change", () => { aprovarBtn.disabled = !confirmar.checked || falhas.length > 0; });
    acoes = card("Aprovação", [
      falhas.length ? el("p", { class: "tiny", style: "color:var(--bad)", text: "Não pode ser aprovado enquanto houver pontos não verificados." }) : null,
      el("label", { class: "row tiny", style: "gap:8px;align-items:flex-start;margin:6px 0 10px" }, [confirmar, el("span", { text: "Revi o documento e confirmo que todos os pontos correspondem a factos reais do meu perfil." })]),
      aprovarBtn,
      botao("Rejeitar", () => mut((s) => cvM.rejeitar(s, reg.id)), "btn btn-ghost btn-block"),
    ]);
  } else if (reg.estado === "aprovado") {
    const formatoOk = c.cv.modelo_aprovado;
    acoes = card("Exportar", [
      el("p", { class: "tiny muted", text: `Aprovado em ${String(reg.data_aprovacao).replace("T", " ").slice(0, 16)}. O conteúdo aprovado fica guardado e não muda.` }),
      !formatoOk ? el("p", { class: "tiny", style: "color:var(--warn)", text: "Aprove o formato do CV nas Definições (⚙︎ → Formato do CV) para poder exportar." }) : null,
      el("div", { class: "row", style: "gap:8px" }, [
        botao("Descarregar Word", () => exportar(reg, "docx"), "btn btn-primary btn-block", { disabled: !formatoOk }),
        botao("PDF (imprimir)", () => exportar(reg, "pdf"), "btn btn-block", { disabled: !formatoOk }),
      ]),
      botao("Ver a vaga", () => irPara("vaga", { vagaId: reg.vaga_id }), "btn btn-ghost btn-block"),
    ]);
  } else {
    acoes = card(null, [el("p", { class: "tiny muted", text: "Documento rejeitado. Gere um novo a partir da vaga." })]);
  }

  return el("div", { class: "stack" }, [
    escolha,
    card(null, [
      el("div", { class: "grid-2", style: "gap:10px" }, [
        el("div", { class: "kpi" }, [el("span", { class: "k", text: "Estado" }), el("span", { class: "v", style: "font-size:1.1rem", text: reg.estado })]),
        el("div", { class: "kpi" }, [el("span", { class: "k", text: "Verificados" }), el("span", { class: "v", style: "font-size:1.1rem", text: `${pontos.filter((p) => p.estado === VERIFICADO).length}/${pontos.length}` })]),
      ]),
      el("div", { class: "tiny muted", style: "margin-top:6px", text: `${vaga.cargo || ""} — ${vaga.empresa || ""} · perfil v${reg.versao_perfil} · gerado por ${doc.metodo === "llm" ? "modelo local" : "regras"}` }),
      doc.metodo !== "llm" && reg.estado === "rascunho" ? el("p", { class: "tiny", text: "Gerado sem modelo local: o texto foi copiado do perfil-base, selecionado e ordenado pela relevância para a vaga. Pode reformulá-lo em Editar." }) : null,
    ]),
    falhas.length ? card("Pontos por resolver", [el("ul", { class: "motivos" }, falhas.map((f) => el("li", { text: f })))], { class: "alerta" }) : null,
    sub, corpo, acoes,
  ].filter(Boolean));
}
