/* Ecrã Perfil-base: importar o CV, rever e editar os itens (com IDs), versionar e validar. */
import * as P from "../perfil.js";
import { avatar, botao, card, carregarScript, CDN, cfg, chip, dataCurta, el, estado, icone, mut, render, toast, ui, vazio, verificar } from "./comum.js";

async function importar(ficheiro) {
  const nome = ficheiro.name.toLowerCase();
  if (nome.endsWith(".pdf")) { await carregarScript(CDN.pdf); globalThis.pdfjsLib.GlobalWorkerOptions.workerSrc = CDN.pdfWorker; }
  else if (nome.endsWith(".docx")) await carregarScript(CDN.mammoth);
  const texto = await P.extrairTexto(ficheiro);
  const proposta = P.propostaPorRegras(texto);
  ui.rascunhoPerfil = { base: null, dados: proposta, rever: P.itensNaoEncontrados(proposta, texto), texto, origem: "importado do CV" };
  render();
}

// ---------------------------------------------------------------- editor por formulário

function inp(obj, chave, rotulo, opts = {}) {
  const f = UI.field(rotulo, { value: obj[chave] ?? "", ...opts });
  f.input.addEventListener(opts.type === "select" ? "change" : "input", () => { obj[chave] = f.input.value === "" && opts.nulo ? null : f.input.value; });
  return f;
}
const idTag = (id) => el("div", { class: "ids", text: id || "novo · ID atribuído ao gravar" });
const remover = (lista, i) => el("button", { class: "btn btn-sm btn-icon btn-ghost", title: "Remover", "aria-label": "Remover", onclick: () => { lista.splice(i, 1); render(); } }, [icone("trash")]);
const adicionar = (lista, novo, rotulo) => el("button", { class: "btn btn-sm btn-soft", style: "margin-top:10px", onclick: () => { lista.push(novo()); render(); } }, [icone("plus"), rotulo]);
const cabItem = (id, lista, i) => el("div", { class: "row", style: "margin-bottom:8px" }, [idTag(id), el("span", { class: "spacer" }), remover(lista, i)]);

function itensTexto(lista, rotulo, tipoPadrao) {
  return el("div", {}, [
    ...lista.map((it, i) => el("div", { class: "ponto-ed" }, [cabItem(it.id, lista, i), inp(it, "texto", "", { type: "textarea", rows: 2, placeholder: rotulo }),
      el("div", { style: "margin-top:8px;max-width:220px" }, [inp(it, "tipo", "", { type: "select", options: ["responsabilidade", "resultado", "detalhe", "resumo"].map((o) => ({ value: o, label: o })) })])])),
    adicionar(lista, () => ({ id: "", texto: "", tipo: tipoPadrao }), rotulo),
  ]);
}

