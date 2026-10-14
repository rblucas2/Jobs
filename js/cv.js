/* M4 — Geração do CV adaptado e da carta, renderização, diff e fluxo de aprovação/exportação.

   Os cabeçalhos (cargo, empresa, datas, formação, línguas...) nunca são escritos pelo modelo:
   vêm diretamente do perfil-base pelos IDs. O modelo só escreve o texto dos pontos, cada um
   com source_ids. Sem modelo, o texto é copiado do perfil (a reformulação fica manual). */
import * as dados from "./dados.js";
import * as llm from "./llm.js";
import { indexar, normalizarPerfil, obterVersao, perfilValidado } from "./perfil.js";
import { normalizar } from "./texto.js";
import { problemas, validarCarta, validarCv, VERIFICADO } from "./validador.js";

const STOP = new Set(("a o os as de da do das dos e em no na nos nas um uma para por com sem que se ao aos the of and to in for with " +
  "on at an be is are our you your we will as or from this that who sua seu suas seus").split(" "));
const IDIOMAS = { pt: "português europeu", en: "inglês", fr: "francês" };

const termosVaga = (v) => new Set(normalizar(`${v.cargo || ""} ${v.descricao || ""}`).split(" ").filter((w) => w.length > 3 && !STOP.has(w)));
const relevancia = (texto, termos) => normalizar(texto).split(" ").filter((w, i, a) => termos.has(w) && a.indexOf(w) === i).length;
const ordemData = (e) => (e.data_fim === "atual" ? "9999" : e.data_fim || e.data_inicio || "0000");
const porRelevancia = (lista, f, termos) => lista.map((x, i) => [x, i]).sort((a, b) => relevancia(f(b[0]), termos) - relevancia(f(a[0]), termos) || a[1] - b[1]).map((x) => x[0]);

export function gerarPorRegras(perfil, vaga, cfg) {
  const termos = termosVaga(vaga);
  const maximo = Number(cfg.cv.max_pontos_por_experiencia || 5);
  const exps = [...perfil.experiencia].sort((a, b) => ordemData(b).localeCompare(ordemData(a)));
  return {
    idioma: cfg.cv.idioma || "pt", metodo: "regras",
    resumo: porRelevancia(perfil.resumo, (r) => r.texto, termos).map((r) => ({ texto: r.texto, source_ids: [r.id] })),
    experiencia: exps.map((e) => ({ experiencia_id: e.id,
      pontos: porRelevancia(e.itens, (i) => i.texto, termos).slice(0, maximo).map((i) => ({ texto: i.texto, source_ids: [i.id] })) })),
    formacao_ids: perfil.formacao.map((f) => f.id),
    competencias_ids: porRelevancia(perfil.competencias, (c) => c.nome, termos).map((c) => c.id),
    linguas_ids: perfil.linguas.map((l) => l.id),
    certificacoes_ids: porRelevancia(perfil.certificacoes, (c) => c.nome, termos).map((c) => c.id),
  };
}

const SISTEMA_CV = `Adaptas um CV a uma vaga usando APENAS factos do perfil-base fornecido.
Regras invioláveis:
1. Cada ponto tem source_ids com os IDs exatos dos itens do perfil de onde vem.
2. Podes reordenar, selecionar, omitir e reformular com o vocabulário da vaga, sem mudar o significado.
3. Nunca acrescentes factos: nenhum número, data, percentagem, ferramenta, certificação, língua,
   empresa, cliente ou resultado que não esteja escrito nos itens citados.
4. Os pontos de uma experiência só podem citar a própria experiência ou os seus itens.
   Não juntes ferramentas da lista de competências aos pontos de uma experiência.
5. Mantém os números exatamente como estão na origem.
6. O resumo (2-3 pontos) pode citar quaisquer itens, incluindo competências e línguas.
7. Em formacao_ids, competencias_ids, linguas_ids e certificacoes_ids indica os IDs a incluir, por ordem de relevância.
Os pontos que violem estas regras são bloqueados automaticamente.`;

