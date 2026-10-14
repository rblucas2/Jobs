// M3 — grelha, regra de corte, pontuação preliminar e saneamento da saída do modelo.
import assert from "node:assert/strict";
import { test } from "node:test";
import * as compat from "../js/compat.js";
import { cfg, HOJE, perfil } from "./comum.js";

const DESC = `Analista de Valuation (m/f) — Lisboa.
Requisitos obrigatórios: Mestrado em Finanças; mínimo de 2 anos de experiência; Excel avançado.
Inglês fluente obrigatório. Valorizamos conhecimentos de Power BI e Bloomberg.`;
const vaga = (x = {}) => ({ cargo: "Analista de Valuation", empresa: "Consultora Alfa", localizacao: "Lisboa", descricao: DESC, descricao_completa: true, ...x });
const sub = (o) => ({ requisitos_obrigatorios: null, experiencia: null, competencias_tecnicas: null, linguas: null, localizacao_condicoes: null, alinhamento_areas: null, ...o });

test("pontuação global usa os pesos", () => {
  const r = compat.pontuar(cfg(), { subpontuacoes: sub({ requisitos_obrigatorios: 100, experiencia: 50, competencias_tecnicas: 50, linguas: 100, localizacao_condicoes: 100, alinhamento_areas: 0 }), requisitos: [], resumo: "" }, false, "x");
  assert.equal(r.pontuacao_global, 75);
});
test("dimensões sem dados saem da ponderação", () => {
  const r = compat.pontuar(cfg(), { subpontuacoes: sub({ localizacao_condicoes: 100, alinhamento_areas: 0 }), requisitos: [], resumo: "" }, true, "x");
  assert.equal(r.pontuacao_global, Math.round((100 * 10) / 15));
});
test("regra de corte limita a 49", () => {
  const r = compat.pontuar(cfg(), { subpontuacoes: sub({ requisitos_obrigatorios: 100, experiencia: 100, competencias_tecnicas: 100, linguas: 0, localizacao_condicoes: 100, alinhamento_areas: 100 }),
    requisitos: [{ descricao: "Alemão", dimensao: "linguas", obrigatorio: true, eliminatorio: true, cumprido: false, evidencia_ids: [] }], resumo: "" }, false, "x");
  assert.equal(r.pontuacao_global, 49); assert.ok(r.eliminatoria_falhada);
});
test("saneamento remove evidências inexistentes", () => {
  const a = compat.sanear({ subpontuacoes: sub({ requisitos_obrigatorios: 100 }), resumo: "", requisitos: [
    { descricao: "SAP", dimensao: "competencias_tecnicas", obrigatorio: true, cumprido: true, evidencia_ids: ["comp_sap_inventado"], justificacao: "" },
    { descricao: "Excel", dimensao: "competencias_tecnicas", obrigatorio: true, cumprido: true, evidencia_ids: ["comp_excel"], justificacao: "" },
  ] }, perfil());
  assert.deepEqual(a.requisitos.map((r) => r.cumprido), [false, true]);
  assert.equal(a.subpontuacoes.requisitos_obrigatorios, 50);
});
test("regras detetam requisitos e evidências", () => {
  const a = compat.analisarPorRegras(cfg(), perfil(), vaga(), HOJE);
  const por = Object.fromEntries(a.requisitos.map((r) => [r.descricao.split(" (")[0], r]));
  assert.ok(por["Inglês"].cumprido && por["Inglês"].eliminatorio); assert.deepEqual(por["Inglês"].evidencia_ids, ["ling_ingles"]);
  assert.ok(por.Excel.cumprido && por.Excel.obrigatorio);
  assert.equal(por.Bloomberg.cumprido, false);
  assert.ok(por.Mestrado.cumprido); assert.deepEqual(por.Mestrado.evidencia_ids, ["form_nova_sbe"]);
  assert.ok(por["2+ anos de experiência"].cumprido);
  assert.equal(a.subpontuacoes.localizacao_condicoes, 100); assert.equal(a.subpontuacoes.alinhamento_areas, 100);
});
test("língua obrigatória em falta aplica o corte", async () => {
  const r = await compat.analisarVaga(cfg(), perfil(), vaga({ descricao: DESC + "\nAlemão fluente obrigatório." }), { usarLLM: false, hoje: HOJE });
  assert.ok(r.eliminatoria_falhada && r.pontuacao_global <= 49);
  assert.ok(r.lacunas.some((l) => l.descricao.includes("Alemão")));
});
test("vaga só com o resumo do alerta é preliminar", async () => {
  const r = await compat.analisarVaga(cfg(), perfil(), vaga({ descricao: "Consultora Alfa · Lisboa", descricao_completa: false }), { usarLLM: false, hoje: HOJE });
  assert.ok(r.preliminar); assert.equal(r.metodo, "regras");
});
test("localização fora do alvo", () => {
  assert.equal(compat.analisarPorRegras(cfg(), perfil(), vaga({ localizacao: "Faro", descricao: "Analista de Valuation em Faro." }), HOJE).subpontuacoes.localizacao_condicoes, 0);
});
test("resposta do modelo é validada", () => {
  assert.throws(() => compat.validarAnalise({ subpontuacoes: { linguas: 150 }, requisitos: [], resumo: "" }), /inválida/);
  assert.throws(() => compat.validarAnalise({ subpontuacoes: {}, requisitos: [{ descricao: "x", dimensao: "inventada" }] }), /inválido/);
  const ok = compat.validarAnalise({ subpontuacoes: { linguas: 80 }, requisitos: [{ descricao: "Inglês", dimensao: "linguas", cumprido: true, evidencia_ids: ["ling_ingles"] }], resumo: "ok" });
  assert.equal(ok.subpontuacoes.linguas, 80); assert.equal(ok.subpontuacoes.experiencia, null);
});
