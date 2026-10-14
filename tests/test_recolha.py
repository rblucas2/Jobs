"""M1 — parsers, deduplicação, registo de e-mails não reconhecidos e inserção manual.

Os e-mails de teste são SINTÉTICOS. Os parsers devem ser confirmados com uma semana de
alertas reais (critério de conclusão da Fase 2).
"""
from __future__ import annotations

from pathlib import Path

from src import db
from src.config import resolver
from src.gmail.recolha import ResultadoRecolha, inserir_manual, processar_email
from src.parsers.fontes import fonte_por_link, obter_parser
from src.parsers.normalizacao import chave_normalizada, link_canonico

EMAILS = Path(__file__).parent / "fixtures" / "emails"


def ler(nome):
    return (EMAILS / nome).read_text(encoding="utf-8")


# ---------------------------------------------------------------- normalização

def test_link_canonico_linkedin_remove_rastreio():
    a = link_canonico("https://www.linkedin.com/comm/jobs/view/3901234567/?trackingId=abc&refId=x")
    b = link_canonico("https://pt.linkedin.com/jobs/view/analista-at-alfa-3901234567?trk=public")
    assert a == b == "https://www.linkedin.com/jobs/view/3901234567/"


def test_link_canonico_indeed_usa_jk():
    a = link_canonico("https://pt.indeed.com/rc/clk/dl?jk=a1b2c3&from=ja&tk=1")
    b = link_canonico("https://pt.indeed.com/viewjob?jk=a1b2c3&from=serp")
    assert a == b == "https://pt.indeed.com/viewjob?jk=a1b2c3"


def test_link_canonico_generico_remove_utm():
    assert link_canonico("https://www.net-empregos.com/123/x/?utm_source=a&utm_medium=b") == \
        "https://www.net-empregos.com/123/x/"
    assert link_canonico("https://empresa.pt/vaga?id=7&utm_campaign=z&gclid=1") == "https://empresa.pt/vaga?id=7"


def test_chave_normalizada_ignora_acentos_maiusculas_e_pais():
    assert chave_normalizada("Consultora Alfa", "Analista de Transaction Services", "Lisboa, Portugal") == \
        chave_normalizada("CONSULTORA ALFA", "analista de transaction services", "lisboa")


def test_fonte_por_link():
    assert fonte_por_link("https://www.linkedin.com/jobs/view/1") == "LinkedIn"
    assert fonte_por_link("https://careers.kpmg.pt/job/123") == "Big4"
    assert fonte_por_link("https://www.survey.com/x") == "Outras"
    assert fonte_por_link("") == "Manual"


# ---------------------------------------------------------------- parsers

def test_parser_linkedin():
    vagas = obter_parser("LinkedIn").extrair(ler("linkedin.html"))
    assert [v.cargo for v in vagas] == ["Analista de Transaction Services", "Valuation Associate"]
    assert vagas[0].empresa == "Consultora Alfa"
    assert "Lisboa" in vagas[0].localizacao
    assert vagas[1].empresa == "Banco Beta"
    assert "Luxembourg" in vagas[1].localizacao


def test_parser_indeed():
    vagas = obter_parser("Indeed").extrair(ler("indeed.html"))
    assert [(v.cargo, v.empresa, v.localizacao) for v in vagas] == [
        ("Controller Financeiro (m/f)", "Empresa Gama", "Porto"),
        ("Analista de M&A", "Grupo Delta", "Lisboa"),
    ]


def test_parser_texto_simples_net_empregos():
    vagas = obter_parser("Net-Empregos").extrair(None, ler("net_empregos.txt"))
    assert [(v.cargo, v.empresa, v.localizacao) for v in vagas] == [
        ("Técnico de Contabilidade", "Empresa Épsilon", "Braga"),
        ("Analista Financeiro Júnior", "Empresa Zeta", "Lisboa"),
    ]


def test_outras_sem_padroes_nao_reconhece_nada():
    assert obter_parser("Outras").extrair(ler("linkedin.html")) == []


def test_padroes_extra_do_config(cfg):
    cfg["parsers"]["padroes_link_extra"]["Outras"] = [r"exemplo\.pt/blog"]
    assert len(obter_parser("Outras", cfg).extrair(ler("desconhecido.html"))) == 1


# ---------------------------------------------------------------- processamento e deduplicação

META = {"from": "alertas@exemplo.com", "subject": "Novas vagas", "date": "2026-10-13"}


def test_processar_email_guarda_e_deduplica(conn, cfg):
    res = ResultadoRecolha()
    assert processar_email(conn, cfg, "LinkedIn", "m1", ler("linkedin.html"), None, META, res)
    assert len(res.vagas_novas) == 2
    # O mesmo alerta recebido de novo (outro e-mail, outros parâmetros de rastreio) não duplica.
    html2 = ler("linkedin.html").replace("trackingId=abc", "trackingId=zzz")
    res2 = ResultadoRecolha()
    processar_email(conn, cfg, "LinkedIn", "m2", html2, None, META, res2)
    assert res2.vagas_novas == [] and res2.duplicadas == 2
    assert len(db.listar_vagas(conn)) == 2
    v = db.listar_vagas(conn)[0]
    assert v["estado"] == "Por candidatar" and v["data_publicacao"] == "2026-10-13"


def test_deduplicacao_entre_fontes_pela_chave(conn, cfg):
    inserir_manual(conn, "Analista de Transaction Services", "Consultora Alfa", "Lisboa", "", "texto")
    res = ResultadoRecolha()
    processar_email(conn, cfg, "LinkedIn", "m1", ler("linkedin.html"), None, META, res)
    assert res.duplicadas == 1 and len(res.vagas_novas) == 1


def test_email_nao_reconhecido_fica_registado(conn, cfg):
    res = ResultadoRecolha()
    assert not processar_email(conn, cfg, "LinkedIn", "m9", ler("desconhecido.html"), None, META, res)
    assert res.nao_reconhecidos == 1
    pend = db.listar_nao_reconhecidos(conn)
    assert pend[0]["gmail_message_id"] == "m9"
    log = resolver(cfg, cfg["logs"]["nao_reconhecidos"]).read_text(encoding="utf-8")
    assert "m9" in log and "Novas vagas" in log
    # Repetir não duplica o registo.
    processar_email(conn, cfg, "LinkedIn", "m9", ler("desconhecido.html"), None, META, ResultadoRecolha())
    assert len(db.listar_nao_reconhecidos(conn)) == 1


def test_erro_no_parser_nao_falha_em_silencio(conn, cfg, monkeypatch):
    from src.parsers import base

    def rebenta(*a, **k):
        raise RuntimeError("HTML inesperado")
    monkeypatch.setattr(base.ParserAlerta, "extrair", rebenta)
    res = ResultadoRecolha()
    assert not processar_email(conn, cfg, "Indeed", "m5", "<html/>", None, META, res)
    assert "HTML inesperado" in db.listar_nao_reconhecidos(conn)[0]["motivo"]


def test_inserir_manual(conn):
    vid, nova = inserir_manual(conn, "Analista", "Empresa", "Porto", "https://pt.indeed.com/viewjob?jk=1&from=x", "desc")
    assert nova
    v = db.obter_vaga(conn, vid)
    assert v["fonte"] == "Indeed" and v["descricao_completa"] == 1 and v["origem"] == "manual"
    assert inserir_manual(conn, "Analista", "Empresa", "Porto", "https://pt.indeed.com/viewjob?jk=1")[1] is False
