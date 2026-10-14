"""Página Tracker: candidaturas por estado, follow-ups em atraso, métricas e exportação CSV."""
from __future__ import annotations

from datetime import date, datetime

import pandas as pd
import streamlit as st

from src import db, ui
from src.config import resolver
from src.tracker import estados, metricas

cfg = ui.cfg()
conn = ui.conn(cfg)
st.title("Tracker de candidaturas")

m = metricas.metricas(conn, cfg)
c1, c2, c3, c4, c5 = st.columns(5)
c1.metric("Candidaturas", m["candidaturas"])
c2.metric("A aguardar resposta", m["aguardam_resposta"])
c3.metric("Taxa de resposta", "—" if m["taxa_resposta"] is None else f"{m['taxa_resposta']:.0%}",
          help="Candidaturas com resposta (entrevista, rejeição ou oferta) / candidaturas enviadas")
c4.metric("Entrevistas", m["entrevistas"])
c5.metric("Follow-ups em atraso", m["followups_em_atraso"])

atraso = estados.followups_em_atraso(conn)
if atraso:
    st.warning("**Follow-ups em atraso:** " + "; ".join(
        f"{c['cargo']} — {c['empresa']} (desde {c['data_followup']})" for c in atraso))

g1, g2, g3 = st.columns(3)
g1.markdown("**Por estado**")
g1.bar_chart(pd.Series(m["por_estado"], name="vagas"))
g2.markdown("**Entrevistas por fonte**")
if m["entrevistas_por_fonte"]:
    g2.bar_chart(pd.Series(m["entrevistas_por_fonte"], name="entrevistas"))
else:
    g2.caption("Ainda sem entrevistas.")
g3.markdown("**Entrevistas por tipo de vaga**")
if m["entrevistas_por_tipo"]:
    g3.bar_chart(pd.Series(m["entrevistas_por_tipo"], name="entrevistas"))
else:
    g3.caption("Ainda sem entrevistas.")

cands = db.listar_candidaturas(conn)
filtro = st.multiselect("Estados", estados.ESTADOS, default=[estados.CANDIDATADO, estados.ENTREVISTA, estados.OFERTA])
lista = [c for c in cands if not filtro or c["estado"] in filtro]
st.dataframe(pd.DataFrame([{
    "#": c["vaga_id"], "Cargo": c["cargo"], "Empresa": c["empresa"], "Fonte": c["fonte"], "Estado": c["estado"],
    "Pontuação": c["pontuacao_global"], "CV": c["cv_id"], "Candidatura": c["data_candidatura"],
    "Follow-up": c["data_followup"], "Contacto": c["contacto"], "Notas": c["notas"],
} for c in lista]), hide_index=True, use_container_width=True)

st.subheader("Atualizar uma candidatura")
if not cands:
    st.stop()
por_id = {c["vaga_id"]: c for c in cands}
ids = list(por_id)
atual = st.session_state.get("vaga_id")
vid = st.selectbox("Vaga", ids, index=ids.index(atual) if atual in ids else 0,
                   format_func=lambda i: f"#{i} · {por_id[i]['cargo']} — {por_id[i]['empresa']} [{por_id[i]['estado']}]")
st.session_state["vaga_id"] = vid
c = por_id[vid]

with st.form("estado"):
    possiveis = estados.transicoes_possiveis(c["estado"])
    corrigir = st.checkbox("Corrigir um engano (permite qualquer estado)")
    opcoes = [e for e in estados.ESTADOS if e != c["estado"]] if corrigir else possiveis
    a, b = st.columns(2)
    novo = a.selectbox("Novo estado", ["(manter)"] + opcoes)
    data = b.date_input("Data", value=date.today())
    aprovados = db.listar_cvs(conn, vaga_id=vid, estado="aprovado", tipo="cv")
    cv_opts = [None] + [d["id"] for d in aprovados]
    cv_sel = st.selectbox("CV usado (só CVs aprovados)", cv_opts,
                          index=cv_opts.index(c["cv_id"]) if c["cv_id"] in cv_opts else 0,
                          format_func=lambda i: "—" if i is None else f"CV #{i}")
    contacto = st.text_input("Contacto", c["contacto"])
    notas = st.text_area("Notas", c["notas"])
    fu = c["data_followup"]
    data_fu = st.date_input("Data de follow-up", value=datetime.fromisoformat(fu).date() if fu else None)
    if st.form_submit_button("Guardar", type="primary"):
        try:
            if novo != "(manter)":
                estados.mudar_estado(conn, cfg, vid, novo, data=data, cv_id=cv_sel, forcar=corrigir)
                data_fu = None  # o follow-up é recalculado (ou anulado) pela mudança de estado
            elif cv_sel != c["cv_id"] and cv_sel is not None:
                estados.definir_cv(conn, vid, cv_sel)
            estados.atualizar_detalhes(conn, vid, contacto=contacto, notas=notas,
                                       data_followup="manter" if data_fu is None else data_fu)
            st.success("Atualizado.")
            st.rerun()
        except estados.TransicaoInvalida as e:
            st.error(str(e))

st.subheader("Exportar")
dados = metricas.exportar_csv(conn, cfg)
nome = f"tracker_{date.today():%Y%m%d}.csv"
if st.download_button("Descarregar CSV (Power BI)", dados, file_name=nome, mime="text/csv"):
    pasta = resolver(cfg, cfg["exportacao"]["pasta"])
    pasta.mkdir(parents=True, exist_ok=True)
    (pasta / nome).write_bytes(dados)
st.caption(f"Também guardado em {cfg['exportacao']['pasta']}/ ao descarregar. Separador: "
           f"'{cfg['exportacao']['separador_csv']}', codificação UTF-8 com BOM.")
