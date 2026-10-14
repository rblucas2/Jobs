// M0/M1 — organização do Gmail e recolha, com uma Gmail API simulada (sem rede).
import assert from "node:assert/strict";
import { test } from "node:test";
import { configurar, garantirEtiquetas, recolher } from "../js/gmail.js";
import { novoResultado } from "../js/recolha.js";
import { cfg, estado, ler, parseHTML } from "./comum.js";

function gmailFalso() {
  const g = { etiquetas: { INBOX: "INBOX" }, filtros: [], mensagens: {}, n: 0 };
  g.adicionar = (id, de, html, labels = ["INBOX"]) => {
    g.mensagens[id] = { from: de, labelIds: [...labels], payload: { mimeType: "text/html", body: { data: Buffer.from(html).toString("base64url") },
      headers: [{ name: "From", value: de }, { name: "Subject", value: "Alerta" }, { name: "Date", value: "Tue, 13 Oct 2026 08:00:00 +0000" }] } };
  };
  g.api = async (metodo, caminho, corpo) => {
    const [p, qs] = caminho.split("?");
    const q = new URLSearchParams(qs || "");
    if (p === "/labels" && metodo === "GET") return { labels: Object.entries(g.etiquetas).map(([name, id]) => ({ name, id })) };
    if (p === "/labels" && metodo === "POST") { const id = "L" + Object.keys(g.etiquetas).length; g.etiquetas[corpo.name] = id; return { id }; }
    if (p === "/settings/filters" && metodo === "GET") return { filter: [...g.filtros] };
    if (p === "/settings/filters" && metodo === "POST") { const f = { id: "f" + ++g.n, ...corpo }; g.filtros.push(f); return f; }
    if (p.startsWith("/settings/filters/") && metodo === "DELETE") { g.filtros = g.filtros.filter((f) => f.id !== p.split("/").pop()); return null; }
    if (p === "/messages" && metodo === "GET") {
      const label = q.get("labelIds"), filtro = q.get("q") || "";
      const ids = Object.keys(g.mensagens).filter((id) => (!label || g.mensagens[id].labelIds.includes(label)) && (!filtro.includes("from:") || filtro.includes(g.mensagens[id].from)));
      return { messages: ids.map((id) => ({ id })) };
    }
    if (p === "/messages/batchModify") {
      for (const id of corpo.ids) {
        const m = g.mensagens[id];
        m.labelIds = m.labelIds.filter((l) => !(corpo.removeLabelIds || []).includes(l));
        (corpo.addLabelIds || []).forEach((l) => { if (!m.labelIds.includes(l)) m.labelIds.push(l); });
      }
      return null;
    }
    const mm = p.match(/^\/messages\/([^/]+)(\/modify)?$/);
    if (mm && mm[2]) return g.api("POST", "/messages/batchModify", { ids: [mm[1]], ...corpo });
    if (mm) return { id: mm[1], labelIds: [...g.mensagens[mm[1]].labelIds], payload: g.mensagens[mm[1]].payload };
    throw new Error("rota não simulada: " + metodo + " " + caminho);
  };
  return g;
}

test("configurar é idempotente", async () => {
  const c = cfg(); c.gmail.remetentes.LinkedIn = ["jobalerts-noreply@linkedin.com"];
  const g = gmailFalso();
  const r1 = await configurar(g.api, c);
  assert.ok(r1.etiquetas_criadas.includes("Vagas") && r1.etiquetas_criadas.includes("Vagas/Processado"));
  assert.deepEqual(r1.filtros_criados, ["LinkedIn"]); assert.ok(r1.fontes_sem_remetentes.includes("Indeed"));
  const n = [Object.keys(g.etiquetas).length, g.filtros.length];
  const r2 = await configurar(g.api, c);
  assert.deepEqual(r2.etiquetas_criadas, []); assert.deepEqual(r2.filtros_criados, []); assert.deepEqual(r2.filtros_existentes, ["LinkedIn"]);
  assert.deepEqual([Object.keys(g.etiquetas).length, g.filtros.length], n);
  assert.equal(g.filtros[0].criteria.from, "jobalerts-noreply@linkedin.com");
  assert.deepEqual(g.filtros[0].action, { addLabelIds: [g.etiquetas["Vagas/LinkedIn"]], removeLabelIds: ["INBOX"] });
});

test("remetentes alterados substituem o filtro", async () => {
  const c = cfg(), g = gmailFalso();
  c.gmail.remetentes.Indeed = ["a@indeed.com"];
  await configurar(g.api, c);
  c.gmail.remetentes.Indeed = ["a@indeed.com", "b@indeed.com"];
  const r = await configurar(g.api, c);
  assert.deepEqual(r.filtros_substituidos, ["Indeed"]);
  assert.equal(g.filtros.length, 1); assert.equal(g.filtros[0].criteria.from, "a@indeed.com OR b@indeed.com");
});

test("arquivar antigos retira da caixa de entrada", async () => {
  const c = cfg(), g = gmailFalso();
  c.gmail.remetentes.LinkedIn = ["jobalerts-noreply@linkedin.com"];
  g.adicionar("m1", "jobalerts-noreply@linkedin.com", "<html></html>");
  g.adicionar("m2", "amigo@exemplo.com", "<html></html>");
  await configurar(g.api, c);
  assert.deepEqual(g.mensagens.m1.labelIds, [g.etiquetas["Vagas/LinkedIn"]]);
  assert.deepEqual(g.mensagens.m2.labelIds, ["INBOX"]);
});

test("recolher lê, marca processado e regista falhas", async () => {
  const c = cfg(), g = gmailFalso(), e = estado();
  const ids = await garantirEtiquetas(g.api, c);
  g.adicionar("m1", "x@linkedin.com", ler("emails/linkedin.html"), [ids.LinkedIn]);
  g.adicionar("m2", "x@linkedin.com", ler("emails/desconhecido.html"), [ids.LinkedIn]);
  const r = await recolher(g.api, e, c, novoResultado(), parseHTML);
  assert.equal(r.emails_lidos, 2); assert.equal(r.vagas_novas.length, 2); assert.equal(r.nao_reconhecidos, 1);
  assert.ok(g.mensagens.m1.labelIds.includes(ids._processado));
  // O não reconhecido NÃO é marcado: volta a ser lido quando o parser for corrigido.
  assert.ok(!g.mensagens.m2.labelIds.includes(ids._processado));
  assert.equal(e.naoReconhecidos[0].id, "m2");
  const r2 = await recolher(g.api, e, c, novoResultado(), parseHTML);
  assert.equal(r2.vagas_novas.length, 0); assert.equal(r2.emails_lidos, 1);
});
