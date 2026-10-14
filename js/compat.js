/* M3 — Compatibilidade: análise (modelo local ou regras), saneamento e pontuação com a grelha.

   A pontuação mede a adequação do perfil aos requisitos da vaga. NÃO é uma probabilidade
   de contratação. Dimensões sem dados na vaga ficam a null e saem da ponderação. */
import { DIMENSOES, pesosNormalizados } from "./config.js";
import * as llm from "./llm.js";
import { anosExperiencia, indexar } from "./perfil.js";
import { contemTermo, frases, normalizar, semAcentos, sinonimos } from "./texto.js";

export const AVISO = "A pontuação mede a adequação do perfil aos requisitos da vaga. Não é uma probabilidade de contratação.";

export const LINGUAS = {
  "Português": ["portugues", "portuguese", "portugais"],
  "Inglês": ["ingles", "english", "anglais"],
  "Francês": ["frances", "french", "francais"],
  "Alemão": ["alemao", "german", "deutsch", "allemand"],
  "Luxemburguês": ["luxemburgues", "luxembourgish", "luxembourgeois", "letzebuergesch"],
  "Espanhol": ["espanhol", "spanish", "espanol", "castelhano"],
  "Italiano": ["italiano", "italian"],
  "Neerlandês": ["neerlandes", "holandes", "dutch"],
};
const NIVEIS = { a1: 1, a2: 2, b1: 3, b2: 4, c1: 5, c2: 6 };
const NIVEL_PALAVRAS = [[/nativ|native|materna|mother tongue|bilingu/, 6], [/fluen|proficien|courant|excelente|excellent|avancad|advanced/, 5], [/interm/, 3], [/basic|basico|elementar/, 2]];
const OBRIGATORIO = /(obrigatori|imprescindivel|essencial|exigid|indispensavel|requisito|required|requirement|must|mandatory|essential|necessar|minimo|minimum|at least|pelo menos|fluen|exige|obligatoire)/i;
const ANOS = /(\d{1,2})\s*\+?\s*(?:(?:-|a|to)\s*\d{1,2}\s*)?(?:anos|years|ans)\b/i;
const REMOTO = /(remot|remote|teletrabalho|home ?office|full remote)/i;
const MESTRADO = /(mestrado|master|msc|m\.sc|mba)/i;
const LICENCIATURA = /(licenciatura|licenciad|bachelor|degree|graduacao|graduation|ensino superior)/i;
const NOME_NIVEL = ["-", "A1", "A2", "B1", "B2", "C1", "C2"];

function nivel(texto) {
  const t = semAcentos(texto || "").toLowerCase();
  const m = t.match(/\b([abc][12])\b/);
  if (m) return NIVEIS[m[1]];
  for (const [rx, n] of NIVEL_PALAVRAS) if (rx.test(t)) return n;
  return 0;
}

const pct = (c, t) => (t ? Math.round((100 * c) / t) : null);

function vocabulario(cfg, perfil) {
  const termos = [...(cfg.vocabulario.ferramentas || []), ...(cfg.vocabulario.certificacoes || [])].map(sinonimos);
  const conhecidos = new Set(termos.flat().map(normalizar));
  for (const c of [...perfil.competencias, ...perfil.certificacoes]) {
    if (!conhecidos.has(normalizar(c.nome)) && c.nome.length <= 40) termos.push([c.nome]);
  }
  return termos;
}