const PONTO = { type: "object", required: ["texto", "source_ids"], properties: { texto: { type: "string" }, source_ids: { type: "array", items: { type: "string" } } } };
const IDS = { type: "array", items: { type: "string" } };
export const SCHEMA_CV = { type: "object", required: ["resumo", "experiencia", "formacao_ids", "competencias_ids", "linguas_ids", "certificacoes_ids"], properties: {
  resumo: { type: "array", items: PONTO },
  experiencia: { type: "array", items: { type: "object", required: ["experiencia_id", "pontos"], properties: { experiencia_id: { type: "string" }, pontos: { type: "array", items: PONTO } } } },
  formacao_ids: IDS, competencias_ids: IDS, linguas_ids: IDS, certificacoes_ids: IDS } };
const SCHEMA_CARTA = { type: "object", required: ["paragrafos"], properties: { paragrafos: { type: "array", items: PONTO } } };

const validarPontos = (lista, nome) => {
  llm.exigir(Array.isArray(lista), `${nome} tem de ser uma lista`);
  return lista.map((p) => { llm.exigir(p && typeof p.texto === "string", `${nome}: ponto sem texto`); return { texto: p.texto, source_ids: llm.listaDeTextos(p.source_ids || [], "source_ids") }; });
};

export function validarRespostaCv(o) {
  llm.exigir(o && Array.isArray(o.experiencia), "experiencia tem de ser uma lista");
  return {
    resumo: validarPontos(o.resumo || [], "resumo"),
    experiencia: o.experiencia.map((b) => ({ experiencia_id: String(b.experiencia_id || ""), pontos: validarPontos(b.pontos || [], "pontos") })),
    formacao_ids: llm.listaDeTextos(o.formacao_ids || [], "formacao_ids"), competencias_ids: llm.listaDeTextos(o.competencias_ids || [], "competencias_ids"),
    linguas_ids: llm.listaDeTextos(o.linguas_ids || [], "linguas_ids"), certificacoes_ids: llm.listaDeTextos(o.certificacoes_ids || [], "certificacoes_ids"),
  };
}

const perfilJson = (p) => JSON.stringify({ ...p, versao: undefined }, null, 1);
const textoVaga = (v) => `VAGA:\nCargo: ${v.cargo}\nEmpresa: ${v.empresa}\nDescrição:\n${v.descricao || ""}`;

/** gerar: função do modelo (por defeito llm.gerarJson) — permite simular nos testes. */
export async function gerarCv(perfil, vaga, cfg, { usarLLM, idioma, hoje, gerar = llm.gerarJson } = {}) {
  idioma = idioma || cfg.cv.idioma || "pt";
  if (usarLLM === undefined) usarLLM = cfg.ollama.ativo && (await llm.estado(cfg))[0];
  let cv = null;
  if (usarLLM) {
    try {
      const r = await gerar(cfg, SISTEMA_CV, `Escreve em ${IDIOMAS[idioma] || idioma}. Máximo de ${cfg.cv.max_pontos_por_experiencia} pontos por experiência.\n\n` +
        `PERFIL-BASE (JSON, cada item com 'id'):\n${perfilJson(perfil)}\n\n${textoVaga(vaga)}`, SCHEMA_CV, validarRespostaCv);
      cv = { ...r, idioma, metodo: "llm" };
    } catch (e) { cv = null; }
  }
  if (!cv) cv = { ...gerarPorRegras(perfil, vaga, cfg), idioma };
  return validarCv(cv, perfil, cfg, hoje);
}

const SISTEMA_CARTA = `Escreves o corpo de uma carta de apresentação (3 a 4 parágrafos curtos) usando APENAS
factos do perfil-base. Cada parágrafo tem source_ids com os IDs dos itens de onde vêm os factos.
Podes mencionar o cargo e a empresa da vaga. Não acrescentes números, ferramentas, certificações,
línguas, empresas ou resultados que não estejam nos itens citados. Não escrevas saudação nem despedida.`;

