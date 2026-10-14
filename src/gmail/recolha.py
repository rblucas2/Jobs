"""M1 — Recolha de vagas: lê os alertas em Vagas/*, extrai, deduplica e guarda.

Também trata a inserção manual de vagas.
"""
from __future__ import annotations

import base64
import logging
from dataclasses import dataclass, field
from datetime import datetime
from email.utils import parsedate_to_datetime

from .. import db
from ..config import FONTES, resolver
from ..parsers.base import VagaExtraida
from ..parsers.fontes import fonte_por_link, obter_parser
from ..parsers.normalizacao import chave_normalizada, link_canonico
from .organizacao import garantir_etiquetas


@dataclass
class ResultadoRecolha:
    emails_lidos: int = 0
    vagas_novas: list[int] = field(default_factory=list)
    duplicadas: int = 0
    nao_reconhecidos: int = 0
    avisos: list[str] = field(default_factory=list)


def _logger(cfg: dict) -> logging.Logger:
    caminho = resolver(cfg, cfg["logs"]["nao_reconhecidos"])
    caminho.parent.mkdir(parents=True, exist_ok=True)
    log = logging.getLogger(f"nao_reconhecidos:{caminho}")
    if not log.handlers:
        h = logging.FileHandler(caminho, encoding="utf-8")
        h.setFormatter(logging.Formatter("%(asctime)s\t%(message)s"))
        log.addHandler(h)
        log.setLevel(logging.INFO)
        log.propagate = False
    return log


def registar_falha(conn, cfg: dict, message_id: str, fonte: str, meta: dict, motivo: str) -> bool:
    novo = db.registar_nao_reconhecido(
        conn, message_id, fonte, meta.get("from", ""), meta.get("subject", ""), meta.get("date", ""), motivo
    )
    if novo:
        _logger(cfg).info(
            "\t".join([message_id, fonte, meta.get("from", ""), meta.get("subject", ""), motivo])
        )
    return novo


# ---------------------------------------------------------------- inserção (comum a Gmail e manual)

def guardar_vaga(conn, fonte: str, cargo: str, empresa: str, localizacao: str, link: str | None,
                 descricao: str = "", descricao_completa: bool = False, data_publicacao: str | None = None,
                 gmail_message_id: str | None = None, origem: str = "gmail") -> tuple[int, bool]:
    """Insere a vaga se não for duplicada. Devolve (id, nova)."""
    canon = link_canonico(link)
    chave = chave_normalizada(empresa, cargo, localizacao)
    existente = db.encontrar_duplicado(conn, canon, chave)
    if existente:
        return existente, False
    vid = db.inserir_vaga(conn, {
        "cargo": cargo.strip(), "empresa": (empresa or "").strip(), "localizacao": (localizacao or "").strip(),
        "link_canonico": canon, "link_original": link, "chave_normalizada": chave, "fonte": fonte,
        "data_publicacao": data_publicacao, "descricao": descricao, "descricao_completa": descricao_completa,
        "gmail_message_id": gmail_message_id, "origem": origem,
    })
    return vid, True


def inserir_manual(conn, cargo: str, empresa: str, localizacao: str = "", link: str = "",
                   descricao: str = "", descricao_completa: bool = True, fonte: str | None = None) -> tuple[int, bool]:
    if not cargo.strip():
        raise ValueError("O cargo é obrigatório.")
    fonte = fonte or fonte_por_link(link)
    return guardar_vaga(conn, fonte, cargo, empresa, localizacao, link or None, descricao,
                        descricao_completa, datetime.now().date().isoformat(), None, "manual")


# ---------------------------------------------------------------- e-mails

def _decodificar(dados: str) -> str:
    return base64.urlsafe_b64decode(dados + "=" * (-len(dados) % 4)).decode("utf-8", errors="replace")


def partes_email(payload: dict) -> tuple[str | None, str | None]:
    """Devolve (html, texto) de um payload da Gmail API."""
    html, texto = None, None
    pilha = [payload]
    while pilha:
        p = pilha.pop()
        pilha.extend(p.get("parts", []) or [])
        corpo = (p.get("body") or {}).get("data")
        if not corpo:
            continue
        tipo = p.get("mimeType", "")
        if tipo == "text/html" and html is None:
            html = _decodificar(corpo)
        elif tipo == "text/plain" and texto is None:
            texto = _decodificar(corpo)
    return html, texto


