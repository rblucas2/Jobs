"""M0/M1 — organização do Gmail e recolha, com um serviço Gmail simulado (sem rede)."""
from __future__ import annotations

import base64
from pathlib import Path

from src import db
from src.gmail import organizacao
from src.gmail.recolha import recolher

EMAILS = Path(__file__).parent / "fixtures" / "emails"


class _Pedido:
    def __init__(self, f):
        self._f = f

    def execute(self):
        return self._f()


class _Labels:
    def __init__(self, g):
        self.g = g

    def list(self, userId):
        return _Pedido(lambda: {"labels": [{"name": n, "id": i} for n, i in self.g.etiquetas.items()]})

    def create(self, userId, body):
        nid = f"L{len(self.g.etiquetas)}"
        self.g.etiquetas[body["name"]] = nid
        return _Pedido(lambda: {"id": nid, "name": body["name"]})


class _Filtros:
    def __init__(self, g):
        self.g = g

    def list(self, userId):
        return _Pedido(lambda: {"filter": list(self.g.filtros)})

    def create(self, userId, body):
        self.g.n += 1
        f = {"id": f"f{self.g.n}", **body}
        self.g.filtros.append(f)
        return _Pedido(lambda: f)

    def delete(self, userId, id):
        self.g.filtros = [f for f in self.g.filtros if f["id"] != id]
        return _Pedido(lambda: {})


class _Mensagens:
    def __init__(self, g):
        self.g = g

    def list(self, userId, q=None, labelIds=None, pageToken=None, **kw):
        ids = [m for m, d in self.g.mensagens.items()
               if all(l in d["labelIds"] for l in (labelIds or []))
               and ("from:" not in (q or "") or d["from"] in q)]
        return _Pedido(lambda: {"messages": [{"id": i} for i in ids]})

    def get(self, userId, id, **kw):
        d = self.g.mensagens[id]
        return _Pedido(lambda: {"id": id, "labelIds": list(d["labelIds"]), "payload": d["payload"]})

    def batchModify(self, userId, body):
        for i in body["ids"]:
            d = self.g.mensagens[i]
            d["labelIds"] = [l for l in d["labelIds"] if l not in body.get("removeLabelIds", [])]
            d["labelIds"] += [l for l in body.get("addLabelIds", []) if l not in d["labelIds"]]
        return _Pedido(lambda: {})

    def modify(self, userId, id, body):
        return self.batchModify(userId, {"ids": [id], **body})


class Gmail:
    """Imita o subconjunto da Gmail API usado pela ferramenta (sem rede)."""

    def __init__(self):
        self.etiquetas = {"INBOX": "INBOX"}
        self.filtros, self.mensagens, self.n = [], {}, 0

    def users(self):
        return self

    def labels(self):
        return _Labels(self)

    def settings(self):
        return self

    def filters(self):
        return _Filtros(self)

    def messages(self):
        return _Mensagens(self)

    def adicionar(self, mid, remetente, html, labels=("INBOX",)):
        dados = base64.urlsafe_b64encode(html.encode()).decode().rstrip("=")
        self.mensagens[mid] = {
            "from": remetente, "labelIds": list(labels),
            "payload": {"mimeType": "text/html", "body": {"data": dados},
                        "headers": [{"name": "From", "value": remetente}, {"name": "Subject", "value": "Alerta"},
                                    {"name": "Date", "value": "Tue, 13 Oct 2026 08:00:00 +0000"}]},
        }


def test_configurar_e_idempotente(cfg):
    cfg["gmail"]["remetentes"]["LinkedIn"] = ["jobalerts-noreply@linkedin.com"]
    g = Gmail()
    r1 = organizacao.configurar(g, cfg)
    assert "Vagas" in r1.etiquetas_criadas and "Vagas/Processado" in r1.etiquetas_criadas
    assert r1.filtros_criados == ["LinkedIn"]
    assert "Indeed" in r1.fontes_sem_remetentes
    n_labels, n_filtros = len(g.etiquetas), len(g.filtros)

    r2 = organizacao.configurar(g, cfg)
    assert r2.etiquetas_criadas == [] and r2.filtros_criados == []
    assert r2.filtros_existentes == ["LinkedIn"]
    assert (len(g.etiquetas), len(g.filtros)) == (n_labels, n_filtros)

    f = g.filtros[0]
    assert f["criteria"]["from"] == "jobalerts-noreply@linkedin.com"
    assert f["action"]["removeLabelIds"] == ["INBOX"]
    assert f["action"]["addLabelIds"] == [g.etiquetas["Vagas/LinkedIn"]]


def test_remetentes_alterados_substituem_o_filtro(cfg):
    g = Gmail()
    cfg["gmail"]["remetentes"]["Indeed"] = ["a@indeed.com"]
    organizacao.configurar(g, cfg)
    cfg["gmail"]["remetentes"]["Indeed"] = ["a@indeed.com", "b@indeed.com"]
    r = organizacao.configurar(g, cfg)
    assert r.filtros_substituidos == ["Indeed"]
    assert len(g.filtros) == 1 and g.filtros[0]["criteria"]["from"] == "a@indeed.com OR b@indeed.com"


def test_arquivar_antigos_retira_da_caixa_de_entrada(cfg):
    cfg["gmail"]["remetentes"]["LinkedIn"] = ["jobalerts-noreply@linkedin.com"]
    g = Gmail()
    g.adicionar("m1", "jobalerts-noreply@linkedin.com", "<html/>")
    g.adicionar("m2", "amigo@exemplo.com", "<html/>")
    organizacao.configurar(g, cfg)
    assert g.mensagens["m1"]["labelIds"] == [g.etiquetas["Vagas/LinkedIn"]]
    assert g.mensagens["m2"]["labelIds"] == ["INBOX"]


def test_recolher_le_marca_processado_e_regista_falhas(cfg, conn):
    g = Gmail()
    ids = organizacao.garantir_etiquetas(g, cfg)
    g.adicionar("m1", "x@linkedin.com", (EMAILS / "linkedin.html").read_text(encoding="utf-8"), [ids["LinkedIn"]])
    g.adicionar("m2", "x@linkedin.com", (EMAILS / "desconhecido.html").read_text(encoding="utf-8"), [ids["LinkedIn"]])
    res = recolher(g, conn, cfg)
    assert res.emails_lidos == 2 and len(res.vagas_novas) == 2 and res.nao_reconhecidos == 1
    assert ids["_processado"] in g.mensagens["m1"]["labelIds"]
    # O não reconhecido NÃO é marcado como processado: será lido de novo quando o parser for corrigido.
    assert ids["_processado"] not in g.mensagens["m2"]["labelIds"]
    assert db.listar_nao_reconhecidos(conn)[0]["gmail_message_id"] == "m2"

    res2 = recolher(g, conn, cfg)
    assert res2.vagas_novas == [] and res2.emails_lidos == 1  # só o não reconhecido