export async function gerarCarta(perfil, vaga, cfg, { usarLLM, idioma, hoje, gerar = llm.gerarJson } = {}) {
  idioma = idioma || cfg.cv.idioma || "pt";
  if (usarLLM === undefined) usarLLM = cfg.ollama.ativo && (await llm.estado(cfg))[0];
  let carta = null;
  if (usarLLM) {
    try {
      const r = await gerar(cfg, SISTEMA_CARTA, `Escreve em ${IDIOMAS[idioma] || idioma}.\n\nPERFIL-BASE:\n${perfilJson(perfil)}\n\n${textoVaga(vaga)}`,
        SCHEMA_CARTA, (o) => ({ paragrafos: validarPontos((o || {}).paragrafos, "paragrafos") }));
      carta = { ...r, idioma, metodo: "llm" };
    } catch (e) { carta = null; }
  }
  if (!carta) {
    // Sem modelo: parágrafos-base com os itens mais relevantes, copiados do perfil, para editar à mão.
    const termos = termosVaga(vaga);
    const itens = porRelevancia([...indexar(perfil).values()].filter((i) => i.tipo === "resumo" || i.tipo === "item_experiencia"), (i) => i.texto, termos).slice(0, 3);
    carta = { idioma, metodo: "regras", paragrafos: itens.map((i) => ({ texto: i.texto, source_ids: [i.id] })) };
  }
  return validarCarta(carta, perfil, cfg, vaga, hoje);
}

// ---------------------------------------------------------------- renderização

const ROTULOS = {
  pt: { resumo: "Perfil", experiencia: "Experiência Profissional", formacao: "Formação", competencias: "Competências", linguas: "Línguas", certificacoes: "Certificações", atual: "Atual" },
  en: { resumo: "Profile", experiencia: "Professional Experience", formacao: "Education", competencias: "Skills", linguas: "Languages", certificacoes: "Certifications", atual: "Present" },
  fr: { resumo: "Profil", experiencia: "Expérience professionnelle", formacao: "Formation", competencias: "Compétences", linguas: "Langues", certificacoes: "Certifications", atual: "Présent" },
};
const MESES = {
  pt: ["jan.", "fev.", "mar.", "abr.", "mai.", "jun.", "jul.", "ago.", "set.", "out.", "nov.", "dez."],
  en: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"],
  fr: ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."],
};
function data(v, idioma) {
  if (!v) return "";
  if (v === "atual") return (ROTULOS[idioma] || ROTULOS.pt).atual;
  return v.length >= 7 ? `${(MESES[idioma] || MESES.pt)[Number(v.slice(5, 7)) - 1]} ${v.slice(0, 4)}` : v;
}
export function periodo(a, b, idioma) { a = data(a, idioma); b = data(b, idioma); return a && b ? `${a} – ${b}` : a || b; }
const juntar = (xs, sep) => xs.filter(Boolean).join(sep);

