/* M1 — Parsers de alertas de emprego e deduplicação.

   Cada fonte define os padrões dos seus links de vagas. Para cada link, o cargo é o texto
   do link e a empresa/localização vêm das linhas do bloco HTML que o contém.

   NOTA: o HTML dos alertas muda com frequência e estes parsers só foram testados com
   e-mails sintéticos. Um e-mail sem vagas reconhecidas nunca falha em silêncio: fica
   registado na lista "E-mails não reconhecidos", para revisão.

   `parseHTML(html)` devolve um Document: no browser usa-se DOMParser; nos testes, linkedom. */
import { normalizar } from "./texto.js";

// ---------------------------------------------------------------- normalização

const PARAMS_RASTREIO = /^(utm_.*|trk.*|tracking.*|refid|ref|lipi|midtoken|midsig|eid|otptoken|ssid|from|alid|tk|advn|adid|sjdu|acatk|pub|xpse|xfps|xkcb|camk|vjtk|cmp|mc_.*|gclid|fbclid|source|src|origin|campaign|position|pagenum|cid|sid|_hs.*|hs.*|ga|_ga|sc_cid|iis|iisn)$/i;

export function linkCanonico(url) {
  if (!url || !/^https?:\/\//i.test(url.trim())) return null;
  let u;
  try { u = new URL(url.trim()); } catch (e) { return null; }
  const host = u.hostname.toLowerCase();
  const caminho = u.pathname.replace(/\/+$/, "") || "/";

  const li = u.pathname.match(/\/jobs\/view\/(?:[^/]*?-)?(\d{6,})/);
  if (host.includes("linkedin.") && li) return `https://www.linkedin.com/jobs/view/${li[1]}/`;

  if (host.includes("indeed.")) {
    const jk = u.searchParams.get("jk") || u.searchParams.get("vjk");
    if (jk) {
      const dominio = /(indeed\.com|indeed\.pt|indeed\.lu)$/.test(host) && !host.startsWith("cts.") ? host : "www.indeed.com";
      return `https://${dominio}/viewjob?jk=${jk}`;
    }
  }
  if (host.includes("net-empregos.")) return `https://www.net-empregos.com${caminho}/`;

  const limpos = [...u.searchParams.entries()].filter(([k, v]) => v !== "" && !PARAMS_RASTREIO.test(k)).sort((a, b) => (a[0] + a[1]).localeCompare(b[0] + b[1]));
  const q = limpos.length ? "?" + new URLSearchParams(limpos).toString() : "";
  return `https://${host}${caminho}${q}`;
}

export function chaveNormalizada(empresa, cargo, localizacao) {
  // Só a cidade conta: "Lisboa, Portugal (Híbrido)" e "Lisboa" são a mesma localização.
  const cidade = String(localizacao || "").split(/[,(·|/–-]/)[0];
  const loc = normalizar(cidade).replace(/\b(hibrido|hybrid|remoto|remote|presencial|on site|area metropolitana de|distrito de)\b/g, "").replace(/\s+/g, " ").trim();
  return [normalizar(empresa), normalizar(cargo), loc].join("|");
}

// ---------------------------------------------------------------- fontes

const TEXTOS_GENERICOS = /^(ver( a)? vaga|ver todas?.*|ver mais.*|see (all|more).*|view (job|all.*)|apply( now)?|candidat(ar|e-se|ura).*|easy apply|candidatura simplificada|promovida|promoted|novo|nova|new|guardar|save|partilhar|share|mais vagas.*|search.*|pesquisar.*|há \d+.*|\d+ (dias?|horas?|days?|hours?) ago|publicad[ao].*|posted.*|actively recruiting|recrutamento ativo|be an early applicant|seja um dos primeiros.*|\d+ (candidatos|applicants).*|responds? .*|sponsored|patrocinad[ao]|urgente|urgent|top applicant|melhor candidato.*)$/i;
const LOCAL = /(remot|híbrid|hibrid|hybrid|presencial|on-?site|portugal|luxemb|lisbo|porto|braga|coimbra|faro|aveiro|setúbal|setubal|leiria|viseu|madeira|açores|, )/i;

export const PADROES = {
  LinkedIn: [/linkedin\.com\/(comm\/)?jobs\/view\//i],
  Indeed: [/indeed\.[a-z.]+\/(rc\/clk|viewjob|pagead\/clk|m\/viewjob|rc\/clk\/dl)\b.*\bjk=/i, /indeed\.[a-z.]+\/(viewjob|m\/viewjob)\?/i],
  "Net-Empregos": [/net-empregos\.com\/\d+\//i],
  "Jobs.lu": [/jobs\.lu\/[^\s"'<>]*\d{4,}/i],
  Big4: [
    /(deloitte|pwc|kpmg)[a-z.-]*\.[a-z.]+\/.*(job|vaga|career|carreira|requisition|position)/i,
    /(^|[/.])ey\.com\/.*(job|career)/i,
    /myworkdayjobs\.com\/.+\/job\//i,
    /successfactors\.[a-z.]+\/.*(career|job)/i,
    /(taleo\.net|avature\.net|phenompeople\.com)\/.*(job|requisition)/i,
  ],
  Outras: [], // só reconhece padrões definidos pelo utilizador
};

const EMPRESAS_BIG4 = [["deloitte", "Deloitte"], ["pwc", "PwC"], ["kpmg", "KPMG"], ["ey.com", "EY"], ["ey", "EY"]];

const DOMINIOS = [
  [/(^|[/.])linkedin\./, "LinkedIn"], [/(^|[/.])indeed\./, "Indeed"], [/(^|[/.])net-empregos\./, "Net-Empregos"],
  [/(^|[/.])jobs\.lu\b/, "Jobs.lu"], [/(^|[/.])(deloitte|pwc|kpmg)[a-z-]*\./, "Big4"], [/(^|[/.])ey\.com\b/, "Big4"],
];

export function fontePorLink(url) {
  const u = String(url || "").toLowerCase();
  for (const [rx, f] of DOMINIOS) if (rx.test(u)) return f;
  return u ? "Outras" : "Manual";
}

function padroesDe(fonte, cfg) {
  const extra = ((cfg && cfg.parsers && cfg.parsers.padroes_link_extra) || {})[fonte] || [];
  const user = extra.map((p) => { try { return new RegExp(p, "i"); } catch (e) { return null; } }).filter(Boolean);
  return [...(PADROES[fonte] || []), ...user];
}

const limpar = (t) => String(t || "").replace(/\s+/g, " ").trim().replace(/^[ \t·•|\-–]+|[ \t·•|\-–]+$/g, "");
const escHtml = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Converte um e-mail só de texto em HTML simples: um bloco por parágrafo, URLs como links. */
export function textoParaHtml(texto) {
  const blocos = [];
  for (const bloco of String(texto || "").split(/\n\s*\n/)) {
    const linhas = bloco.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const urls = linhas.filter((l) => /^https?:\/\/\S+$/.test(l));
    const resto = linhas.filter((l) => !urls.includes(l));
    if (urls.length && resto.length) {
      blocos.push(`<div><a href="${escHtml(urls[0])}">${escHtml(resto[0])}</a>` + resto.slice(1).map((l) => `<p>${escHtml(l)}</p>`).join("") + "</div>");
    }
  }
  return `<html><body>${blocos.join("")}</body></html>`;
}

function textos(no) {
  const out = [];
  // Junta nós de texto contíguos (alguns leitores de HTML partem o texto em entidades como &amp;).
  const visitar = (n) => {
    let buf = "";
    const despejar = () => { const t = limpar(buf); if (t) out.push(t); buf = ""; };
    for (const c of n.childNodes) {
      if (c.nodeType === 3) buf += c.textContent;
      else if (c.nodeType === 1) { despejar(); visitar(c); }
    }
    despejar();
  };
  visitar(no);
  return out;
}

function empresaLocal(linhas, porDefeito) {
  for (const l of linhas.slice(0, 3)) {
    const partes = l.split(/\s+[·•|–-]\s+/).map((p) => p.trim()).filter(Boolean);
    if (partes.length >= 2 && LOCAL.test(partes[partes.length - 1])) return [partes[0], partes[partes.length - 1]];
  }
  let empresa = "", local = "";
  for (const l of linhas.slice(0, 4)) {
    if (!local && LOCAL.test(l) && l !== empresa) local = l;
    else if (!empresa && !LOCAL.test(l)) empresa = l;
  }
  return [empresa || porDefeito || "", local];
}

/** Extrai as vagas de um alerta. Devolve [{cargo, link, empresa, localizacao, resumo, avisos}]. */
export function extrair(fonte, html, texto, cfg, parseHTML) {
  const padroes = padroesDe(fonte, cfg);
  if (!padroes.length) return [];
  if (!html && texto) html = textoParaHtml(texto);
  if (!html) return [];
  const doc = parseHTML(html);
  doc.querySelectorAll("style, script, head").forEach((n) => n.remove());
  const reconhece = (href) => padroes.some((p) => p.test(href));
  const idLink = (href) => linkCanonico(href) || href;

  const grupos = new Map();
  for (const a of doc.querySelectorAll("a[href]")) {
    const href = a.getAttribute("href").trim();
    if (!reconhece(href)) continue;
    const k = idLink(href);
    if (!grupos.has(k)) grupos.set(k, []);
    grupos.get(k).push(a);
  }

  const vagas = [];
  for (const [chave, ancoras] of grupos) {
    const titulos = ancoras.map((a) => limpar(a.textContent)).filter((t) => t && !TEXTOS_GENERICOS.test(t) && t.length <= 150);
    let titulo = titulos.sort((a, b) => b.length - a.length)[0] || "";

    // Sobe na árvore até ao maior bloco que só contém links desta vaga.
    let bloco = ancoras[0];
    while (bloco.parentElement && !["BODY", "HTML"].includes(bloco.parentElement.tagName.toUpperCase())) {
      const pai = bloco.parentElement;
      const outras = [...pai.querySelectorAll("a[href]")].map((a) => a.getAttribute("href")).filter(reconhece).map(idLink).filter((k) => k !== chave);
      if (outras.length) break;
      bloco = pai;
    }
    const linhas = textos(bloco).filter((l) => !TEXTOS_GENERICOS.test(l));
    if (!titulo && linhas.length) titulo = linhas[0];
    if (!titulo) continue;
    const resto = linhas.filter((l) => l !== titulo);
    let porDefeito = "";
    if (fonte === "Big4") {
      const href = ancoras[0].getAttribute("href").toLowerCase();
      const e = EMPRESAS_BIG4.find(([k]) => new RegExp(`(^|[/.\\-])${k.replace(".", "\\.")}`).test(href));
      porDefeito = e ? e[1] : "";
    }
    const [empresa, localizacao] = empresaLocal(resto, porDefeito);
    vagas.push({
      cargo: titulo, link: ancoras[0].getAttribute("href").trim(), empresa, localizacao,
      resumo: linhas.slice(0, 6).join(" · "), avisos: empresa ? [] : ["empresa não identificada"],
    });
  }
  return vagas;
}