/** Análise por palavras-chave e regras (fallback sem modelo). */
export function analisarPorRegras(cfg, perfil, vaga, hoje) {
  const idx = indexar(perfil);
  const cargo = vaga.cargo || "";
  const texto = `${cargo}\n${vaga.descricao || ""}`;
  const sentencas = frases(semAcentos(texto));
  // Para a obrigatoriedade conta a frase inteira ("Requisitos obrigatórios: A; B; C.").
  const obrigSent = semAcentos(texto).split(/(?<=[.!?])\s+|\n+/).filter((s) => OBRIGATORIO.test(s));
  const obrigatorio = (termo) => obrigSent.some((s) => contemTermo(s, termo));
  const reqs = [];

  // Línguas
  const linguasPerfil = {};
  for (const l of perfil.linguas) {
    for (const [nome, sins] of Object.entries(LINGUAS)) if (sins.some((s) => contemTermo(l.nome, s))) linguasPerfil[nome] = [l.id, nivel(l.nivel)];
  }
  for (const [nome, sins] of Object.entries(LINGUAS)) {
    const sent = sentencas.filter((s) => sins.some((x) => contemTermo(s, x)));
    if (!sent.length) continue;
    const exigido = Math.max(0, ...sent.map(nivel)) || 3;
    const obrig = sent.some((s) => OBRIGATORIO.test(s));
    const [lid, niv] = linguasPerfil[nome] || [null, 0];
    const ok = lid !== null && niv >= exigido;
    reqs.push({ descricao: `${nome} (nível pedido ≈ ${NOME_NIVEL[exigido]})`, dimensao: "linguas", obrigatorio: obrig, eliminatorio: obrig,
      cumprido: ok, evidencia_ids: ok ? [lid] : [], justificacao: ok ? "no perfil" : (lid ? "nível inferior ao pedido" : "não consta do perfil") });
  }

  // Anos de experiência (um mínimo explícito é tratado como requisito)
  const anosPerfil = anosExperiencia(perfil, hoje);
  const m = semAcentos(texto).match(ANOS);
  if (m) {
    const pedidos = Number(m[1]);
    const ok = anosPerfil >= pedidos;
    reqs.push({ descricao: `${pedidos}+ anos de experiência`, dimensao: "experiencia", obrigatorio: true, eliminatorio: false, cumprido: ok,
      evidencia_ids: ok ? perfil.experiencia.map((e) => e.id) : [], justificacao: `perfil: ${anosPerfil} anos` });
  }

  // Formação
  for (const [rx, nome] of [[MESTRADO, "Mestrado"], [LICENCIATURA, "Licenciatura"]]) {
    const sent = sentencas.filter((s) => rx.test(s));
    if (!sent.length) continue;
    const ev = perfil.formacao.filter((f) => rx.test(semAcentos(f.grau)) || (nome === "Licenciatura" && MESTRADO.test(semAcentos(f.grau)))).map((f) => f.id);
    reqs.push({ descricao: nome, dimensao: "requisitos_obrigatorios", obrigatorio: sent.some((s) => OBRIGATORIO.test(s)), eliminatorio: false,
      cumprido: ev.length > 0, evidencia_ids: ev, justificacao: ev.length ? "no perfil" : "não consta do perfil" });
    break;
  }

  // Competências técnicas, ferramentas e certificações
  for (const grupo of vocabulario(cfg, perfil)) {
    const encontrado = grupo.find((t) => contemTermo(texto, t));
    if (!encontrado) continue;
    const ev = [...new Set(grupo.flatMap((t) => [...idx.values()].filter((i) => contemTermo(i.texto, t)).map((i) => i.id)))].sort();
    reqs.push({ descricao: grupo[0], dimensao: "competencias_tecnicas", obrigatorio: obrigatorio(encontrado), eliminatorio: false,
      cumprido: ev.length > 0, evidencia_ids: ev, justificacao: ev.length ? "no perfil" : "não consta do perfil" });
  }

  // Tipo de experiência: sobreposição do título da vaga com cargos/itens do perfil
  const palavras = normalizar(cargo).split(" ").filter((w) => w.length > 3);
  const textoExp = normalizar([...idx.values()].filter((i) => i.tipo === "experiencia" || i.tipo === "item_experiencia").map((i) => i.contexto).join(" "));
  const tipo = palavras.length ? Math.round((100 * palavras.filter((w) => textoExp.includes(w)).length) / palavras.length) : null;

  // Localização
  const locVaga = `${vaga.localizacao || ""} ${(vaga.descricao || "").slice(0, 400)}`;
  const alvo = (cfg.localizacoes_alvo || []).flatMap(sinonimos);
  const noAlvo = alvo.some((s) => contemTermo(locVaga, s));
  let loc;
  if (REMOTO.test(semAcentos(locVaga)) && cfg.aceita_remoto) loc = 100;
  else if (vaga.localizacao || noAlvo) loc = noAlvo ? 100 : 0;
  else loc = null;

  // Áreas-alvo
  const areas = (cfg.areas_alvo || []).flatMap(sinonimos);
  let area;
  if (areas.some((s) => contemTermo(cargo, s))) area = 100;
  else if (areas.some((s) => contemTermo(vaga.descricao || "", s))) area = 60;
  else area = areas.length ? 0 : null;

  const porDim = (dim) => { const rs = reqs.filter((r) => r.dimensao === dim); return pct(rs.filter((r) => r.cumprido).length, rs.length); };
  const obrig = reqs.filter((r) => r.obrigatorio);
  const expAnos = porDim("experiencia");
  const exp = expAnos !== null && tipo !== null ? Math.round(0.7 * expAnos + 0.3 * tipo) : (expAnos !== null ? expAnos : tipo);

  const cumpridos = reqs.filter((r) => r.cumprido), falta = reqs.filter((r) => !r.cumprido);
  let resumo = `Cumpre ${cumpridos.length} de ${reqs.length} requisitos detetados na vaga.`;
  if (falta.length) resumo += " Lacunas: " + falta.slice(0, 4).map((r) => r.descricao).join(", ") + ".";
  if (!reqs.length) resumo = "Não foram detetados requisitos concretos no texto da vaga.";
  return {
    subpontuacoes: {
      requisitos_obrigatorios: pct(obrig.filter((r) => r.cumprido).length, obrig.length),
      experiencia: exp, competencias_tecnicas: porDim("competencias_tecnicas"), linguas: porDim("linguas"),
      localizacao_condicoes: loc, alinhamento_areas: area,
    },
    requisitos: reqs, resumo,
  };
}