function editor(r) {
  const d = r.dados;
  const datas = (o) => el("div", { class: "grid-2" }, [inp(o, "data_inicio", "Início", { nulo: true, placeholder: "AAAA-MM" }), inp(o, "data_fim", "Fim", { nulo: true, placeholder: "AAAA-MM ou atual" })]);
  return el("div", { class: "stack" }, [
    r.rever && r.rever.length ? el("div", { class: "card warn" }, [el("div", { class: "card-h", style: "margin-bottom:6px" }, [icone("alert"), el("h3", { text: `${r.rever.length} item(ns) a rever` })]),
      el("p", { class: "tiny muted", text: "Não os encontrei literalmente no CV original. Confirme ou corrija:" }),
      el("ul", { class: "motivos", style: "color:var(--warn)" }, r.rever.map(([id, t]) => el("li", { text: `${id}: ${t}` })))]) : null,
    r.texto ? el("details", { class: "card" }, [el("summary", {}, [icone("file"), "Texto extraído do CV"]), el("pre", { text: r.texto })]) : null,
    card("Dados pessoais", [el("div", { class: "form-grid" }, [inp(d.dados_pessoais, "nome", "Nome"), el("div", { class: "grid-2" }, [inp(d.dados_pessoais, "email", "E-mail"), inp(d.dados_pessoais, "telefone", "Telefone")]),
      el("div", { class: "grid-2" }, [inp(d.dados_pessoais, "localizacao", "Localização"), inp(d.dados_pessoais, "linkedin", "LinkedIn")])])], { icone: "user" }),
    card("Resumo", [itensTexto(d.resumo, "Frase", "resumo")], { icone: "file" }),
    card("Experiência", [
      ...d.experiencia.map((e, i) => el("div", { class: "ponto-ed form-grid" }, [cabItem(e.id, d.experiencia, i), el("div", { class: "grid-2" }, [inp(e, "cargo", "Cargo"), inp(e, "empresa", "Empresa")]), inp(e, "local", "Local"), datas(e),
        el("div", { class: "section", style: "margin:6px 0 0", text: "Responsabilidades e resultados" }), itensTexto(e.itens, "Ponto", "responsabilidade")])),
      adicionar(d.experiencia, () => ({ id: "", cargo: "", empresa: "", local: "", data_inicio: null, data_fim: null, itens: [] }), "Experiência"),
    ], { icone: "briefcase" }),
    card("Formação", [
      ...d.formacao.map((f, i) => el("div", { class: "ponto-ed form-grid" }, [cabItem(f.id, d.formacao, i), el("div", { class: "grid-2" }, [inp(f, "grau", "Grau"), inp(f, "instituicao", "Instituição")]), datas(f), itensTexto(f.itens, "Detalhe", "detalhe")])),
      adicionar(d.formacao, () => ({ id: "", grau: "", instituicao: "", data_inicio: null, data_fim: null, itens: [] }), "Formação"),
    ], { icone: "award" }),
    card("Competências", [
      ...d.competencias.map((c, i) => el("div", { class: "ponto-ed" }, [cabItem(c.id, d.competencias, i), el("div", { class: "grid-2" }, [inp(c, "nome", "Nome"), inp(c, "nivel", "Nível")])])),
      adicionar(d.competencias, () => ({ id: "", nome: "", categoria: "tecnica", nivel: "" }), "Competência"),
    ], { icone: "layers" }),
    card("Línguas", [
      ...d.linguas.map((l, i) => el("div", { class: "ponto-ed" }, [cabItem(l.id, d.linguas, i), el("div", { class: "grid-2" }, [inp(l, "nome", "Língua"), inp(l, "nivel", "Nível (A1–C2, nativo)")])])),
      adicionar(d.linguas, () => ({ id: "", nome: "", nivel: "" }), "Língua"),
    ], { icone: "globe" }),
    card("Certificações", [
      ...d.certificacoes.map((c, i) => el("div", { class: "ponto-ed form-grid" }, [cabItem(c.id, d.certificacoes, i), inp(c, "nome", "Nome"), el("div", { class: "grid-2" }, [inp(c, "entidade", "Entidade"), inp(c, "data", "Data", { nulo: true, placeholder: "AAAA ou AAAA-MM" })])])),
      adicionar(d.certificacoes, () => ({ id: "", nome: "", entidade: "", data: null }), "Certificação"),
    ], { icone: "shield" }),
    el("div", { class: "actionbar" }, [
      el("button", { class: "btn btn-ghost", onclick: () => { ui.rascunhoPerfil = null; render(); } }, ["Cancelar"]),
      botao(r.base == null ? "Gravar nova versão" : "Gravar alterações", () => {
        const n = mut((s, c) => { if (r.base == null) return P.guardarNovaVersao(s, r.dados, r.origem || ""); P.atualizarRascunho(s, c, r.base, r.dados); return r.base; });
        ui.rascunhoPerfil = null; ui.perfilVersao = n; toast(`Versão v${n} gravada · por validar`); render();
      }, "btn btn-primary grow", { icone: "check" }),
    ]),
  ].filter(Boolean));
}

// ---------------------------------------------------------------- leitura

function leitura(p) {
  const linha = (id, txt, sub) => el("div", { class: "item" }, [el("div", { class: "grow" }, [el("div", { class: "t", style: "font-weight:550", text: txt }), sub ? el("div", { class: "s", text: sub }) : null]), el("span", { class: "ids", text: id })]);
  return el("div", { class: "bento", style: "grid-template-columns:repeat(auto-fit,minmax(320px,1fr))" }, [
    p.resumo.length ? card("Resumo", [el("div", { class: "list" }, p.resumo.map((r) => linha(r.id, r.texto)))], { icone: "file" }) : null,
    ...p.experiencia.map((e) => card(e.cargo, [el("div", { class: "list" }, e.itens.map((i) => linha(i.id, i.texto, i.tipo)))], { icone: "briefcase", sub: [e.empresa, e.local, `${e.data_inicio || "?"} → ${e.data_fim || "?"}`].filter(Boolean).join(" · ") })),
    p.formacao.length ? card("Formação", [el("div", { class: "list" }, p.formacao.map((f) => linha(f.id, `${f.grau}${f.instituicao ? " — " + f.instituicao : ""}`, `${f.data_inicio || "?"} → ${f.data_fim || "?"}`)))], { icone: "award" }) : null,
    p.competencias.length ? card("Competências", [el("div", { class: "chips" }, p.competencias.map((c) => el("span", { class: "chip", title: c.id, text: c.nome + (c.nivel ? ` · ${c.nivel}` : "") })))], { icone: "layers" }) : null,
    p.linguas.length ? card("Línguas", [el("div", { class: "chips" }, p.linguas.map((l) => el("span", { class: "chip", title: l.id, text: l.nome + (l.nivel ? ` · ${l.nivel}` : "") })))], { icone: "globe" }) : null,
    p.certificacoes.length ? card("Certificações", [el("div", { class: "list" }, p.certificacoes.map((c) => linha(c.id, c.nome, [c.entidade, c.data].filter(Boolean).join(" · "))))], { icone: "shield" }) : null,
  ].filter(Boolean));
}

