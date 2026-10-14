/* M4 — Validador automático do CV adaptado. Corre sempre antes de um CV ser mostrado,
   a cada edição, na aprovação e na exportação.

   Um ponto fica "não verificado" (bloqueado) se:
     1. não tiver source_ids, ou citar um ID que não existe no perfil-base;
     2. citar itens de outra secção (um ponto da experiência A que cita a experiência B, ou uma
        competência — o que acrescentaria o facto "usei X neste cargo");
     3. contiver um número, data ou percentagem que não exista nos itens de origem
        (inclui números por extenso e multiplicadores como "mil", "milhões", "k");
     4. mencionar uma ferramenta, certificação, competência ou língua ausente dos itens de origem;
     5. usar termos quantitativos ou de distinção ("duplicou", "melhor", "prémio"...) ausentes da origem;
     6. mencionar um nome próprio/sigla (empresa, cliente, norma) ausente da origem.

   Exceção documentada: no resumo (e na carta), "N anos de experiência" é aceite se N não exceder
   os anos calculados a partir das datas do perfil e o ponto citar uma experiência.

   É deliberadamente conservador: prefere bloquear um ponto legítimo (que se corrige à mão)
   a deixar passar um facto que não está no perfil. */
import { LINGUAS } from "./compat.js";
import { anosExperiencia, indexar } from "./perfil.js";
import { normalizar, regexTermo, semAcentos, sinonimos } from "./texto.js";

export const VERIFICADO = "verificado";
export const NAO_VERIFICADO = "nao_verificado";

// ---------------------------------------------------------------- números

const SEP = "[.,\\u00a0\\u202f ]";
export const NUMERO = new RegExp(`(?<!\\d)\\d+(?:${SEP}\\d{3}(?!\\d))*(?:[.,]\\d+)?`, "g");
const PERCENT = new RegExp(`(\\d+(?:${SEP}\\d{3}(?!\\d))*(?:[.,]\\d+)?)\\s*(%|por\\s*cento|percent|pct\\b|p\\.?\\s?p\\.?)`, "gi");

const PALAVRAS_NUMERO = {
  dois: 2, duas: 2, tres: 3, quatro: 4, cinco: 5, seis: 6, sete: 7, oito: 8, nove: 9, dez: 10, onze: 11, doze: 12,
  treze: 13, catorze: 14, quatorze: 14, quinze: 15, dezasseis: 16, dezesseis: 16, dezassete: 17, dezessete: 17, dezoito: 18,
  dezanove: 19, dezenove: 19, vinte: 20, trinta: 30, quarenta: 40, cinquenta: 50, sessenta: 60, setenta: 70, oitenta: 80,
  noventa: 90, cem: 100, cento: 100, duzentos: 200, trezentos: 300, quinhentos: 500,
  two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13,
  fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40,
  fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90, hundred: 100,
};
const MULTIPLICADORES = new Set(["mil", "milhao", "milhoes", "milhar", "milhares", "bilhao", "bilhoes", "dezenas", "centenas", "duzia",
  "duzias", "thousand", "thousands", "million", "millions", "billion", "billions", "dozen", "dozens", "hundreds", "k", "m", "mm", "bn", "mn"]);
const QUANT_PREFIXOS = ["duplic", "dobr", "tripl", "quadrupl", "doubl", "halv", "premi", "award", "galardo"];
const QUANT_PALAVRAS = new Set(["metade", "half", "melhor", "melhores", "best", "top", "record", "records", "recorde", "recordes", "maior",
  "maiores", "largest", "biggest", "primeiro", "primeira", "first", "unico", "unica", "only", "todos", "todas", "all", "sempre", "always"]);

/** Forma canónica de um número decimal em texto: "0015.50" -> "15.5". */
function canon(inteiro, decimal = "") {
  const i = inteiro.replace(/^0+(?=\d)/, "");
  const d = decimal.replace(/0+$/, "");
  return d ? `${i}.${d}` : i;
}

/** Interpretações possíveis de um número escrito (ex.: "1.500" = 1500 ou 1,5). */
export function valores(token) {
  const t = token.replace(/[  ]/g, " ");
  const out = new Set();
  if (/^\d+$/.test(t)) out.add(canon(t));
  if (/^\d{1,3}(?:[., ]\d{3})+$/.test(t)) out.add(canon(t.replace(/[., ]/g, "")));
  const m = t.match(/^(\d+(?:[., ]\d{3})*)[.,](\d+)$/);
  if (m) out.add(canon(m[1].replace(/[., ]/g, ""), m[2]));
  return out;
}

export function numeros(texto) {
  const out = new Set();
  for (const m of String(texto || "").matchAll(NUMERO)) valores(m[0]).forEach((v) => out.add(v));
  return out;
}

function percentagens(texto) {
  const out = new Set();
  for (const m of String(texto || "").matchAll(PERCENT)) valores(m[1]).forEach((v) => out.add(v));
  return out;
}