/** Lista de [estilo, texto]. Estilos: nome, contactos, seccao, entrada, detalhe, ponto, texto. Só pontos verificados. */
export function blocosCv(cv, perfil) {
  const r = ROTULOS[cv.idioma] || ROTULOS.pt;
  const dp = perfil.dados_pessoais;
  const out = [["nome", dp.nome]];
  const contactos = juntar([dp.localizacao, dp.email, dp.telefone, dp.linkedin], " · ");
  if (contactos) out.push(["contactos", contactos]);
  const resumo = cv.resumo.filter((p) => p.estado === VERIFICADO);
  if (resumo.length) { out.push(["seccao", r.resumo]); resumo.forEach((p) => out.push(["texto", p.texto])); }
  const exps = new Map(perfil.experiencia.map((e) => [e.id, e]));
  const blocos = cv.experiencia.filter((b) => exps.has(b.experiencia_id));
  if (blocos.length) {
    out.push(["seccao", r.experiencia]);
    for (const b of blocos) {
      const e = exps.get(b.experiencia_id);
      out.push(["entrada", `${e.cargo} — ${e.empresa}`]);
      const det = juntar([e.local, periodo(e.data_inicio, e.data_fim, cv.idioma)], " · ");
      if (det) out.push(["detalhe", det]);
      b.pontos.filter((p) => p.estado === VERIFICADO).forEach((p) => out.push(["ponto", p.texto]));
    }
  }
  const sel = (lista, ids) => { const m = new Map(lista.map((x) => [x.id, x])); return ids.filter((i) => m.has(i)).map((i) => m.get(i)); };
  const forms = sel(perfil.formacao, cv.formacao_ids);
  if (forms.length) {
    out.push(["seccao", r.formacao]);
    for (const f of forms) {
      out.push(["entrada", f.grau + (f.instituicao ? ` — ${f.instituicao}` : "")]);
      const p = periodo(f.data_inicio, f.data_fim, cv.idioma);
      if (p) out.push(["detalhe", p]);
    }
  }
  const comps = sel(perfil.competencias, cv.competencias_ids);
  if (comps.length) { out.push(["seccao", r.competencias]); out.push(["texto", comps.map((c) => c.nome + (c.nivel ? ` (${c.nivel})` : "")).join(" · ")]); }
  const lings = sel(perfil.linguas, cv.linguas_ids);
  if (lings.length) { out.push(["seccao", r.linguas]); out.push(["texto", lings.map((l) => l.nome + (l.nivel ? ` — ${l.nivel}` : "")).join(" · ")]); }
  const certs = sel(perfil.certificacoes, cv.certificacoes_ids);
  if (certs.length) { out.push(["seccao", r.certificacoes]); certs.forEach((c) => out.push(["ponto", juntar([c.nome, c.entidade, c.data], " · ")])); }
  return out;
}

export function blocosCarta(carta, perfil, vaga, cfg) {
  const dp = perfil.dados_pessoais;
  const out = [["nome", dp.nome]];
  const contactos = juntar([dp.localizacao, dp.email, dp.telefone], " · ");
  if (contactos) out.push(["contactos", contactos]);
  out.push(["entrada", `${vaga.cargo || ""} — ${vaga.empresa || ""}`]);
  out.push(["texto", cfg.carta.abertura || ""]);
  carta.paragrafos.filter((p) => p.estado === VERIFICADO).forEach((p) => out.push(["texto", p.texto]));
  out.push(["texto", cfg.carta.fecho || ""]);
  out.push(["texto", dp.nome]);
  return out;
}

const esc = (s) => String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function htmlDocumento(blocos) {
  const partes = ['<div class="cvdoc">'];
  let lista = false;
  for (const [estilo, texto] of blocos) {
    if (estilo === "ponto") { if (!lista) { partes.push("<ul>"); lista = true; } partes.push(`<li>${esc(texto)}</li>`); continue; }
    if (lista) { partes.push("</ul>"); lista = false; }
    partes.push(`<div class="${estilo}">${esc(texto)}</div>`);
  }
  if (lista) partes.push("</ul>");
  partes.push("</div>");
  return partes.join("");
}

/** Formato fixo do CV (o "modelo" aprovado uma vez nas Definições). Usado no ecrã, na impressão/PDF e no Word. */
export const CSS_DOCUMENTO = `
.cvdoc{font-family:Calibri,Carlito,Arial,sans-serif;color:#111;background:#fff;font-size:10.5pt;line-height:1.35;max-width:780px}
.cvdoc .nome{font-size:20pt;font-weight:700;color:#1F3864}
.cvdoc .contactos{color:#595959;font-size:9.5pt;margin-bottom:8pt}
.cvdoc .seccao{color:#1F3864;font-weight:700;font-size:11.5pt;margin-top:10pt;margin-bottom:3pt}
.cvdoc .entrada{font-weight:700;margin-top:5pt}
.cvdoc .detalhe{color:#595959;font-style:italic;font-size:9.5pt;margin-bottom:2pt}
.cvdoc .texto{margin-bottom:4pt}
.cvdoc ul{margin:0 0 0 18pt;padding:0}.cvdoc li{margin-bottom:1pt}`;

