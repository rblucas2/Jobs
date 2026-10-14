"""Funções partilhadas pelas páginas Streamlit."""
from __future__ import annotations

import streamlit as st

from . import db
from .config import carregar_config, resolver
from .perfil import versoes


def cfg() -> dict:
    """Relido em cada execução, para refletir alterações feitas nas Definições."""
    return carregar_config()


@st.cache_resource
def _ligacao(caminho: str):
    return db.ligar(caminho)


def conn(c: dict):
    return _ligacao(str(resolver(c, c["base_dados"])))


def perfil_ou_none(c: dict):
    try:
        return versoes.perfil_validado(c)
    except versoes.PerfilNaoValidado:
        return None


def rotulo_vaga(v: dict) -> str:
    p = v.get("pontuacao_global")
    pont = "—" if p is None else f"{p}{'*' if v.get('preliminar') else ''}"
    return f"[{pont}] {v['cargo']} — {v['empresa'] or '?'} ({v['localizacao'] or 's/ local'}) · #{v['id']}"


def escolher_vaga(conexao, chave: str = "vaga_id") -> dict | None:
    vagas = db.listar_vagas(conexao)
    if not vagas:
        st.info("Ainda não há vagas. Recolha-as na página Vagas ou adicione uma manualmente.")
        return None
    ids = [v["id"] for v in vagas]
    atual = st.session_state.get(chave)
    if "vaga" in st.query_params:
        try:
            atual = int(st.query_params["vaga"])
        except ValueError:
            pass
    indice = ids.index(atual) if atual in ids else 0
    escolhida = st.selectbox("Vaga", vagas, index=indice, format_func=rotulo_vaga)
    st.session_state[chave] = escolhida["id"]
    return escolhida


def css_diff() -> None:
    from .cv.diff import CSS
    st.markdown(CSS, unsafe_allow_html=True)