const interseta = (a, b) => [...a].some((x) => b.has(x));
const tokens = (t) => semAcentos(t || "").toLowerCase().match(/[a-z0-9&]+/g) || [];
/** Separa sufixos colados a números: "50k" -> ["50", "k"], "2M€" -> ["2", "m"]. */
const tokensComNumeros = (t) => tokens(semAcentos(t || "").replace(/(\d)([a-zA-Z]+)/g, "$1 $2"));

// ---------------------------------------------------------------- nomes próprios / siglas

const PALAVRA_MAIUSC = /[A-ZÁÀÂÃÉÊÍÓÔÕÚÇ][\wÀ-ÿ&+./-]*/g;
const INICIO_FRASE = /(^|[.!?:;([\"“«•\-–—]\s*)$/;

export function nomesProprios(texto) {
  const out = [];
  for (const m of String(texto || "").matchAll(PALAVRA_MAIUSC)) {
    if (INICIO_FRASE.test(texto.slice(0, m.index))) continue;
    const palavra = m[0].replace(/[./-]+$/, "");
    if (palavra.length < 2) continue;
    out.push(palavra);
  }
  return out;
}

// ---------------------------------------------------------------- vocabulário controlado

export function gruposVocabulario(cfg, perfil) {
  const grupos = [];
  const voc = (cfg && cfg.vocabulario) || {};
  for (const cat of ["ferramentas", "certificacoes"]) for (const t of voc[cat] || []) { const s = sinonimos(t); if (s.length) grupos.push([s[0], s]); }
  for (const c of perfil.competencias || []) grupos.push([c.nome, [c.nome]]);
  for (const c of perfil.certificacoes || []) grupos.push([c.nome, [c.nome]]);
  for (const [nome, sins] of Object.entries(LINGUAS)) grupos.push([nome, [nome, ...sins]]);
  return grupos;
}

const menciona = (texto, termo) => regexTermo(termo).test(semAcentos(texto));

// ---------------------------------------------------------------- validação de um ponto

export function validarPonto(ponto, idx, tiposPermitidos, paiObrigatorio, grupos, anosPerfil, termosPermitidos = []) {
  const motivos = [];
  const texto = String(ponto.texto || "").trim();
  const ids = (ponto.source_ids || []).map((i) => String(i).trim()).filter(Boolean);

  if (!texto) motivos.push("ponto vazio");
  if (!ids.length) motivos.push("sem source_ids: não há item do perfil-base de origem");
  const inexistentes = ids.filter((i) => !idx.has(i));
  if (inexistentes.length) motivos.push("source_ids inexistentes no perfil-base: " + inexistentes.join(", "));
  const validos = ids.filter((i) => idx.has(i)).map((i) => idx.get(i));

  if (tiposPermitidos) for (const it of validos) if (!tiposPermitidos.has(it.tipo)) motivos.push(`o item ${it.id} (${it.tipo}) não pode ser origem de um ponto nesta secção`);
  if (paiObrigatorio) for (const it of validos) if (it.id !== paiObrigatorio && it.pai !== paiObrigatorio) motivos.push(`o item ${it.id} pertence a outra secção/experiência que não ${paiObrigatorio}`);

  const contexto = validos.map((it) => it.contexto).join("\n") + "\n" + termosPermitidos.filter(Boolean).join("\n");

  // 3. números, datas e percentagens
  const numsOrigem = numeros(contexto);
  const excecaoAnos = new Set();
  const citaExperiencia = validos.some((it) => it.tipo === "experiencia" || (it.pai && idx.get(it.pai) && idx.get(it.pai).tipo === "experiencia"));
  if (citaExperiencia && !tiposPermitidos) {
    for (const m of semAcentos(texto).matchAll(/(\d+)\s*\+?\s*(?:anos|years)\b/gi)) {
      if (Number(m[1]) <= Math.floor(anosPerfil)) excecaoAnos.add(canon(m[1]));
    }
  }
  const emFalta = [];
  for (const m of texto.matchAll(NUMERO)) {
    const v = valores(m[0]);
    if (v.size && !interseta(v, numsOrigem) && !interseta(v, excecaoAnos)) emFalta.push(m[0]);
  }
  if (emFalta.length) motivos.push("números/datas sem correspondência na origem: " + [...new Set(emFalta)].join(", "));
  const pctOrigem = percentagens(contexto);
  const pctFalta = [...texto.matchAll(PERCENT)].filter((m) => !interseta(valores(m[1]), pctOrigem)).map((m) => m[0]);
  if (pctFalta.length) motivos.push("percentagens sem correspondência na origem: " + pctFalta.join(", "));

  const tkOrigemN = new Set(tokensComNumeros(contexto));
  for (const tok of tokensComNumeros(texto)) {
    if (tok in PALAVRAS_NUMERO && !tkOrigemN.has(tok) && !numsOrigem.has(String(PALAVRAS_NUMERO[tok]))) motivos.push(`número por extenso sem correspondência na origem: '${tok}'`);
    if (MULTIPLICADORES.has(tok) && !tkOrigemN.has(tok)) motivos.push(`multiplicador/quantidade ausente da origem: '${tok}'`);
  }

  // 5. termos quantitativos/de distinção
  const tkOrigem = new Set(tokens(contexto));
  for (const tok of new Set(tokens(texto))) {
    if (QUANT_PALAVRAS.has(tok) && !tkOrigem.has(tok)) motivos.push(`termo quantitativo/de distinção ausente da origem: '${tok}'`);
    for (const q of QUANT_PREFIXOS) if (tok.startsWith(q) && ![...tkOrigem].some((o) => o.startsWith(q))) motivos.push(`termo quantitativo/de distinção ausente da origem: '${tok}'`);
  }

  // 4. ferramentas, certificações, competências e línguas
  for (const [rotulo, sins] of grupos) {
    if (sins.some((s) => menciona(texto, s)) && !sins.some((s) => menciona(contexto, s))) motivos.push(`'${rotulo}' não existe nos itens de origem`);
  }

  // 6. nomes próprios e siglas
  const normCtx = normalizar(contexto);
  for (const nome of nomesProprios(texto)) {
    const n = normalizar(nome);
    if (n && !new RegExp(`(?<![a-z0-9])${n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![a-z0-9])`).test(normCtx)) motivos.push(`nome próprio/sigla ausente da origem: '${nome}'`);
  }

  const unicos = [...new Set(motivos)];
  return { texto, source_ids: ids, estado: unicos.length ? NAO_VERIFICADO : VERIFICADO, motivos: unicos };
}

// ---------------------------------------------------------------- CV e carta

/** CV: {idioma, resumo:[ponto], experiencia:[{experiencia_id, pontos:[ponto]}], formacao_ids, competencias_ids,
 *       linguas_ids, certificacoes_ids, erros, metodo}. Devolve uma cópia validada. */
export function validarCv(cv, perfil, cfg, hoje) {
  const idx = indexar(perfil);
  const grupos = gruposVocabulario(cfg, perfil);
  const anos = anosExperiencia(perfil, hoje);
  const erros = [];
  const resumo = (cv.resumo || []).map((p) => validarPonto(p, idx, null, null, grupos, anos));
  const vistos = new Set();
  const tiposExp = new Set(["experiencia", "item_experiencia"]);
  const experiencia = (cv.experiencia || []).map((b) => {
    const it = idx.get(b.experiencia_id);
    if (!it || it.tipo !== "experiencia") erros.push(`experiência inexistente no perfil-base: ${b.experiencia_id}`);
    if (vistos.has(b.experiencia_id)) erros.push(`experiência repetida: ${b.experiencia_id}`);
    vistos.add(b.experiencia_id);
    return { experiencia_id: b.experiencia_id, pontos: (b.pontos || []).map((p) => validarPonto(p, idx, tiposExp, b.experiencia_id, grupos, anos)) };
  });
  const idsTipo = (lista, tipo, nome) => {
    for (const i of lista || []) if (!idx.has(i) || idx.get(i).tipo !== tipo) erros.push(`${nome}: ID inexistente ou de outro tipo: ${i}`);
    return [...new Set(lista || [])];
  };
  return {
    idioma: cv.idioma || "pt", metodo: cv.metodo || "regras", resumo, experiencia,
    formacao_ids: idsTipo(cv.formacao_ids, "formacao", "formação"),
    competencias_ids: idsTipo(cv.competencias_ids, "competencia", "competências"),
    linguas_ids: idsTipo(cv.linguas_ids, "lingua", "línguas"),
    certificacoes_ids: idsTipo(cv.certificacoes_ids, "certificacao", "certificações"),
    erros,
  };
}

/** Carta: {idioma, paragrafos:[ponto]}. Só se acrescentam como termos permitidos o cargo e a empresa da vaga. */
export function validarCarta(carta, perfil, cfg, vaga, hoje) {
  const idx = indexar(perfil);
  const grupos = gruposVocabulario(cfg, perfil);
  const anos = anosExperiencia(perfil, hoje);
  const permitidos = [vaga.cargo || "", vaga.empresa || ""];
  return { idioma: carta.idioma || "pt", metodo: carta.metodo || "regras", erros: [],
    paragrafos: (carta.paragrafos || []).map((p) => validarPonto(p, idx, null, null, grupos, anos, permitidos)) };
}

export function pontosDe(doc) {
  return doc.paragrafos ? [...doc.paragrafos] : [...(doc.resumo || []), ...(doc.experiencia || []).flatMap((b) => b.pontos)];
}

/** Impedimentos à aprovação (vazio = pode ser aprovado). */
export function problemas(doc) {
  const out = [...(doc.erros || [])];
  for (const p of pontosDe(doc)) if (p.estado !== VERIFICADO) out.push(`ponto não verificado: «${p.texto.slice(0, 80)}» — ${p.motivos.join("; ")}`);
  if (!pontosDe(doc).length) out.push("o documento não tem pontos");
  return out;
}

export const podeAprovar = (doc) => problemas(doc).length === 0;