def metadados(payload: dict) -> dict:
    cab = {h["name"].lower(): h["value"] for h in payload.get("headers", [])}
    data = None
    if cab.get("date"):
        try:
            data = parsedate_to_datetime(cab["date"]).date().isoformat()
        except (TypeError, ValueError):
            data = None
    return {"from": cab.get("from", ""), "subject": cab.get("subject", ""), "date": data or ""}


def processar_email(conn, cfg: dict, fonte: str, message_id: str, html: str | None, texto: str | None,
                    meta: dict, res: ResultadoRecolha) -> bool:
    """Extrai e guarda as vagas de um e-mail. Devolve True se o e-mail foi reconhecido."""
    try:
        vagas: list[VagaExtraida] = obter_parser(fonte, cfg).extrair(html, texto)
    except Exception as e:  # nunca falhar em silêncio
        if registar_falha(conn, cfg, message_id, fonte, meta, f"erro no parser: {type(e).__name__}: {e}"):
            res.nao_reconhecidos += 1
        return False
    if not vagas:
        motivo = "nenhuma vaga reconhecida"
        if fonte == "Outras" and not (cfg["parsers"]["padroes_link_extra"].get("Outras") or []):
            motivo += " (a fonte 'Outras' precisa de padrões em parsers.padroes_link_extra.Outras)"
        if registar_falha(conn, cfg, message_id, fonte, meta, motivo):
            res.nao_reconhecidos += 1
        return False
    for v in vagas:
        vid, nova = guardar_vaga(
            conn, fonte, v.cargo, v.empresa, v.localizacao, v.link, descricao=v.resumo,
            data_publicacao=v.data_publicacao or meta.get("date") or None, gmail_message_id=message_id,
        )
        if nova:
            res.vagas_novas.append(vid)
        else:
            res.duplicadas += 1
        if v.avisos:
            res.avisos.append(f"{v.cargo}: {', '.join(v.avisos)} (e-mail: {meta.get('subject', '')})")
    db.remover_nao_reconhecido(conn, message_id)
    return True


def recolher(servico, conn, cfg: dict) -> ResultadoRecolha:
    """Lê os e-mails Vagas/* ainda não processados e marca-os com Vagas/Processado."""
    res = ResultadoRecolha()
    ids = garantir_etiquetas(servico, cfg)
    processado = ids["_processado"]
    maximo = int(cfg["gmail"].get("max_emails_por_recolha") or 200)
    q_proc = "-label:" + cfg["gmail"]["etiqueta_processado"].lower().replace("/", "-").replace(" ", "-")
    ignorados = {r["gmail_message_id"] for r in db.listar_nao_reconhecidos(conn, apenas_pendentes=False)
                 if r["resolvido"]}

    for fonte in FONTES:
        token = None
        while res.emails_lidos < maximo:
            resp = servico.users().messages().list(
                userId="me", labelIds=[ids[fonte]], q=q_proc, pageToken=token, maxResults=100
            ).execute()
            for m in resp.get("messages", []):
                if res.emails_lidos >= maximo:
                    break
                if m["id"] in ignorados:  # marcado como revisto/ignorado na página Vagas
                    continue
                msg = servico.users().messages().get(userId="me", id=m["id"], format="full").execute()
                if processado in msg.get("labelIds", []):
                    continue
                res.emails_lidos += 1
                html, texto = partes_email(msg.get("payload", {}))
                meta = metadados(msg.get("payload", {}))
                if processar_email(conn, cfg, fonte, m["id"], html, texto, meta, res):
                    servico.users().messages().modify(
                        userId="me", id=m["id"], body={"addLabelIds": [processado]}
                    ).execute()
            token = resp.get("nextPageToken")
            if not token:
                break
    if res.emails_lidos >= maximo:
        res.avisos.append(f"Limite de {maximo} e-mails por recolha atingido; volte a recolher para continuar.")
    return res
