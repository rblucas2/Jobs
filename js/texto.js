/* Utilitários de normalização de texto partilhados pelos módulos. */

export function semAcentos(s) {
  return String(s || "").normalize("NFKD").replace(/[̀-ͯ]/g, "");
}

/** Minúsculas, sem acentos, só alfanuméricos (e & + #) e espaços simples. */
export function normalizar(s) {
  return semAcentos(s).toLowerCase().replace(/[^a-z0-9&+#]+/g, " ").replace(/\s+/g, " ").trim();
}

export function slug(s, sep = "_") {
  const out = semAcentos(s).toLowerCase().replace(/[^a-z0-9]+/g, sep);
  const re = new RegExp(`^${sep}+|${sep}+$`, "g");
  return out.replace(re, "") || "item";
}

/** "Lisboa|Lisbon" -> ["Lisboa", "Lisbon"] */
export function sinonimos(entrada) {
  return String(entrada || "").split("|").map((p) => p.trim()).filter(Boolean);
}

const escapar = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Expressão regular que encontra o termo como palavra inteira (texto sem acentos).
 *  Termos curtos (até 3 caracteres, ex.: "R", "SAP", "CIA") distinguem maiúsculas,
 *  para evitar falsos positivos com palavras comuns. */
export function regexTermo(termo, sensivel) {
  const t = semAcentos(termo).trim();
  if (sensivel === undefined) sensivel = t.length <= 3;
  const corpo = t.split(/\s+/).map(escapar).join("\\s+");
  return new RegExp("(?<![\\w&])" + corpo + "(?![\\w&])", sensivel ? "" : "i");
}

export function contemTermo(texto, termo) {
  if (!termo || !String(termo).trim()) return false;
  return regexTermo(termo).test(semAcentos(texto || ""));
}

export function frases(texto) {
  return String(texto || "").split(/(?<=[.!?;])\s+|\n+|•/).map((p) => p.trim()).filter(Boolean);
}

export function hojeISO(d = new Date()) {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function somarDias(iso, dias) {
  const d = new Date(iso + "T00:00:00");
  d.setDate(d.getDate() + dias);
  return hojeISO(d);
}

export function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}
