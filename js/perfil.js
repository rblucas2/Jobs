/* M2 — Perfil-base (fonte única de verdade): validação, IDs estáveis, versões e extração do CV.

   Estrutura de um perfil:
   { dados_pessoais: {nome, email, telefone, localizacao, linkedin},
     resumo: [{id, texto, tipo}],
     experiencia: [{id, cargo, empresa, local, data_inicio, data_fim, itens: [{id, texto, tipo}]}],
     formacao: [{id, grau, instituicao, data_inicio, data_fim, itens: [...]}],
     competencias: [{id, nome, categoria, nivel}], linguas: [{id, nome, nivel}],
     certificacoes: [{id, nome, entidade, data}] }
*/
import { normalizar, slug, hojeISO } from "./texto.js";

const DATA = /^(\d{4})(-(0[1-9]|1[0-2]))?$/;
const ATUAL = /^(atual|presente|present|current)$/i;

export function perfilVazio() {
  return {
    dados_pessoais: { nome: "", email: "", telefone: "", localizacao: "", linkedin: "" },
    resumo: [], experiencia: [], formacao: [], competencias: [], linguas: [], certificacoes: [],
  };
}

/** Normaliza datas e campos em falta (sem inventar conteúdo). */
export function normalizarPerfil(p) {
  const out = { ...perfilVazio(), ...JSON.parse(JSON.stringify(p || {})) };
  out.dados_pessoais = { ...perfilVazio().dados_pessoais, ...(out.dados_pessoais || {}) };
  const dt = (v, atual) => {
    if (v == null || v === "") return null;
    v = String(v).trim();
    if (atual && ATUAL.test(v)) return "atual";
    return v;
  };
  for (const e of out.experiencia) { e.data_inicio = dt(e.data_inicio, false); e.data_fim = dt(e.data_fim, true); e.itens = e.itens || []; }
  for (const f of out.formacao) { f.data_inicio = dt(f.data_inicio, false); f.data_fim = dt(f.data_fim, true); f.itens = f.itens || []; }
  for (const c of out.certificacoes) c.data = dt(c.data, false);
  return out;
}

export function todosIds(p) {
  const ids = (p.resumo || []).map((i) => i.id);
  for (const e of p.experiencia || []) { ids.push(e.id); (e.itens || []).forEach((i) => ids.push(i.id)); }
  for (const f of p.formacao || []) { ids.push(f.id); (f.itens || []).forEach((i) => ids.push(i.id)); }
  for (const g of ["competencias", "linguas", "certificacoes"]) (p[g] || []).forEach((x) => ids.push(x.id));
  return ids;
}

/** Devolve a lista de erros (vazia = válido). */
export function validarPerfil(p, { exigirIds = false } = {}) {
  const erros = [];
  const contagem = {};
  for (const id of todosIds(p)) {
    if (!id) { if (exigirIds) erros.push("Há itens sem ID."); continue; }
    contagem[id] = (contagem[id] || 0) + 1;
    if (!/^[a-z0-9_]+$/.test(id)) erros.push(`ID inválido (use minúsculas, dígitos e _): ${id}`);
  }
  const dup = Object.keys(contagem).filter((i) => contagem[i] > 1);
  if (dup.length) erros.push("IDs repetidos: " + dup.join(", "));
  const verData = (v, atual, onde) => {
    if (v == null) return;
    if (atual && v === "atual") return;
    if (!DATA.test(v)) erros.push(`Data inválida em ${onde}: '${v}' (use AAAA ou AAAA-MM${atual ? " ou 'atual'" : ""})`);
  };
  for (const e of p.experiencia || []) {
    if (!e.cargo || !e.empresa) erros.push(`Experiência ${e.id || "?"} sem cargo ou empresa.`);
    verData(e.data_inicio, false, e.id); verData(e.data_fim, true, e.id);
  }
  for (const f of p.formacao || []) { verData(f.data_inicio, false, f.id); verData(f.data_fim, true, f.id); }
  for (const c of p.certificacoes || []) verData(c.data, false, c.id);
  return [...new Set(erros)];
}

// ---------------------------------------------------------------- IDs estáveis

function proximo(prefixo, usados) {
  let i = 1;
  while (usados.has(`${prefixo}_${String(i).padStart(2, "0")}`)) i++;
  const novo = `${prefixo}_${String(i).padStart(2, "0")}`;
  usados.add(novo);
  return novo;
}

