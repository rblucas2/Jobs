"""Testes do validador do M4.

Critério de conclusão da Fase 5: um número ou facto inexistente no perfil é SEMPRE bloqueado.
"""
from __future__ import annotations

import random

import pytest

from src.cv.schemas import BlocoExperiencia, Carta, CVAdaptado, Ponto
from src.cv.validador import numeros, pode_aprovar, problemas, validar_carta, validar_cv
from src.perfil.modelo import indexar


def cv_com(pontos_exp: list[Ponto], exp_id: str = "exp_intermarche", resumo: list[Ponto] | None = None) -> CVAdaptado:
    return CVAdaptado(
        resumo=resumo or [],
        experiencia=[BlocoExperiencia(experiencia_id=exp_id, pontos=pontos_exp)],
        formacao_ids=["form_nova_sbe"], competencias_ids=["comp_excel"], linguas_ids=["ling_ingles"],
    )


def validar_um(perfil, cfg, texto, ids, exp_id="exp_intermarche"):
    cv = validar_cv(cv_com([Ponto(texto=texto, source_ids=ids)], exp_id), perfil, cfg)
    return cv.experiencia[0].pontos[0]


def validar_resumo(perfil, cfg, texto, ids):
    cv = validar_cv(cv_com([], resumo=[Ponto(texto=texto, source_ids=ids)]), perfil, cfg)
    return cv.resumo[0]


# ---------------------------------------------------------------- casos válidos

def test_ponto_copiado_da_origem_e_verificado(perfil, cfg):
    p = validar_um(perfil, cfg, perfil.experiencia[0].itens[0].texto, ["exp_intermarche_01"])
    assert p.estado == "verificado", p.motivos


def test_reformulacao_sem_factos_novos_e_verificada(perfil, cfg):
    p = validar_um(perfil, cfg,
                   "Reporting mensal de vendas e margens de 45 lojas com Excel e Power BI.",
                   ["exp_intermarche_01"])
    assert p.estado == "verificado", p.motivos


def test_separadores_de_milhares_equivalentes(perfil, cfg):
    p = validar_um(perfil, cfg, "Análise de desvios orçamentais em 1500 artigos por trimestre.",
                   ["exp_intermarche_03"])
    assert p.estado == "verificado", p.motivos


def test_ano_do_cabecalho_da_experiencia_e_aceite(perfil, cfg):
    p = validar_um(perfil, cfg, "Desde 2021, reporting mensal de vendas para 45 lojas.", ["exp_intermarche_01"])
    assert p.estado == "verificado", p.motivos


def test_juntar_dois_itens_da_mesma_experiencia(perfil, cfg):
    p = validar_um(perfil, cfg,
                   "Automatização de relatórios em VBA (redução de 15% no fecho) e reporting para 45 lojas.",
                   ["exp_intermarche_01", "exp_intermarche_02"])
    assert p.estado == "verificado", p.motivos


def test_resumo_pode_citar_competencias(perfil, cfg):
    p = validar_resumo(perfil, cfg, "Utilizador de Excel, Power BI e SQL.", ["comp_excel", "comp_power_bi", "comp_sql"])
    assert p.estado == "verificado", p.motivos


def test_resumo_anos_de_experiencia_derivados_das_datas(perfil, cfg):
    p = validar_resumo(perfil, cfg, "Analista financeiro com 3 anos de experiência.", ["resumo_01", "exp_intermarche"])
    assert p.estado == "verificado", p.motivos


# ---------------------------------------------------------------- source_ids

def test_sem_source_ids_e_bloqueado(perfil, cfg):
    p = validar_um(perfil, cfg, "Reporting mensal de vendas.", [])
    assert p.estado == "nao_verificado"
    assert any("source_ids" in m for m in p.motivos)


def test_source_id_inexistente_e_bloqueado(perfil, cfg):
    p = validar_um(perfil, cfg, "Reporting mensal de vendas.", ["exp_intermarche_99"])
    assert p.estado == "nao_verificado"
    assert any("inexistentes" in m for m in p.motivos)


def test_citar_outra_experiencia_e_bloqueado(perfil, cfg):
    # Mover um facto da auditora para o Intermarché acrescentaria um facto falso.
    p = validar_um(perfil, cfg, "Apoio a trabalhos de auditoria financeira de 8 clientes.", ["exp_auditora_01"])
    assert p.estado == "nao_verificado"
    assert any("outra" in m for m in p.motivos)