// ---------------------------------------------------------------- modelo local

const SISTEMA = `És um analista de recrutamento rigoroso. Avalias a adequação de um perfil a uma vaga.
Regras:
- Usa APENAS a informação do perfil fornecido. Não presumas competências que não estejam escritas.
- Para cada requisito da vaga indica se é obrigatório, se é eliminatório (ex.: língua obrigatória,
  autorização legal, certificação exigida) e se o perfil o cumpre.
- Um requisito só está cumprido se indicares em evidencia_ids os IDs exatos dos itens do perfil que o comprovam.
- As subpontuações (0-100) avaliam cada dimensão; usa null quando a vaga não dá informação sobre a dimensão.
- O resumo tem 2-3 frases factuais. Nunca fales em probabilidade de ser contratado.`;

const subSchema = { anyOf: [{ type: "integer", minimum: 0, maximum: 100 }, { type: "null" }] };
export const SCHEMA_ANALISE = {
  type: "object", required: ["subpontuacoes", "requisitos", "resumo"],
  properties: {
    subpontuacoes: { type: "object", properties: Object.fromEntries(DIMENSOES.map((d) => [d, subSchema])) },
    requisitos: { type: "array", items: { type: "object", required: ["descricao", "dimensao", "cumprido", "evidencia_ids"], properties: {
      descricao: { type: "string" }, dimensao: { type: "string", enum: DIMENSOES }, obrigatorio: { type: "boolean" },
      eliminatorio: { type: "boolean" }, cumprido: { type: "boolean" }, evidencia_ids: { type: "array", items: { type: "string" } },
      justificacao: { type: "string" } } } },
    resumo: { type: "string" },
  },
};

export function validarAnalise(o) {
  llm.exigir(o && typeof o === "object", "resposta vazia");
  const sub = {};
  for (const d of DIMENSOES) {
    const v = (o.subpontuacoes || {})[d];
    if (v === null || v === undefined) { sub[d] = null; continue; }
    llm.exigir(Number.isFinite(v) && v >= 0 && v <= 100, `subpontuação inválida em ${d}`);
    sub[d] = Math.round(v);
  }
  llm.exigir(Array.isArray(o.requisitos), "requisitos tem de ser uma lista");
  const requisitos = o.requisitos.map((r) => {
    llm.exigir(typeof r.descricao === "string" && DIMENSOES.includes(r.dimensao), "requisito inválido");
    return { descricao: r.descricao, dimensao: r.dimensao, obrigatorio: !!r.obrigatorio, eliminatorio: !!r.eliminatorio,
      cumprido: !!r.cumprido, evidencia_ids: llm.listaDeTextos(r.evidencia_ids || [], "evidencia_ids"), justificacao: String(r.justificacao || "") };
  });
  return { subpontuacoes: sub, requisitos, resumo: String(o.resumo || "") };
}

