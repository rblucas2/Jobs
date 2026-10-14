"""Página Vagas: lista ordenada por pontuação, recolha do Gmail, inserção manual, descartar."""
from __future__ import annotations

from datetime import date, timedelta

import pandas as pd
import streamlit as st

from src import db, ui
from src.compatibilidade.motor import AVISO, analisar_e_guardar
from src.config import FONTES
from src.gmail.recolha import inserir_manual
from src.tracker import estados

cfg = ui.cfg()
conn = ui.conn(cfg)
perfil = ui.perfil_ou_none(cfg)

st.title("Vagas")
st.caption(AVISO + " Pontuações com * são preliminares (só com o resumo do alerta).")


def pontuar(ids: list[int]) -> int:
    if not perfil:
        st.warning("Valide o perfil-base para as vagas serem pontuadas.")
        return 0
    barra = st.progress(0.0, text="A pontuar…")
    for n, vid in enumerate(ids, 1):
        analisar_e_guardar(conn, cfg, perfil, vid)
        barra.progress(n / len(ids), text=f"A pontuar… {n}/{len(ids)}")
    barra.empty()
    return len(ids)


c1, c2, _ = st.columns([1, 1, 2])
if c1.button("Recolher novas vagas", type="primary", icon=":material/download:"):
    try:
        from src.gmail.auth import obter_servico
        from src.gmail.recolha import recolher
        with st.spinner("A ler os alertas do Gmail…"):
            res = recolher(obter_servico(cfg), conn, cfg)
        st.success(f"{res.emails_lidos} e-mails lidos · {len(res.vagas_novas)} vagas novas · "
                   f"{res.duplicadas} duplicadas · {res.nao_reconhecidos} e-mails não reconhecidos")
        for a in res.avisos:
            st.warning(a)
        if res.vagas_novas:
            pontuar(res.vagas_novas)
    except Exception as e:
        st.error(f"Não foi possível recolher: {e}")

sem = db.vagas_sem_analise(conn)
if c2.button(f"Pontuar vagas sem análise ({len(sem)})", disabled=not sem):
    pontuar(sem)
    st.rerun()

with st.expander("Adicionar vaga manualmente"):
    with st.form("manual", clear_on_submit=True):
        a, b, c = st.columns(3)
        cargo = a.text_input("Cargo *")
        empresa = b.text_input("Empresa")
        local = c.text_input("Localização")
        link = st.text_input("Link da vaga (não é aberto pela ferramenta)")
        desc = st.text_area("Descrição da vaga (colar)", height=180)
        completa = st.checkbox("É a descrição completa", value=True)
        if st.form_submit_button("Adicionar"):
            try:
                vid, nova = inserir_manual(conn, cargo, empresa, local, link, desc, completa)
                if nova:
                    st.success(f"Vaga #{vid} adicionada.")
                    pontuar([vid])
                else:
                    st.info(f"Já existia (vaga #{vid}).")
            except ValueError as e:
                st.error(str(e))

pendentes = db.listar_nao_reconhecidos(conn)
if pendentes:
    with st.expander(f"⚠️ {len(pendentes)} e-mail(s) não reconhecido(s) — rever", expanded=False):
        st.caption("Estes e-mails estão em Vagas/* mas nenhum parser encontrou vagas. Não foram marcados "
                   "como processados e serão lidos de novo. Pode inserir as vagas manualmente e marcá-los como revistos. "
                   "Registo completo em logs/emails_nao_reconhecidos.log.")
        for p in pendentes:
            x, y = st.columns([5, 1])
            x.write(f"**{p['assunto'] or '(sem assunto)'}** — {p['remetente']} · {p['data_email']} · "
                    f"{p['fonte']} · _{p['motivo']}_")
            if y.button("Revisto", key=f"res{p['id']}"):
                db.resolver_nao_reconhecido(conn, p["id"])
                st.rerun()

vagas = db.listar_vagas(conn)
if not vagas:
    st.info("Ainda não há vagas.")
    st.stop()

f1, f2, f3, f4 = st.columns(4)
fontes = f1.multiselect("Fonte", sorted({v["fonte"] for v in vagas} | set(FONTES)))
estados_sel = f2.multiselect("Estado", estados.ESTADOS,
                             default=[e for e in estados.ESTADOS if e != estados.DESCARTADA])
local = f3.text_input("Localização contém")
desde = f4.date_input("Recolhidas desde", value=date.today() - timedelta(days=60))

filtradas = [
    v for v in vagas
    if (not fontes or v["fonte"] in fontes)
    and (not estados_sel or v["estado"] in estados_sel)
    and (not local or local.lower() in (v["localizacao"] or "").lower())
    and (v["data_recolha"] or "")[:10] >= desde.isoformat()
]

df = pd.DataFrame([{
    "id": v["id"],
    "Pontuação": v["pontuacao_global"],
    "Prelim.": "sim" if v["preliminar"] else ("" if v["preliminar"] is None else "não"),
    "Corte": "⚠️" if v["eliminatoria_falhada"] else "",
    "Cargo": v["cargo"], "Empresa": v["empresa"], "Localização": v["localizacao"],
    "Fonte": v["fonte"], "Publicada": v["data_publicacao"], "Estado": v["estado"],
    "Link": v["link_canonico"] or v["link_original"],
} for v in filtradas])

st.write(f"{len(filtradas)} de {len(vagas)} vagas")
sel = st.dataframe(
    df, hide_index=True, use_container_width=True, on_select="rerun", selection_mode="single-row",
    column_config={
        "id": st.column_config.NumberColumn("#", width="small"),
        "Pontuação": st.column_config.ProgressColumn("Pontuação", min_value=0, max_value=100, format="%d"),
        "Link": st.column_config.LinkColumn("Link", display_text="abrir"),
    },
)
linhas = sel.selection.rows if sel and sel.selection else []
if linhas:
    vid = int(df.iloc[linhas[0]]["id"])
    st.session_state["vaga_id"] = vid
    a, b, _ = st.columns([1, 1, 3])
    if a.button("Abrir detalhe", type="primary"):
        st.switch_page("pages/detalhe_vaga.py")
    estado_atual = db.obter_candidatura(conn, vid)["estado"]
    if b.button("Descartar", disabled=estados.DESCARTADA not in estados.transicoes_possiveis(estado_atual)):
        estados.mudar_estado(conn, cfg, vid, estados.DESCARTADA)
        st.rerun()