def test_competencia_nao_pode_justificar_ferramenta_numa_experiencia(perfil, cfg):
    # "Usei SQL no Intermarché" não está no perfil, mesmo que SQL seja uma competência.
    p = validar_um(perfil, cfg, "Análise de desvios orçamentais em SQL.", ["exp_intermarche_03", "comp_sql"])
    assert p.estado == "nao_verificado"


def test_experiencia_inexistente_e_erro_estrutural(perfil, cfg):
    cv = validar_cv(cv_com([Ponto(texto="x", source_ids=["resumo_01"])], exp_id="exp_inventada"), perfil, cfg)
    assert any("exp_inventada" in e for e in cv.erros)
    assert not pode_aprovar(cv)


def test_ids_de_seccoes_invalidos_sao_erro(perfil, cfg):
    cv = cv_com([Ponto(texto=perfil.experiencia[0].itens[0].texto, source_ids=["exp_intermarche_01"])])
    cv.competencias_ids = ["comp_excel", "comp_inventada"]
    cv.linguas_ids = ["comp_excel"]  # tipo errado
    v = validar_cv(cv, perfil, cfg)
    assert any("comp_inventada" in e for e in v.erros)
    assert any("línguas" in e for e in v.erros)


# ---------------------------------------------------------------- números, datas e percentagens

@pytest.mark.parametrize("texto", [
    "Reporting mensal de vendas e margens para 50 lojas, em Excel e Power BI.",     # número alterado
    "Reporting mensal de vendas e margens para 45 lojas e 3 regiões.",               # número novo
    "Redução de 20% no tempo de fecho mensal com VBA.",                              # percentagem alterada
    "Redução de 15% no tempo de fecho mensal, poupando 120 horas por ano.",          # número novo
    "Análise de desvios orçamentais com 1,5 artigos.",                               # decimal ≠ milhar
    "Desde 2019, reporting mensal para 45 lojas.",                                   # data inventada
    "Reporting mensal para 45 lojas, com um orçamento de 2M€.",                      # valor inventado
    "Reporting mensal para 45 lojas, com vendas de 50k.",                            # multiplicador
    "Reporting mensal para 45 lojas e cinco regiões.",                               # número por extenso
    "Reporting mensal para 45 lojas e milhares de artigos.",                         # quantidade vaga
    "Redução de 15 % do tempo de fecho e de 10 % dos erros.",                        # percentagem nova
])
def test_numeros_inexistentes_sao_bloqueados(perfil, cfg, texto):
    ids = ["exp_intermarche_01", "exp_intermarche_02"]
    p = validar_um(perfil, cfg, texto, ids)
    assert p.estado == "nao_verificado", texto


def test_percentagem_nao_pode_vir_de_numero_simples(perfil, cfg):
    # Na origem "45" são lojas, não uma percentagem.
    p = validar_um(perfil, cfg, "Aumento de 45% nas vendas das lojas.", ["exp_intermarche_01"])
    assert p.estado == "nao_verificado"


def test_numero_de_outro_item_nao_citado_e_bloqueado(perfil, cfg):
    # 15% existe no perfil, mas não no item citado.
    p = validar_um(perfil, cfg, "Reporting mensal para 45 lojas com redução de 15% no fecho.", ["exp_intermarche_01"])
    assert p.estado == "nao_verificado"


def test_anos_de_experiencia_acima_do_real_sao_bloqueados(perfil, cfg):
    p = validar_resumo(perfil, cfg, "Analista financeiro com 10 anos de experiência.", ["resumo_01", "exp_intermarche"])
    assert p.estado == "nao_verificado"


def test_qualquer_numero_novo_e_sempre_bloqueado(perfil, cfg):
    """Propriedade: para cada item do perfil, inserir um número que não existe na origem bloqueia o ponto."""
    rng = random.Random(42)
    idx = indexar(perfil)
    for e in perfil.experiencia:
        for item in e.itens:
            origem = numeros(idx[item.id].contexto)
            for _ in range(25):
                n = rng.choice([rng.randint(2, 99), rng.randint(100, 9999), rng.randint(10_000, 999_999)])
                if any(abs(float(v) - n) < 1e-9 for v in origem):
                    continue
                escrito = rng.choice([f"{n}", f"{n}%", f"{n} €", f"+{n}", f"{n:,}".replace(",", ".")])
                texto = f"{item.texto} Resultado: {escrito}."
                p = validar_um(perfil, cfg, texto, [item.id], e.id)
                assert p.estado == "nao_verificado", texto