// ---------------------------------------------------------------- diff (palavras)

const palavras = (t) => String(t || "").match(/\S+|\s+/g) || [];

/** HTML do texto adaptado: <ins> = palavras novas, <del> = palavras retiradas da origem. */
export function diffHtml(origem, adaptado) {
  const a = palavras(origem), b = palavras(adaptado);
  const n = a.length, m = b.length;
  const L = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = a[i] === b[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const out = []; let i = 0, j = 0, del = [], ins = [];
  const flush = () => {
    const d = del.join(""), s = ins.join("");
    if (d.trim()) out.push(`<del>${esc(d)}</del>`);
    if (s) out.push(s.trim() ? `<ins>${esc(s)}</ins>` : esc(s));
    del = []; ins = [];
  };
  while (i < n || j < m) {
    if (i < n && j < m && a[i] === b[j]) { flush(); out.push(esc(b[j])); i++; j++; }
    else if (j < m && (i >= n || L[i][j + 1] >= L[i + 1][j])) { ins.push(b[j]); j++; }
    else { del.push(a[i]); i++; }
  }
  flush();
  return out.join("");
}

export function textoOrigem(ids, idx) {
  const partes = ids.filter((i) => idx.has(i) && !["experiencia", "formacao"].includes(idx.get(i).tipo)).map((i) => idx.get(i).texto);
  return (partes.length ? partes : ids.filter((i) => idx.has(i)).map((i) => idx.get(i).texto)).join(" | ");
}

// ---------------------------------------------------------------- fluxo: rascunho → aprovado → exportado

export class AprovacaoRecusada extends Error {}

function perfilDoRegisto(estado, registo) {
  const v = obterVersao(estado, registo.versao_perfil);
  if (!v) throw new AprovacaoRecusada(`A versão v${registo.versao_perfil} do perfil já não existe.`);
  return { ...normalizarPerfil(v.dados), versao: v.versao };
}

export async function criarRascunho(estado, cfg, vagaId, { tipo = "cv", usarLLM, idioma, hoje, gerar } = {}) {
  const perfil = perfilValidado(estado, cfg);
  if (!perfil) throw new Error("Ainda não há um perfil-base validado. Valide-o no separador Perfil.");
  const vaga = dados.obterVaga(estado, vagaId);
  const doc = tipo === "carta" ? await gerarCarta(perfil, vaga, cfg, { usarLLM, idioma, hoje, gerar }) : await gerarCv(perfil, vaga, cfg, { usarLLM, idioma, hoje, gerar });
  return dados.guardarCv(estado, vagaId, tipo, perfil.versao, doc);
}

export function revalidar(estado, cfg, registo, conteudo = registo.conteudo, hoje) {
  const perfil = perfilDoRegisto(estado, registo);
  return registo.tipo === "carta"
    ? validarCarta(conteudo, perfil, cfg, dados.obterVaga(estado, registo.vaga_id) || {}, hoje)
    : validarCv(conteudo, perfil, cfg, hoje);
}

/** Qualquer edição é revalidada antes de ser gravada. */
export function editar(estado, cfg, cvId, conteudo, hoje) {
  const registo = dados.obterCv(estado, cvId);
  const doc = revalidar(estado, cfg, registo, conteudo, hoje);
  dados.atualizarConteudoCv(estado, cvId, doc);
  return doc;
}

export function aprovar(estado, cfg, cvId, confirmado, hoje) {
  if (!confirmado) throw new AprovacaoRecusada("A aprovação tem de ser confirmada explicitamente.");
  const registo = dados.obterCv(estado, cvId);
  if (registo.estado !== "rascunho") throw new AprovacaoRecusada(`Só rascunhos podem ser aprovados (estado atual: ${registo.estado}).`);
  const doc = revalidar(estado, cfg, registo, registo.conteudo, hoje);
  const falhas = problemas(doc);
  if (falhas.length) throw new AprovacaoRecusada("Há pontos por resolver:\n- " + falhas.join("\n- "));
  dados.atualizarConteudoCv(estado, cvId, doc);
  dados.definirEstadoCv(estado, cvId, "aprovado");
}

export function rejeitar(estado, cvId) {
  const registo = dados.obterCv(estado, cvId);
  if (registo.estado !== "rascunho") throw new AprovacaoRecusada("Só rascunhos podem ser rejeitados.");
  dados.definirEstadoCv(estado, cvId, "rejeitado");
}

export function blocos(estado, cfg, registo) {
  const perfil = perfilDoRegisto(estado, registo);
  return registo.tipo === "carta" ? blocosCarta(registo.conteudo, perfil, dados.obterVaga(estado, registo.vaga_id) || {}, cfg) : blocosCv(registo.conteudo, perfil);
}

/** Verifica se pode exportar: aprovado, formato aprovado e ainda válido. Liga o CV à vaga no tracker. */
export function prepararExportacao(estado, cfg, cvId, hoje) {
  const registo = dados.obterCv(estado, cvId);
  if (registo.estado !== "aprovado") throw new AprovacaoRecusada("Só documentos aprovados podem ser exportados.");
  if (!cfg.cv.modelo_aprovado) throw new AprovacaoRecusada("O formato do CV ainda não foi aprovado (Definições → Formato do CV).");
  if (problemas(revalidar(estado, cfg, registo, registo.conteudo, hoje)).length) throw new AprovacaoRecusada("O documento já não passa no validador; gere um novo rascunho.");
  if (registo.tipo === "cv") dados.atualizarCandidatura(estado, registo.vaga_id, { cv_id: cvId });
  return blocos(estado, cfg, registo);
}

export function nomeFicheiro(registo, vaga) {
  const base = `${registo.tipo === "carta" ? "Carta" : "CV"} ${vaga ? vaga.empresa || "" : ""} ${vaga ? vaga.cargo || "" : ""}`.trim();
  return base.replace(/[\\/:*?"<>|]+/g, "").replace(/\s+/g, "_").slice(0, 80) || "documento";
}

/** Word (.docx) com a biblioteca docx (carregada no browser). Devolve um Blob. */
export async function gerarDocx(blocosDoc, lib = globalThis.docx) {
  if (!lib) throw new Error("O gerador de Word não carregou (sem ligação?).");
  const { Document, Packer, Paragraph, TextRun } = lib;
  const pt = (n) => Math.round(n * 2); // docx usa meios-pontos para o tamanho
  const estilo = {
    nome: { size: pt(20), bold: true, color: "1F3864", after: 0 },
    contactos: { size: pt(9.5), color: "595959", after: 160 },
    seccao: { size: pt(11.5), bold: true, color: "1F3864", before: 200, after: 60 },
    entrada: { size: pt(10.5), bold: true, before: 100, after: 0 },
    detalhe: { size: pt(9.5), italics: true, color: "595959", after: 40 },
    ponto: { size: pt(10.5), after: 20, bullet: true },
    texto: { size: pt(10.5), after: 80 },
  };
  const paragrafos = blocosDoc.map(([e, texto]) => {
    const s = estilo[e] || estilo.texto;
    return new Paragraph({
      children: [new TextRun({ text: texto, size: s.size, bold: s.bold, italics: s.italics, color: s.color, font: "Calibri" })],
      bullet: s.bullet ? { level: 0 } : undefined,
      spacing: { before: s.before || 0, after: s.after || 0 },
    });
  });
  const doc = new Document({ sections: [{ properties: { page: { margin: { top: 840, bottom: 840, left: 1000, right: 1000 } } }, children: paragrafos }] });
  return Packer.toBlob(doc);
}