/** Atribui IDs só aos itens que ainda não têm. IDs existentes nunca mudam. */
export function atribuirIds(p) {
  const usados = new Set(todosIds(p).filter(Boolean));
  const base = (prefixo) => { if (!usados.has(prefixo)) { usados.add(prefixo); return prefixo; } return proximo(prefixo, usados); };
  for (const r of p.resumo) if (!r.id) r.id = proximo("resumo", usados);
  for (const e of p.experiencia) {
    if (!e.id) e.id = base(`exp_${slug(e.empresa).slice(0, 30)}`);
    for (const i of e.itens) if (!i.id) i.id = proximo(e.id, usados);
  }
  for (const f of p.formacao) {
    if (!f.id) f.id = base(`form_${slug(f.instituicao || f.grau).slice(0, 30)}`);
    for (const i of f.itens) if (!i.id) i.id = proximo(f.id, usados);
  }
  for (const c of p.competencias) if (!c.id) c.id = base(`comp_${slug(c.nome).slice(0, 30)}`);
  for (const l of p.linguas) if (!l.id) l.id = base(`ling_${slug(l.nome).slice(0, 30)}`);
  for (const c of p.certificacoes) if (!c.id) c.id = base(`cert_${slug(c.nome).slice(0, 30)}`);
  return p;
}

// ---------------------------------------------------------------- índice

const juntar = (...xs) => xs.filter(Boolean).join(" ");

/** Map id -> {id, tipo, texto, contexto, pai}. Usado pelo validador e pela compatibilidade. */
export function indexar(p) {
  const idx = new Map();
  for (const r of p.resumo || []) idx.set(r.id, { id: r.id, tipo: "resumo", texto: r.texto, contexto: r.texto, pai: null });
  for (const e of p.experiencia || []) {
    const cab = juntar(e.cargo, e.empresa, e.local, e.data_inicio, e.data_fim);
    idx.set(e.id, { id: e.id, tipo: "experiencia", texto: cab, contexto: cab, pai: null });
    for (const i of e.itens || []) idx.set(i.id, { id: i.id, tipo: "item_experiencia", texto: i.texto, contexto: `${i.texto}\n${cab}`, pai: e.id });
  }
  for (const f of p.formacao || []) {
    const cab = juntar(f.grau, f.instituicao, f.data_inicio, f.data_fim);
    idx.set(f.id, { id: f.id, tipo: "formacao", texto: cab, contexto: cab, pai: null });
    for (const i of f.itens || []) idx.set(i.id, { id: i.id, tipo: "item_formacao", texto: i.texto, contexto: `${i.texto}\n${cab}`, pai: f.id });
  }
  for (const c of p.competencias || []) { const t = juntar(c.nome, c.nivel); idx.set(c.id, { id: c.id, tipo: "competencia", texto: t, contexto: t, pai: null }); }
  for (const l of p.linguas || []) { const t = juntar(l.nome, l.nivel); idx.set(l.id, { id: l.id, tipo: "lingua", texto: t, contexto: t, pai: null }); }
  for (const c of p.certificacoes || []) { const t = juntar(c.nome, c.entidade, c.data); idx.set(c.id, { id: c.id, tipo: "certificacao", texto: t, contexto: t, pai: null }); }
  return idx;
}

function mes(v, fim, hoje) {
  if (!v) return null;
  if (v === "atual") { const h = new Date(hoje + "T00:00:00"); return [h.getFullYear(), h.getMonth() + 1]; }
  const a = Number(v.slice(0, 4));
  const m = v.length >= 7 ? Number(v.slice(5, 7)) : (fim ? 12 : 1);
  return [a, m];
}

/** Anos de experiência profissional, sem contar sobreposições. */
export function anosExperiencia(p, hoje = hojeISO()) {
  const intervalos = [];
  for (const e of p.experiencia || []) {
    const i = mes(e.data_inicio, false, hoje);
    if (!i) continue;
    const f = mes(e.data_fim, true, hoje) || i;
    intervalos.push([i[0] * 12 + i[1] - 1, f[0] * 12 + f[1]]);
  }
  intervalos.sort((a, b) => a[0] - b[0]);
  let total = 0, atual = null;
  for (const [a, b] of intervalos) {
    if (!atual || a > atual[1]) { if (atual) total += atual[1] - atual[0]; atual = [a, b]; }
    else atual[1] = Math.max(atual[1], b);
  }
  if (atual) total += atual[1] - atual[0];
  return Math.round((total / 12) * 10) / 10;
}

