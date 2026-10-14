/* Ecrã Perfil-base: importar o CV, rever e editar os itens (com IDs), versionar e validar. */
import * as P from "../perfil.js";
import { botao, card, carregarScript, CDN, cfg, el, estado, mut, render, toast, ui } from "./comum.js";

async function importar(ficheiro) {
  if (ficheiro.name.toLowerCase().endsWith(".pdf")) {
    await carregarScript(CDN.pdf);
    globalThis.pdfjsLib.GlobalWorkerOptions.workerSrc = CDN.pdfWorker;
  } else if (ficheiro.name.toLowerCase().endsWith(".docx")) {
    await carregarScript(CDN.mammoth);
  }
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
const idTag = (id) => el("span", { class: "ids", text: id ? `ID: ${id}` : "ID: (atribuído ao gravar)" });
const remover = (lista, i) => el("button", { class: "btn btn-sm btn-ghost", text: "Remover", onclick: () => { lista.splice(i, 1); render(); } });
const adicionar = (lista, novo, rotulo) => el("button", { class: "btn btn-sm", style: "margin-top:8px", text: "+ " + rotulo, onclick: () => { lista.push(novo()); render(); } });

function itensTexto(lista, rotulo, tipoPadrao) {
  return el("div", {}, [
    ...lista.map((it, i) => el("div", { class: "ponto-ed" }, [idTag(it.id), inp(it, "texto", rotulo, { type: "textarea", rows: 2 }),
      el("div", { class: "row", style: "gap:6px" }, [
        inp(it, "tipo", "Tipo", { type: "select", options: ["responsabilidade", "resultado", "detalhe", "resumo"].map((o) => ({ value: o, label: o })) }), remover(lista, i)])])),
    adicionar(lista, () => ({ id: "", texto: "", tipo: tipoPadrao }), rotulo.toLowerCase()),
  ]);
}

function editor(r) {
  const d = r.dados;
  const datas = (o) => el("div", { class: "grid-2", style: "gap:8px" }, [inp(o, "data_inicio", "Início (AAAA-MM)", { nulo: true, placeholder: "2021-09" }), inp(o, "data_fim", "Fim (AAAA-MM ou atual)", { nulo: true, placeholder: "atual" })]);
  return el("div", { class: "stack" }, [
    r.rever && r.rever.length ? card("Itens a rever", [el("p", { class: "tiny", text: "Não encontrei estes itens literalmente no CV original. Confirme ou corrija:" }),
      el("ul", { class: "motivos", style: "color:var(--warn)" }, r.rever.map(([id, t]) => el("li", { text: `${id}: ${t}` })))], { class: "aviso" }) : null,
    r.texto ? el("details", { class: "card" }, [el("summary", { style: "cursor:pointer;font-weight:650", text: "Ver o texto extraído do CV" }), el("pre", { class: "tiny", style: "white-space:pre-wrap", text: r.texto })]) : null,
    card("Dados pessoais", ["nome", "email", "telefone", "localizacao", "linkedin"].map((k) => inp(d.dados_pessoais, k, { nome: "Nome", email: "E-mail", telefone: "Telefone", localizacao: "Localização", linkedin: "LinkedIn" }[k]))),
    card("Resumo", [itensTexto(d.resumo, "Frase", "resumo")]),
    card("Experiência", [
      ...d.experiencia.map((e, i) => el("div", { class: "ponto-ed" }, [idTag(e.id), inp(e, "cargo", "Cargo"), inp(e, "empresa", "Empresa"), inp(e, "local", "Local"), datas(e),
        el("div", { class: "section-title", text: "Responsabilidades e resultados" }), itensTexto(e.itens, "Ponto", "responsabilidade"), remover(d.experiencia, i)])),
      adicionar(d.experiencia, () => ({ id: "", cargo: "", empresa: "", local: "", data_inicio: null, data_fim: null, itens: [] }), "experiência"),
    ]),
    card("Formação", [
      ...d.formacao.map((f, i) => el("div", { class: "ponto-ed" }, [idTag(f.id), inp(f, "grau", "Grau"), inp(f, "instituicao", "Instituição"), datas(f), itensTexto(f.itens, "Detalhe", "detalhe"), remover(d.formacao, i)])),
      adicionar(d.formacao, () => ({ id: "", grau: "", instituicao: "", data_inicio: null, data_fim: null, itens: [] }), "formação"),
    ]),
    card("Competências", [
      ...d.competencias.map((c, i) => el("div", { class: "ponto-ed" }, [idTag(c.id), el("div", { class: "grid-2", style: "gap:8px" }, [inp(c, "nome", "Nome"), inp(c, "nivel", "Nível")]), remover(d.competencias, i)])),
      adicionar(d.competencias, () => ({ id: "", nome: "", categoria: "tecnica", nivel: "" }), "competência"),
    ]),
    card("Línguas", [
      ...d.linguas.map((l, i) => el("div", { class: "ponto-ed" }, [idTag(l.id), el("div", { class: "grid-2", style: "gap:8px" }, [inp(l, "nome", "Língua"), inp(l, "nivel", "Nível (A1–C2, nativo)")]), remover(d.linguas, i)])),
      adicionar(d.linguas, () => ({ id: "", nome: "", nivel: "" }), "língua"),
    ]),
    card("Certificações", [
      ...d.certificacoes.map((c, i) => el("div", { class: "ponto-ed" }, [idTag(c.id), inp(c, "nome", "Nome"), el("div", { class: "grid-2", style: "gap:8px" }, [inp(c, "entidade", "Entidade"), inp(c, "data", "Data (AAAA ou AAAA-MM)", { nulo: true })]), remover(d.certificacoes, i)])),
      adicionar(d.certificacoes, () => ({ id: "", nome: "", entidade: "", data: null }), "certificação"),
    ]),
    botao(r.base == null ? "Gravar como nova versão" : "Gravar alterações", () => {
      const n = mut((s, c) => {
        if (r.base == null) return P.guardarNovaVersao(s, r.dados, r.origem || "");
        P.atualizarRascunho(s, c, r.base, r.dados); return r.base;
      });
      ui.rascunhoPerfil = null; ui.perfilVersao = n; toast(`Versão v${n} gravada ✓ (por validar)`); render();
    }, "btn btn-primary btn-block"),
    el("button", { class: "btn btn-ghost btn-block", text: "Cancelar", onclick: () => { ui.rascunhoPerfil = null; render(); } }),
  ].filter(Boolean));
}

// ---------------------------------------------------------------- leitura

function leitura(p) {
  const linha = (id, txt, sub) => el("div", { class: "item" }, [el("div", { class: "grow" }, [el("div", { class: "t wrap", text: txt }), sub ? el("div", { class: "s", text: sub }) : null, el("div", { class: "ids", text: id })])]);
  const dp = p.dados_pessoais;
  return el("div", { class: "stack" }, [
    card(dp.nome || "(sem nome)", [el("div", { class: "tiny muted", text: [dp.email, dp.telefone, dp.localizacao, dp.linkedin].filter(Boolean).join(" · ") }),
      el("div", { class: "tiny", style: "margin-top:4px", text: `Experiência calculada: ${P.anosExperiencia(p)} anos` })]),
    p.resumo.length ? card("Resumo", [el("div", { class: "list" }, p.resumo.map((r) => linha(r.id, r.texto)))]) : null,
    ...p.experiencia.map((e) => card(`${e.cargo} — ${e.empresa}`, [el("div", { class: "tiny muted", text: [e.local, `${e.data_inicio || "?"} → ${e.data_fim || "?"}`, e.id].filter(Boolean).join(" · ") }),
      el("div", { class: "list" }, e.itens.map((i) => linha(i.id, i.texto, i.tipo)))])),
    p.formacao.length ? card("Formação", [el("div", { class: "list" }, p.formacao.map((f) => linha(f.id, `${f.grau}${f.instituicao ? " — " + f.instituicao : ""}`, `${f.data_inicio || "?"} → ${f.data_fim || "?"}`)))]) : null,
    p.competencias.length ? card("Competências", [el("div", { class: "list" }, p.competencias.map((c) => linha(c.id, c.nome, c.nivel)))]) : null,
    p.linguas.length ? card("Línguas", [el("div", { class: "list" }, p.linguas.map((l) => linha(l.id, l.nome, l.nivel)))]) : null,
    p.certificacoes.length ? card("Certificações", [el("div", { class: "list" }, p.certificacoes.map((c) => linha(c.id, c.nome, [c.entidade, c.data].filter(Boolean).join(" · "))))]) : null,
  ].filter(Boolean));
}

export function vistaPerfil() {
  if (ui.rascunhoPerfil) {
    const r = ui.rascunhoPerfil;
    return el("div", { class: "stack" }, [el("p", { class: "tiny muted", text: r.base == null ? "Nova versão do perfil-base. Os IDs dos itens existentes nunca mudam; os novos recebem ID ao gravar." : `A editar a versão v${r.base} (ainda não validada).` }), editor(r)]);
  }
  const e = estado(), c = cfg();
  const lista = P.versoes(e);
  const validada = c.perfil_validado;
  const ficheiro = el("input", { type: "file", accept: ".pdf,.docx,.txt", class: "hide" });
  ficheiro.addEventListener("change", async () => {
    const f = ficheiro.files[0]; if (!f) return;
    try { toast("A ler o CV…"); await importar(f); } catch (err) { toast(err.message, 5000); }
  });
  const topo = card("Perfil-base", [
    el("p", { class: "tiny muted", text: "A fonte única de verdade do CV. Só a versão validada é usada nos CVs adaptados. Uma versão validada é imutável: as alterações criam uma versão nova." }),
    el("div", { html: validada ? `<span class="tag good">Versão validada: v${validada}</span>` : '<span class="tag warn">Ainda não há versão validada</span>' }),
    el("div", { class: "row", style: "gap:8px;margin-top:10px;flex-wrap:wrap" }, [
      el("button", { class: "btn btn-primary", text: "Importar CV (PDF/Word)", onclick: () => ficheiro.click() }), ficheiro,
      el("button", { class: "btn", text: "Criar à mão", onclick: () => { ui.rascunhoPerfil = { base: null, dados: P.perfilVazio(), origem: "criado à mão" }; render(); } }),
    ]),
  ]);
  if (!lista.length) return el("div", { class: "stack" }, [topo]);

  const n = lista.some((v) => v.versao === ui.perfilVersao) ? ui.perfilVersao : (validada || lista[lista.length - 1].versao);
  const v = P.obterVersao(e, n);
  const p = P.normalizarPerfil(v.dados);
  const sel = UI.field("Versão", { type: "select", value: n, options: lista.map((x) => ({ value: x.versao, label: `v${x.versao}${x.versao === validada ? " ✓ validada" : ""}${x.notas ? " · " + x.notas : ""}` })) });
  sel.input.addEventListener("change", () => { ui.perfilVersao = Number(sel.input.value); render(); });
  const erros = P.validarPerfil(p, { exigirIds: true });
  const confirmar = el("input", { type: "checkbox" });
  const validarBtn = botao(`Validar a versão v${n}`, () => { mut((s, cc) => P.validarVersao(s, cc, n)); toast(`Versão v${n} validada ✓`); }, "btn btn-primary btn-block", { disabled: true });
  confirmar.addEventListener("change", () => { validarBtn.disabled = !confirmar.checked || erros.length > 0; });

  return el("div", { class: "stack" }, [
    topo, sel,
    erros.length ? card("Erros nesta versão", [el("ul", { class: "motivos" }, erros.map((x) => el("li", { text: x })))], { class: "alerta" }) : null,
    n === validada
      ? botao("Criar nova versão a partir desta", () => { ui.rascunhoPerfil = { base: null, dados: JSON.parse(JSON.stringify(p)), origem: `editado a partir de v${n}` }; render(); }, "btn btn-block")
      : el("div", { class: "stack" }, [
        botao("Editar esta versão", () => { ui.rascunhoPerfil = { base: n, dados: JSON.parse(JSON.stringify(p)) }; render(); }, "btn btn-block"),
        card("Validar", [el("label", { class: "row tiny", style: "gap:8px;align-items:flex-start;margin-bottom:10px" }, [confirmar, el("span", { text: `Revi a versão v${n} e confirmo que todos os itens são factos reais.` })]), validarBtn]),
      ]),
    leitura(p),
  ].filter(Boolean));
}