export function vistaPerfil() {
  if (ui.rascunhoPerfil) {
    const r = ui.rascunhoPerfil;
    return { titulo: r.base == null ? "Nova versão" : `Editar v${r.base}`, sub: "Os IDs existentes nunca mudam", voltar: () => { ui.rascunhoPerfil = null; render(); }, corpo: editor(r) };
  }
  const e = estado(), c = cfg();
  const lista = P.versoes(e);
  const validada = c.perfil_validado;
  const ficheiro = el("input", { type: "file", accept: ".pdf,.docx,.txt", class: "hide" });
  ficheiro.addEventListener("change", async () => {
    const f = ficheiro.files[0]; if (!f) return;
    try { toast("A ler o CV…"); await importar(f); } catch (err) { toast(err.message, 5000); }
  });
  const importarBtn = botao("Importar CV", () => ficheiro.click(), "btn btn-primary", { icone: "upload" });
  const manualBtn = botao("Criar à mão", () => { ui.rascunhoPerfil = { base: null, dados: P.perfilVazio(), origem: "criado à mão" }; render(); }, "btn", { icone: "pencil" });

  if (!lista.length) return { titulo: "Perfil", sub: "Fonte única de verdade do CV", corpo: el("div", { class: "card" }, [ficheiro,
    vazio("user", "Crie o seu perfil-base", "Importe o CV atual (PDF ou Word). A app propõe os itens com IDs estáveis e assinala o que não encontrar no original. Revê e valida uma vez.", [importarBtn, manualBtn])]) };

  const n = lista.some((v) => v.versao === ui.perfilVersao) ? ui.perfilVersao : (validada || lista[lista.length - 1].versao);
  const v = P.obterVersao(e, n);
  const p = P.normalizarPerfil(v.dados);
  const dp = p.dados_pessoais;
  const sel = el("select", { "aria-label": "Versão", style: "width:auto;min-height:36px;height:36px;font-size:13px;font-weight:650" },
    lista.map((x) => el("option", { value: x.versao, selected: x.versao === n, text: `v${x.versao}${x.versao === validada ? " · validada" : ""}` })));
  sel.addEventListener("change", () => { ui.perfilVersao = Number(sel.value); render(); });
  const erros = P.validarPerfil(p, { exigirIds: true });

  const identidade = el("div", { class: "card" }, [
    el("div", { class: "detail-head" }, [avatar(dp.nome || "?", "lg"),
      el("div", { class: "grow" }, [el("h2", { text: dp.nome || "(sem nome)" }), el("div", { class: "co", text: [dp.localizacao, dp.email].filter(Boolean).join(" · ") }),
        el("div", { class: "chips", style: "margin-top:10px" }, [
          n === validada ? chip(`v${n} validada`, "good", "checkCircle") : chip(`v${n} por validar`, "warn", "alert"),
          chip(`${P.anosExperiencia(p)} anos de experiência`, "outline"), chip(`${p.experiencia.reduce((a, x) => a + x.itens.length, 0) + p.resumo.length} itens`, "outline"),
          v.criado ? chip(`criada ${dataCurta(v.criado)}`, "outline") : null,
        ])])]),
    el("div", { class: "row wrap-row", style: "margin-top:16px" }, [sel, el("span", { class: "spacer" }), ficheiro, importarBtn,
      n === validada ? botao("Nova versão", () => { ui.rascunhoPerfil = { base: null, dados: JSON.parse(JSON.stringify(p)), origem: `editado a partir de v${n}` }; render(); }, "btn", { icone: "pencil" })
        : botao("Editar", () => { ui.rascunhoPerfil = { base: n, dados: JSON.parse(JSON.stringify(p)) }; render(); }, "btn", { icone: "pencil" })]),
  ]);

  let validar = null;
  if (n !== validada) {
    const conf = verificar(`Revi a versão v${n} e confirmo que todos os itens são factos reais.`);
    const btn = botao(`Validar v${n}`, () => { mut((s, cc) => P.validarVersao(s, cc, n)); toast(`Versão v${n} validada`); }, "btn btn-primary", { icone: "shield", disabled: true });
    conf.cb.addEventListener("change", () => { btn.disabled = !conf.cb.checked || erros.length > 0; });
    validar = card("Validar esta versão", [el("p", { class: "tiny muted", style: "margin-bottom:12px", text: "Só a versão validada é usada nos CVs. Depois de validada fica imutável: as alterações criam uma nova versão." }),
      erros.length ? el("ul", { class: "motivos" }, erros.map((x) => el("li", { text: x }))) : conf, el("div", { style: "margin-top:12px" }, [btn])], { icone: "shield", class: "warn" });
  }

  return { titulo: "Perfil", sub: "Fonte única de verdade do CV", corpo: el("div", { class: "stack" }, [identidade, validar, leitura(p)].filter(Boolean)) };
}