// ---------------------------------------------------------------- versões
// estado.perfis = [{id: "v1", versao: 1, dados, notas, criado}]; cfg.perfil_validado = n

export function versoes(estado) {
  return [...(estado.perfis || [])].sort((a, b) => a.versao - b.versao);
}

export function obterVersao(estado, n) {
  return (estado.perfis || []).find((v) => v.versao === Number(n)) || null;
}

export function perfilValidado(estado, cfg) {
  const n = cfg.perfil_validado;
  const v = n != null ? obterVersao(estado, n) : null;
  return v ? { ...normalizarPerfil(v.dados), versao: v.versao } : null;
}

export function guardarNovaVersao(estado, dados, notas = "") {
  const n = Math.max(0, ...(estado.perfis || []).map((v) => v.versao)) + 1;
  const p = atribuirIds(normalizarPerfil(dados));
  const erros = validarPerfil(p);
  if (erros.length) throw new Error(erros.join("\n"));
  estado.perfis = estado.perfis || [];
  estado.perfis.push({ id: "v" + n, versao: n, dados: p, notas, criado: new Date().toISOString(), _u: Date.now() });
  return n;
}

export function atualizarRascunho(estado, cfg, n, dados) {
  if (Number(cfg.perfil_validado) === Number(n)) throw new Error("A versão validada é imutável. Crie uma nova versão.");
  const v = obterVersao(estado, n);
  if (!v) throw new Error("Versão inexistente.");
  const p = atribuirIds(normalizarPerfil(dados));
  const erros = validarPerfil(p);
  if (erros.length) throw new Error(erros.join("\n"));
  v.dados = p; v._u = Date.now();
}

export function validarVersao(estado, cfg, n) {
  const v = obterVersao(estado, n);
  if (!v) throw new Error("Versão inexistente.");
  const erros = validarPerfil(normalizarPerfil(v.dados), { exigirIds: true });
  if (erros.length) throw new Error(erros.join("\n"));
  cfg.perfil_validado = Number(n);
}

// ---------------------------------------------------------------- extração do CV

const SECCOES = {
  resumo: "(perfil|resumo|sobre mim|summary|profile|about me|objetivo|objective)",
  experiencia: "(experi[eê]ncia( profissional)?|percurso profissional|(professional |work )?experience|employment)",
  formacao: "(forma[cç][aã]o( acad[eé]mica)?|educa[cç][aã]o|education|habilita[cç][oõ]es)",
  competencias: "(compet[eê]ncias|skills|conhecimentos|ferramentas|inform[aá]tica|technical skills)",
  linguas: "(l[ií]nguas|idiomas|languages)",
  certificacoes: "(certifica[cç][oõ]es|certifica[cç][aã]o|certifications|cursos|courses)",
};
const CABECALHO = Object.fromEntries(Object.entries(SECCOES).map(([k, v]) => [k, new RegExp(`^\\s*${v}\\s*:?\\s*$`, "i")]));
const MESES = { jan: 1, fev: 2, feb: 2, mar: 3, abr: 4, apr: 4, mai: 5, may: 5, jun: 6, jul: 7, ago: 8, aug: 8, set: 9, sep: 9, out: 10, oct: 10, nov: 11, dez: 12, dec: 12 };
const _MES = "(?:(?:jan|fev|feb|mar|abr|apr|mai|may|jun|jul|ago|aug|set|sep|out|oct|nov|dez|dec)[a-zç]*\\.?\\s*|\\d{1,2}[/.-])?";
const INTERVALO = new RegExp(`(${_MES}\\d{4})\\s*(?:-|–|—|a|até|to)\\s*(${_MES}\\d{4}|atual|atualmente|presente|present|current|hoje|now)`, "i");
const MARCADOR = /^\s*[•▪●◦\-–*·]\s*/;
const RESULTADO = /(\d|%|aument|reduz|poupan|cresc|melhor|increas|reduc|sav|grew|improv)/i;
const NIVEL = /\b(A1|A2|B1|B2|C1|C2|nativ[oa]|native|materna|fluente|fluent|avançado|advanced|intermédio|intermediate|básico|basic)\b/i;

function dataDe(token) {
  const t = token.trim().toLowerCase();
  if (/^(atual|atualmente|presente|present|current|hoje|now)$/.test(t)) return "atual";
  const ano = t.match(/(\d{4})/);
  if (!ano) return null;
  let m = null;
  const a = t.match(/^([a-zç]{3})/);
  if (a && MESES[a[1]]) m = MESES[a[1]];
  const b = t.match(/^(\d{1,2})[/.-]/);
  if (b && Number(b[1]) >= 1 && Number(b[1]) <= 12) m = Number(b[1]);
  return m ? `${ano[1]}-${String(m).padStart(2, "0")}` : ano[1];
}