export async function analisarPorLLM(cfg, perfil, vaga, hoje) {
  const linhas = [`Anos de experiência (calculados): ${anosExperiencia(perfil, hoje)}`];
  for (const i of indexar(perfil).values()) linhas.push(`[${i.id}] (${i.tipo}) ${i.texto}`);
  const utilizador = `PERFIL (cada linha tem o ID do item):\n${linhas.join("\n")}\n\n` +
    `ÁREAS-ALVO: ${cfg.areas_alvo.join(", ")}\nLOCALIZAÇÕES-ALVO: ${cfg.localizacoes_alvo.join(", ")} (aceita remoto: ${cfg.aceita_remoto})\n\n` +
    `VAGA:\nCargo: ${vaga.cargo}\nEmpresa: ${vaga.empresa}\nLocalização: ${vaga.localizacao}\nDescrição:\n${vaga.descricao || ""}`;
  return llm.gerarJson(cfg, SISTEMA, utilizador, SCHEMA_ANALISE, validarAnalise);
}

// ---------------------------------------------------------------- saneamento e pontuação

/** Evidências com IDs inexistentes são removidas; requisito sem evidência válida não está cumprido.
 *  A subpontuação de requisitos obrigatórios é recalculada a partir dos requisitos. */
export function sanear(analise, perfil) {
  const ids = new Set(indexar(perfil).keys());
  for (const r of analise.requisitos) {
    const validos = r.evidencia_ids.filter((i) => ids.has(i));
    if (r.cumprido && !validos.length) { r.cumprido = false; r.justificacao = (r.justificacao + " [sem evidência válida no perfil]").trim(); }
    r.evidencia_ids = r.cumprido ? validos : [];
  }
  const obrig = analise.requisitos.filter((r) => r.obrigatorio);
  if (obrig.length) analise.subpontuacoes.requisitos_obrigatorios = pct(obrig.filter((r) => r.cumprido).length, obrig.length);
  return analise;
}

export function pontuar(cfg, analise, preliminar, metodo) {
  const pesos = pesosNormalizados(cfg);
  const sub = analise.subpontuacoes;
  const usados = DIMENSOES.filter((d) => sub[d] !== null && sub[d] !== undefined && pesos[d] > 0);
  let glob = 0;
  if (usados.length) {
    const total = usados.reduce((a, d) => a + pesos[d], 0);
    glob = Math.round(usados.reduce((a, d) => a + sub[d] * pesos[d], 0) / total);
  }
  const eliminatoria = analise.requisitos.some((r) => r.eliminatorio && !r.cumprido);
  if (eliminatoria) glob = Math.min(glob, Number(cfg.compatibilidade.limite_eliminatoria ?? 49));
  return {
    pontuacao_global: Math.max(0, Math.min(100, glob)), subpontuacoes: { ...sub },
    requisitos_cumpridos: analise.requisitos.filter((r) => r.cumprido), lacunas: analise.requisitos.filter((r) => !r.cumprido),
    preliminar, eliminatoria_falhada: eliminatoria, resumo: (analise.resumo || "").trim(), metodo,
  };
}

/** usarLLM: true/false, ou undefined = decidir pela configuração e disponibilidade. */
export async function analisarVaga(cfg, perfil, vaga, { usarLLM, hoje } = {}) {
  const preliminar = !vaga.descricao_completa;
  if (usarLLM === undefined) {
    usarLLM = (!preliminar || cfg.compatibilidade.preliminar_com_llm) && cfg.ollama.ativo && (await llm.estado(cfg))[0];
  }
  let analise = null, metodo = "regras";
  if (usarLLM) {
    try { analise = await analisarPorLLM(cfg, perfil, vaga, hoje); metodo = "llm"; } catch (e) { analise = null; }
  }
  if (!analise) analise = analisarPorRegras(cfg, perfil, vaga, hoje);
  return pontuar(cfg, sanear(analise, perfil), preliminar, metodo);
}
