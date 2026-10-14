/* Ecrã Tracker: candidaturas por estado, follow-ups em atraso, métricas e exportação CSV. */
import * as dados from "../dados.js";
import * as tracker from "../tracker.js";
import { botao, card, cfg, download, el, estado, guardarUi, irPara, mut, render, toast, ui } from "./comum.js";

function folhaAtualizar(v) {
  const e = estado();
  const corrigir = el("input", { type: "checkbox" });
  const opcoes = () => (corrigir.checked ? tracker.ESTADOS.filter((s) => s !== v.estado) : tracker.transicoesPossiveis(v.estado));
  const novo = UI.field("Novo estado", { type: "select", options: [{ value: "", label: "(manter: " + v.estado + ")" }, ...opcoes().map((s) => ({ value: s, label: s }))] });
  corrigir.addEventListener("change", () => {
    novo.input.innerHTML = "";
    [{ value: "", label: "(manter: " + v.estado + ")" }, ...opcoes().map((s) => ({ value: s, label: s }))].forEach((o) => novo.input.appendChild(el("option", { value: o.value, text: o.label })));
  });
  const data = UI.field("Data", { type: "date", value: UI.todayISO() });
  const aprovados = dados.listarCvs(e, { vagaId: v.id, estado: "aprovado", tipo: "cv" });
  const cvSel = UI.field("CV usado (só CVs aprovados)", { type: "select", value: v.cv_id || "", options: [{ value: "", label: aprovados.length ? "—" : "— (nenhum CV aprovado para esta vaga)" }, ...aprovados.map((d) => ({ value: d.id, label: `CV aprovado em ${String(d.data_aprovacao).slice(0, 10)}` }))] });
  const contacto = UI.field("Contacto", { value: v.contacto || "" });
  const notas = UI.field("Notas", { type: "textarea", value: v.notas || "", rows: 3 });
  const fu = UI.field("Data de follow-up", { type: "date", value: v.data_followup || "" });
  const s = UI.sheet(v.cargo, [
    el("p", { class: "tiny muted", text: `${v.empresa || "?"} · estado atual: ${v.estado}` }),
    novo, el("label", { class: "row tiny", style: "gap:8px" }, [corrigir, el("span", { text: "Corrigir um engano (permite qualquer estado)" })]),
    data, cvSel, contacto, notas, fu,
    el("p", { class: "tiny muted", text: `Ao marcar “Candidatado”, o follow-up fica a ${cfg().tracker.dias_followup} dias.` }),
    botao("Guardar", () => {
      mut((st, c) => {
        const cvId = cvSel.input.value || null;
        if (novo.input.value) tracker.mudarEstado(st, c, v.id, novo.input.value, { data: data.input.value || undefined, cvId, forcar: corrigir.checked });
        else if (cvId && cvId !== v.cv_id) tracker.definirCv(st, v.id, cvId);
        const campos = { contacto: contacto.input.value, notas: notas.input.value };
        if (!novo.input.value) campos.data_followup = fu.input.value || null; // a mudança de estado recalcula o follow-up
        dados.atualizarCandidatura(st, v.id, campos);
      });
      s.close(); toast("Atualizado ✓");
    }, "btn btn-primary btn-block"),
    botao("Ver a vaga", () => { s.close(); irPara("vaga", { vagaId: v.id }); }, "btn btn-ghost btn-block"),
  ]);
}

const kpi = (k, v, ajuda) => el("div", { class: "kpi", title: ajuda || "" }, [el("span", { class: "v", text: v }), el("span", { class: "k", text: k })]);

function contagens(titulo, obj) {
  const ent = Object.entries(obj).sort((a, b) => b[1] - a[1]);
  return card(titulo, [ent.length ? el("div", { class: "list" }, ent.map(([k, n]) => el("div", { class: "item" }, [el("div", { class: "grow t", text: k }), el("strong", { text: n })])))
    : el("div", { class: "empty tiny", text: "Ainda sem entrevistas." })]);
}

export function vistaTracker() {
  const e = estado(), c = cfg();
  const m = tracker.metricas(e, c);
  const atraso = tracker.followupsEmAtraso(e);
  const vagas = dados.listarVagas(e).filter((v) => !ui.trackerEstados.length || ui.trackerEstados.includes(v.estado))
    .sort((a, b) => String(b.data_candidatura || b.data_recolha).localeCompare(String(a.data_candidatura || a.data_recolha)));

  return el("div", { class: "stack" }, [
    card(null, [el("div", { class: "grid-3", style: "gap:12px" }, [
      kpi("Candidaturas", m.candidaturas), kpi("A aguardar", m.aguardam_resposta),
      kpi("Taxa de resposta", m.taxa_resposta == null ? "—" : Math.round(m.taxa_resposta * 100) + "%", "Candidaturas com resposta (entrevista, rejeição ou oferta) / candidaturas enviadas"),
      kpi("Entrevistas", m.entrevistas), kpi("Ofertas", m.por_estado.Oferta), kpi("Follow-ups em atraso", m.followups_em_atraso),
    ])]),
    atraso.length ? card("Follow-ups em atraso", atraso.map((v) => el("div", { class: "item", style: "cursor:pointer", onclick: () => folhaAtualizar(v) }, [
      el("div", { class: "grow" }, [el("div", { class: "t", text: v.cargo }), el("div", { class: "s", text: `${v.empresa} · desde ${v.data_followup}` })])]))) : null,
    card("Por estado", [UI.sparkBars(tracker.ESTADOS.map((s) => m.por_estado[s]), { labels: tracker.ESTADOS.map((s) => s.split(" ")[0]) }),
      el("div", { class: "tiny muted", style: "margin-top:4px", text: tracker.ESTADOS.map((s) => `${s}: ${m.por_estado[s]}`).join(" · ") })]),
    el("div", { class: "grid-2", style: "gap:var(--gap)" }, [contagens("Entrevistas por fonte", m.entrevistas_por_fonte), contagens("Entrevistas por tipo de vaga", m.entrevistas_por_tipo)]),
    card("Candidaturas", [
      el("div", { class: "chips", style: "margin:8px 0" }, tracker.ESTADOS.map((s) => {
        const on = ui.trackerEstados.includes(s);
        return el("span", { class: "pill" + (on ? " on" : ""), text: s, onclick: () => { ui.trackerEstados = on ? ui.trackerEstados.filter((x) => x !== s) : [...ui.trackerEstados, s]; guardarUi(); render(); } });
      })),
      vagas.length ? el("div", { class: "list" }, vagas.map((v) => el("div", { class: "item", style: "cursor:pointer", onclick: () => folhaAtualizar(v) }, [
        el("div", { class: "grow" }, [
          el("div", { class: "t", text: v.cargo }),
          el("div", { class: "s", text: [v.empresa, v.fonte, v.data_candidatura ? "candidatura " + v.data_candidatura : null, v.data_followup ? "follow-up " + v.data_followup : null].filter(Boolean).join(" · ") }),
        ]),
        el("span", { class: "tag", text: v.estado }),
      ]))) : el("div", { class: "empty tiny", text: "Nenhuma candidatura nestes estados." }),
    ]),
    botao("Exportar CSV (Power BI)", () => {
      download(new Blob([tracker.exportarCsv(e, c)], { type: "text/csv;charset=utf-8" }), `candidaturas_${UI.todayISO()}.csv`);
    }, "btn btn-block"),
    el("p", { class: "tiny muted center", text: `UTF-8 com BOM · separador “${c.exportacao.separador_csv}”` }),
  ].filter(Boolean));
}
