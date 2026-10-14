import { readFileSync } from "node:fs";
import { DOMParser } from "linkedom";
import { configCompleta } from "../js/config.js";
import { garantirEstrutura } from "../js/dados.js";
import { guardarNovaVersao, normalizarPerfil, validarVersao } from "../js/perfil.js";

export const HOJE = "2026-10-14";
const dir = new URL("./fixtures/", import.meta.url);

export const ler = (nome) => readFileSync(new URL(nome, dir), "utf-8");
export const parseHTML = (html) => new DOMParser().parseFromString(html, "text/html");

export function perfil() {
  const d = JSON.parse(ler("perfil_exemplo.json"));
  delete d._nota;
  return { ...normalizarPerfil(d), versao: 1 };
}

export const cfg = () => configCompleta({});
export const estado = () => garantirEstrutura({});

/** Estado + config com o perfil de exemplo gravado e validado (versão 1). */
export function comPerfil() {
  const e = estado(), c = cfg();
  const n = guardarNovaVersao(e, perfil(), "teste");
  validarVersao(e, c, n);
  return [e, c];
}