# ---------------------------------------------------------------- ferramentas, certificações, línguas, entidades

@pytest.mark.parametrize("texto,motivo", [
    ("Reporting mensal de vendas para 45 lojas em Tableau.", "Tableau"),
    ("Reporting mensal de vendas para 45 lojas em Excel e SAP.", "SAP"),
    ("Reporting mensal de vendas para 45 lojas, com certificação CFA.", "CFA"),
    ("Reporting mensal de vendas para 45 lojas em inglês e francês.", "Francês"),
    ("Reporting mensal de vendas para 45 lojas em SQL.", "SQL"),
    ("Reporting mensal de vendas para 45 lojas da Sonae.", "Sonae"),
    ("Reporting mensal de vendas para 45 lojas segundo IFRS.", "IFRS"),
])
def test_termos_inexistentes_na_origem_sao_bloqueados(perfil, cfg, texto, motivo):
    p = validar_um(perfil, cfg, texto, ["exp_intermarche_01"])
    assert p.estado == "nao_verificado", texto
    assert any(motivo.lower() in m.lower() for m in p.motivos), p.motivos


def test_lingua_inexistente_no_perfil_e_bloqueada_no_resumo(perfil, cfg):
    p = validar_resumo(perfil, cfg, "Fluente em inglês e alemão.", ["ling_ingles"])
    assert p.estado == "nao_verificado"


def test_certificacao_inventada_no_resumo_e_bloqueada(perfil, cfg):
    p = validar_resumo(perfil, cfg, "Analista financeiro certificado ACCA.", ["resumo_01"])
    assert p.estado == "nao_verificado"


@pytest.mark.parametrize("texto", [
    "Duplicou a eficiência do reporting mensal de vendas para 45 lojas.",
    "Melhor analista do reporting mensal de vendas para 45 lojas.",
    "Reporting mensal de vendas para todas as 45 lojas.",
    "Prémio pelo reporting mensal de vendas para 45 lojas.",
])
def test_termos_quantitativos_ou_de_distincao_sao_bloqueados(perfil, cfg, texto):
    p = validar_um(perfil, cfg, texto, ["exp_intermarche_01"])
    assert p.estado == "nao_verificado", texto


# ---------------------------------------------------------------- aprovação

def test_cv_com_ponto_nao_verificado_nao_pode_ser_aprovado(perfil, cfg):
    cv = validar_cv(cv_com([
        Ponto(texto=perfil.experiencia[0].itens[0].texto, source_ids=["exp_intermarche_01"]),
        Ponto(texto="Gestão de uma equipa de 12 pessoas.", source_ids=["exp_intermarche_01"]),
    ]), perfil, cfg)
    assert not pode_aprovar(cv)
    assert any("12" in p for p in problemas(cv))


def test_cv_totalmente_verificado_pode_ser_aprovado(perfil, cfg):
    cv = validar_cv(cv_com([Ponto(texto=i.texto, source_ids=[i.id]) for i in perfil.experiencia[0].itens]), perfil, cfg)
    assert pode_aprovar(cv), problemas(cv)


def test_estado_dado_pelo_modelo_e_ignorado(perfil, cfg):
    # O modelo não pode "auto-verificar" um ponto.
    cv = cv_com([Ponto(texto="Gestão de 12 pessoas.", source_ids=["exp_intermarche_01"], estado="verificado")])
    assert validar_cv(cv, perfil, cfg).experiencia[0].pontos[0].estado == "nao_verificado"


def test_carta_permite_cargo_e_empresa_da_vaga_mas_nao_factos_novos(perfil, cfg):
    vaga = {"cargo": "Analista de Valuation", "empresa": "Consultora Alfa"}
    ok = Ponto(texto="Candidato-me à posição de Analista de Valuation na Consultora Alfa, "
                     "com experiência em controlo de gestão e reporting no retalho.", source_ids=["resumo_01"])
    mau = Ponto(texto="Na Consultora Alfa poderei aplicar os meus 6 anos de experiência em M&A.", source_ids=["resumo_01"])
    c = validar_carta(Carta(paragrafos=[ok, mau]), perfil, cfg, vaga)
    assert c.paragrafos[0].estado == "verificado", c.paragrafos[0].motivos
    assert c.paragrafos[1].estado == "nao_verificado"