function dividirSeccoes(texto) {
  const s = { _topo: [] };
  let atual = "_topo";
  for (const linha of texto.split(/\r?\n/)) {
    const l = linha.trim();
    if (!l) continue;
    const nova = Object.keys(CABECALHO).find((k) => CABECALHO[k].test(l));
    if (nova) { atual = nova; s[atual] = s[atual] || []; continue; }
    (s[atual] = s[atual] || []).push(l);
  }
  return s;
}

function cargoEmpresa(linhas) {
  linhas = linhas.map((l) => l.replace(INTERVALO, "").trim().replace(/^[|,–\-·\s]+|[|,–\-·\s]+$/g, "")).filter(Boolean);
  if (!linhas.length) return ["", "", ""];
  if (linhas.length === 1) {
    const partes = linhas[0].split(/\s+(?:\||–|—|-|@|·)\s+|,\s+/).map((p) => p.trim()).filter(Boolean);
    return [partes[0] || "", partes[1] || "", partes[2] || ""];
  }
  let [cargo, empresa] = linhas;
  let local = linhas[2] || "";
  if (empresa.includes(",") && !local) { const i = empresa.indexOf(","); local = empresa.slice(i + 1).trim(); empresa = empresa.slice(0, i).trim(); }
  return [cargo, empresa, local];
}

/** Agrupa linhas em entradas [cabecalho, inicio, fim, pontos], cada uma marcada por um intervalo de datas. */
function entradas(linhas) {
  const out = [];
  let pendentes = [];
  let atual = null;
  const descarregar = (manter) => {
    const resto = manter ? pendentes.slice(0, pendentes.length - manter) : pendentes.slice();
    if (atual) atual[3].push(...resto);
    const fica = manter ? pendentes.slice(pendentes.length - manter) : [];
    pendentes = [];
    return fica;
  };
  for (const l of linhas) {
    const m = l.match(INTERVALO);
    if (m) {
      const cab = descarregar(Math.min(2, pendentes.length));
      atual = [[...cab, l], dataDe(m[1]), dataDe(m[2]), []];
      out.push(atual);
    } else if (MARCADOR.test(l)) {
      descarregar(0);
      if (atual) atual[3].push(l.replace(MARCADOR, ""));
    } else if (atual && !atual[3].length && !pendentes.length && atual[0].length < 3) {
      atual[0].push(l);
    } else if (!pendentes.length && atual && atual[3].length && /^[a-zà-ÿ]/.test(l)) {
      atual[3][atual[3].length - 1] += " " + l;
    } else {
      pendentes.push(l);
    }
  }
  descarregar(0);
  return out;
}

function lista(linhas) {
  const itens = [];
  for (const l of linhas) {
    for (let p of l.replace(MARCADOR, "").split(/[,;•▪●|]|\s{2,}/)) {
      p = p.trim().replace(/^[ .:]+|[ .:]+$/g, "");
      if (p && p.length <= 80) itens.push(p);
    }
  }
  return itens;
}

