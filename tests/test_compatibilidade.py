"""M3 — grelha de ponderação, regra de corte, pontuação preliminar e saneamento da saída do modelo."""
from __future__ import annotations

from src import db
from src.compatibilidade import motor, regras
from src.compatibilidade.schemas import AnaliseLLM, Requisito, Subpontuacoes

DESCRICAO = """Analista de Valuation (m/f) — Lisboa.
Requisitos obrigatórios: Mestrado em Finanças; mínimo de 2 anos de experiência; Excel avançado.
Inglês fluente obrigatório. Valorizamos conhecimentos de Power BI e Bloomberg."""


def vaga(**kw):
    base = {"cargo": "Analista de Valuation", "empresa": "Consultora Alfa", "localizacao": "Lisboa",
            "descricao": DESCRICAO, "descricao_completa": 1}
    base.update(kw)
    return base


def test_pontuacao_global_usa_pesos_do_config(cfg):
    a = AnaliseLLM(subpontuacoes=Subpontuacoes(
        requisitos_obrigatorios=100, experiencia=50, competencias_tecnicas=50, linguas=100,
        localizacao_condicoes=100, alinhamento_areas=0), requisitos=[], resumo="")
    r = motor.pontuar(cfg, a, preliminar=False, metodo="teste")
    # 35*100 + 20*50 + 20*50 + 10*100 + 10*100 + 5*0 = 7500 / 100
    assert r.pontuacao_global == 75


def test_dimensoes_sem_dados_saem_da_ponderacao(cfg):
    a = AnaliseLLM(subpontuacoes=Subpontuacoes(localizacao_condicoes=100, alinhamento_areas=0), requisitos=[], resumo="")
    assert motor.pontuar(cfg, a, True, "x").pontuacao_global == round(100 * 10 / 15)


def test_regra_de_corte_limita_a_49(cfg):
    a = AnaliseLLM(
        subpontuacoes=Subpontuacoes(requisitos_obrigatorios=100, experiencia=100, competencias_tecnicas=100,
                                    linguas=0, localizacao_condicoes=100, alinhamento_areas=100),
        requisitos=[Requisito(descricao="Alemão", dimensao="linguas", obrigatorio=True, eliminatorio=True)],
        resumo="")
    r = motor.pontuar(cfg, a, False, "x")
    assert r.pontuacao_global == 49 and r.eliminatoria_falhada


def test_saneamento_remove_evidencias_inexistentes(perfil):
    a = AnaliseLLM(subpontuacoes=Subpontuacoes(requisitos_obrigatorios=100), resumo="", requisitos=[
        Requisito(descricao="SAP", dimensao="competencias_tecnicas", obrigatorio=True, cumprido=True,
                  evidencia_ids=["comp_sap_inventado"]),
        Requisito(descricao="Excel", dimensao="competencias_tecnicas", obrigatorio=True, cumprido=True,
                  evidencia_ids=["comp_excel"]),
    ])
    s = motor.sanear(a, perfil)
    assert [r.cumprido for r in s.requisitos] == [False, True]
    assert s.subpontuacoes.requisitos_obrigatorios == 50  # recalculado a partir das evidências


def test_regras_detetam_requisitos_e_evidencias(cfg, perfil):
    a = regras.analisar(cfg, perfil, vaga())
    por_desc = {r.descricao.split(" (")[0]: r for r in a.requisitos}
    assert por_desc["Inglês"].cumprido and por_desc["Inglês"].eliminatorio
    assert por_desc["Inglês"].evidencia_ids == ["ling_ingles"]
    assert por_desc["Excel"].cumprido and por_desc["Excel"].obrigatorio
    assert por_desc["Bloomberg"].cumprido is False
    assert por_desc["Mestrado"].cumprido and por_desc["Mestrado"].evidencia_ids == ["form_nova_sbe"]
    assert por_desc["2+ anos de experiência"].cumprido
    assert a.subpontuacoes.localizacao_condicoes == 100
    assert a.subpontuacoes.alinhamento_areas == 100


def test_lingua_obrigatoria_em_falta_aplica_corte(cfg, perfil):
    r = motor.analisar_vaga(cfg, perfil, vaga(descricao=DESCRICAO + "\nAlemão fluente obrigatório."), usar_llm=False)
    assert r.eliminatoria_falhada and r.pontuacao_global <= 49
    assert any("Alemão" in l["descricao"] for l in r.lacunas)


def test_vaga_so_com_resumo_e_preliminar(cfg, perfil):
    r = motor.analisar_vaga(cfg, perfil, vaga(descricao="Consultora Alfa · Lisboa", descricao_completa=0), usar_llm=False)
    assert r.preliminar and r.metodo == "regras"


def test_localizacao_fora_do_alvo(cfg, perfil):
    a = regras.analisar(cfg, perfil, vaga(localizacao="Faro", descricao="Analista de Valuation em Faro."))
    assert a.subpontuacoes.localizacao_condicoes == 0


def test_analisar_e_guardar(conn, cfg, perfil):
    vid = db.inserir_vaga(conn, {"cargo": "Analista de Valuation", "empresa": "Alfa", "localizacao": "Lisboa",
                                 "chave_normalizada": "k", "fonte": "Manual", "descricao": DESCRICAO,
                                 "descricao_completa": True})
    r = motor.analisar_e_guardar(conn, cfg, perfil, vid, usar_llm=False)
    guardada = db.ultima_analise(conn, vid)
    assert guardada["pontuacao_global"] == r.pontuacao_global
    assert guardada["preliminar"] == 0 and isinstance(guardada["lacunas"], list)
    assert db.listar_vagas(conn)[0]["pontuacao_global"] == r.pontuacao_global
