"""Página Perfil-base: importar o CV, rever os itens com IDs, editar, versionar e validar."""
from __future__ import annotations

import pandas as pd
import streamlit as st

from src import llm, ui
from src.perfil import versoes
from src.perfil.extracao import extrair_texto, propor_perfil
from src.perfil.modelo import Perfil, anos_experiencia

cfg = ui.cfg()
st.title("Perfil-base")
st.caption("A fonte única de verdade do CV. Só a versão validada é usada pelo otimizador de CV. "
           "Uma versão validada é imutável: as alterações criam uma versão nova.")

validada = versoes.versao_validada(cfg)
lista = versoes.listar_versoes(cfg)
if validada:
    st.success(f"Versão validada: v{validada}")
else:
    st.warning("Ainda não há versão validada.")

with st.expander("1. Importar o CV atual (PDF ou Word) e propor um perfil", expanded=not lista):
    ficheiro = st.file_uploader("CV atual", type=["pdf", "docx", "txt"])
    ok_llm, msg = llm.estado(cfg)
    usar = st.toggle("Estruturar com o modelo local", value=False, disabled=not ok_llm, help=msg)
    if ficheiro and st.button("Extrair e propor", type="primary"):
        try:
            texto = extrair_texto(ficheiro.name, ficheiro.getvalue())
            with st.spinner("A estruturar…"):
                proposta, metodo, rever = propor_perfil(cfg, texto, usar_llm=usar)
            st.session_state["proposta"] = (proposta.model_dump(), metodo, rever, texto)
        except Exception as e:
            st.error(f"Não foi possível ler o CV: {e}")
    if "proposta" in st.session_state:
        dados, metodo, rever, texto = st.session_state["proposta"]
        st.write(f"Proposta criada por **{metodo}**. Reveja tudo antes de validar.")
        if rever:
            st.warning("Itens que não encontrei literalmente no CV original (confirme ou corrija):\n\n" +
                       "\n".join(f"- `{i}` {t}" for i, t in rever))
        with st.popover("Ver o texto extraído do CV"):
            st.text(texto)
        if st.button("Guardar a proposta como nova versão (por validar)"):
            n = versoes.guardar_nova_versao(cfg, Perfil.model_validate(dados), f"importado do CV ({metodo})")
            del st.session_state["proposta"]
            st.session_state["versao_sel"] = n
            st.rerun()

lista = versoes.listar_versoes(cfg)
if not lista:
    st.stop()

st.subheader("2. Rever, editar e validar")
sel = st.session_state.get("versao_sel", validada or lista[-1])
n = st.selectbox("Versão", lista, index=lista.index(sel) if sel in lista else len(lista) - 1,
                 format_func=lambda v: f"v{v}" + (" ✅ validada" if v == validada else ""))
st.session_state["versao_sel"] = n
try:
    perfil = versoes.carregar(cfg, n)
except Exception as e:
    st.error(f"A versão v{n} tem erros: {e}")
    perfil = None

if perfil:
    st.caption(f"{perfil.notas_versao} · experiência calculada: {anos_experiencia(perfil)} anos")
    t1, t2 = st.tabs(["Itens com IDs", "Editar (YAML)"])
    with t1:
        dp = perfil.dados_pessoais
        st.write(f"**{dp.nome}** · {dp.email} · {dp.telefone} · {dp.localizacao} {dp.linkedin}")
        if perfil.resumo:
            st.markdown("**Resumo**")
            st.dataframe(pd.DataFrame([r.model_dump() for r in perfil.resumo]), hide_index=True, use_container_width=True)
        for e in perfil.experiencia:
            st.markdown(f"**`{e.id}` · {e.cargo} — {e.empresa}** · {e.local} · {e.data_inicio} → {e.data_fim}")
            if e.itens:
                st.dataframe(pd.DataFrame([i.model_dump() for i in e.itens]), hide_index=True, use_container_width=True)
        for titulo, grupo in (("Formação", perfil.formacao), ("Competências", perfil.competencias),
                              ("Línguas", perfil.linguas), ("Certificações", perfil.certificacoes)):
            if grupo:
                st.markdown(f"**{titulo}**")
                st.dataframe(pd.DataFrame([g.model_dump(exclude={"itens"}) for g in grupo]), hide_index=True,
                             use_container_width=True)
    with t2:
        st.caption("IDs vazios são atribuídos ao gravar; IDs existentes nunca mudam. "
                   "Datas: AAAA-MM ou AAAA; 'atual' para o cargo em curso.")
        texto = st.text_area("perfil_base.yaml", versoes.carregar_texto(cfg, n), height=500, key=f"yaml_{n}")
        a, b = st.columns(2)
        if n == validada:
            if a.button("Criar nova versão a partir deste texto", type="primary"):
                try:
                    novo = versoes.guardar_nova_versao(cfg, versoes.de_yaml(texto, n), "editado a partir de v%d" % n)
                    st.session_state["versao_sel"] = novo
                    st.rerun()
                except Exception as e:
                    st.error(f"Erro no perfil: {e}")
        else:
            if a.button("Gravar esta versão", type="primary"):
                try:
                    versoes.atualizar_rascunho(cfg, n, versoes.de_yaml(texto, n))
                    st.success("Gravado.")
                    st.rerun()
                except Exception as e:
                    st.error(f"Erro no perfil: {e}")

    if n != validada:
        st.divider()
        confirmo = st.checkbox(f"Revi a versão v{n} e confirmo que todos os itens são factos reais.")
        if st.button(f"Validar a versão v{n}", disabled=not confirmo, type="primary"):
            try:
                versoes.validar_versao(cfg, n)
                st.success(f"Versão v{n} validada.")
                st.rerun()
            except Exception as e:
                st.error(str(e))