export function propostaPorRegras(texto) {
  const s = dividirSeccoes(texto);
  const topo = s._topo || [];
  const p = perfilVazio();
  p.dados_pessoais.nome = topo[0] || "";
  p.dados_pessoais.email = (texto.match(/[\w.+-]+@[\w-]+\.[\w.]+/) || [""])[0];
  p.dados_pessoais.telefone = ((topo.join("\n").match(/(\+?\d[\d ]{8,15}\d)/) || [""])[0]).trim();
  p.dados_pessoais.linkedin = (texto.match(/(https?:\/\/)?(www\.)?linkedin\.com\/in\/[\w-]+\/?/) || [""])[0];
  p.resumo = (s.resumo || []).map((t) => ({ id: "", texto: t, tipo: "resumo" }));
  for (const [cab, ini, fim, pontos] of entradas(s.experiencia || [])) {
    const [cargo, empresa, local] = cargoEmpresa(cab);
    p.experiencia.push({ id: "", cargo: cargo || "?", empresa: empresa || "?", local, data_inicio: ini, data_fim: fim,
      itens: pontos.map((t) => ({ id: "", texto: t, tipo: RESULTADO.test(t) ? "resultado" : "responsabilidade" })) });
  }
  for (const [cab, ini, fim, pontos] of entradas(s.formacao || [])) {
    const [grau, inst] = cargoEmpresa(cab);
    p.formacao.push({ id: "", grau: grau || "?", instituicao: inst, data_inicio: ini, data_fim: fim,
      itens: pontos.map((t) => ({ id: "", texto: t, tipo: "detalhe" })) });
  }
  for (const nome of lista(s.competencias || [])) p.competencias.push({ id: "", nome, categoria: "tecnica", nivel: "" });
  for (const l of s.linguas || []) {
    for (let parte of l.replace(MARCADOR, "").split(/[,;•|]/)) {
      parte = parte.trim();
      if (!parte) continue;
      const nivel = parte.match(NIVEL);
      const nome = parte.split(/\s*[-–:(]\s*/)[0].replace(nivel ? new RegExp("\\s+" + nivel[0] + "$") : /$^/, "").trim();
      p.linguas.push({ id: "", nome, nivel: nivel ? nivel[0] : "" });
    }
  }
  for (let l of s.certificacoes || []) {
    l = l.replace(MARCADOR, "").trim();
    const ano = l.match(/\b(19|20)\d{2}\b/);
    p.certificacoes.push({ id: "", nome: l.replace(/\(?\b(19|20)\d{2}\b\)?/, "").trim().replace(/^[ \-–,]+|[ \-–,]+$/g, ""), entidade: "", data: ano ? ano[0] : null });
  }
  return atribuirIds(p);
}

/** Maior substring comum (comprimento), para verificar itens contra o CV original. */
function maiorComum(a, b) {
  let melhor = 0;
  let prev = new Uint16Array(b.length + 1);
  for (let i = 1; i <= a.length; i++) {
    const cur = new Uint16Array(b.length + 1);
    for (let j = 1; j <= b.length; j++) {
      if (a.charCodeAt(i - 1) === b.charCodeAt(j - 1)) { cur[j] = prev[j - 1] + 1; if (cur[j] > melhor) melhor = cur[j]; }
    }
    prev = cur;
  }
  return melhor;
}

/** Itens da proposta que não aparecem (quase) literalmente no CV original — para rever. */
export function itensNaoEncontrados(perfil, textoCv, limiar = 0.85) {
  const alvo = normalizar(textoCv);
  const falhas = [];
  for (const it of indexar(perfil).values()) {
    if (it.tipo === "experiencia" || it.tipo === "formacao") continue;
    const t = normalizar(it.texto);
    if (!t || alvo.includes(t)) continue;
    if (maiorComum(t, alvo) / Math.max(1, t.length) < limiar) falhas.push([it.id, it.texto]);
  }
  return falhas;
}

/** Extrai o texto de um ficheiro de CV no browser (PDF via pdf.js, Word via mammoth). */
export async function extrairTexto(ficheiro) {
  const nome = ficheiro.name.toLowerCase();
  const dados = await ficheiro.arrayBuffer();
  if (nome.endsWith(".pdf")) {
    const lib = globalThis.pdfjsLib;
    if (!lib) throw new Error("O leitor de PDF não carregou (sem ligação?).");
    const pdf = await lib.getDocument({ data: dados }).promise;
    const paginas = [];
    for (let i = 1; i <= pdf.numPages; i++) {
      const c = await (await pdf.getPage(i)).getTextContent();
      // Reconstrói linhas pela posição vertical dos fragmentos.
      const linhas = []; let ultimoY = null;
      for (const it of c.items) {
        const y = Math.round(it.transform[5]);
        if (ultimoY === null || Math.abs(y - ultimoY) > 2) linhas.push(it.str); else linhas[linhas.length - 1] += it.str;
        ultimoY = y;
      }
      paginas.push(linhas.join("\n"));
    }
    return paginas.join("\n");
  }
  if (nome.endsWith(".docx")) {
    const lib = globalThis.mammoth;
    if (!lib) throw new Error("O leitor de Word não carregou (sem ligação?).");
    const r = await lib.convertToHtml({ arrayBuffer: dados });
    const doc = new DOMParser().parseFromString(r.value, "text/html");
    return [...doc.body.querySelectorAll("p, li, h1, h2, h3, h4, td")]
      .map((n) => (n.tagName === "LI" ? "• " : "") + n.textContent.trim()).filter(Boolean).join("\n");
  }
  if (nome.endsWith(".txt") || nome.endsWith(".md")) return new TextDecoder().decode(dados);
  throw new Error("Formato não suportado: use PDF ou Word (.docx).");
}
