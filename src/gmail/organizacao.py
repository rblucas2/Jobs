"""M0 — Organização do Gmail: etiquetas Vagas/*, filtros por fonte e arquivamento dos alertas antigos.

Todas as operações são idempotentes: repetir não cria etiquetas nem filtros duplicados.
"""
from __future__ import annotations

from collections import Counter
from dataclasses import dataclass, field

from ..config import FONTES


@dataclass
class Relatorio:
    etiquetas_criadas: list[str] = field(default_factory=list)
    etiquetas_existentes: list[str] = field(default_factory=list)
    filtros_criados: list[str] = field(default_factory=list)
    filtros_existentes: list[str] = field(default_factory=list)
    filtros_substituidos: list[str] = field(default_factory=list)
    fontes_sem_remetentes: list[str] = field(default_factory=list)
    arquivados: dict[str, int] = field(default_factory=dict)

    def texto(self) -> str:
        linhas = []
        if self.etiquetas_criadas:
            linhas.append("Etiquetas criadas: " + ", ".join(self.etiquetas_criadas))
        if self.etiquetas_existentes:
            linhas.append("Etiquetas já existentes: " + ", ".join(self.etiquetas_existentes))
        if self.filtros_criados:
            linhas.append("Filtros criados: " + ", ".join(self.filtros_criados))
        if self.filtros_existentes:
            linhas.append("Filtros já existentes: " + ", ".join(self.filtros_existentes))
        if self.filtros_substituidos:
            linhas.append("Filtros substituídos (remetentes alterados): " + ", ".join(self.filtros_substituidos))
        if self.fontes_sem_remetentes:
            linhas.append(
                "Sem remetentes no config.yaml (sem filtro): " + ", ".join(self.fontes_sem_remetentes)
                + ". Use 'python setup_gmail.py --descobrir' para os identificar."
            )
        for fonte, n in self.arquivados.items():
            linhas.append(f"Alertas antigos etiquetados e arquivados ({fonte}): {n}")
        return "\n".join(linhas)


def nomes_etiquetas(cfg: dict) -> dict[str, str]:
    raiz = cfg["gmail"]["etiqueta_raiz"]
    nomes = {f: f"{raiz}/{f}" for f in FONTES}
    nomes["_raiz"] = raiz
    nomes["_processado"] = cfg["gmail"]["etiqueta_processado"]
    return nomes


def garantir_etiquetas(servico, cfg: dict, rel: Relatorio | None = None) -> dict[str, str]:
    """Cria as etiquetas em falta. Devolve {chave: label_id}."""
    rel = rel or Relatorio()
    existentes = {
        l["name"]: l["id"]
        for l in servico.users().labels().list(userId="me").execute().get("labels", [])
    }
    nomes = nomes_etiquetas(cfg)
    # A raiz primeiro, para o Gmail mostrar as subetiquetas aninhadas.
    ordem = ["_raiz"] + [k for k in nomes if k != "_raiz"]
    ids = {}
    for chave in ordem:
        nome = nomes[chave]
        if nome in existentes:
            ids[chave] = existentes[nome]
            rel.etiquetas_existentes.append(nome)
            continue
        criada = servico.users().labels().create(
            userId="me",
            body={"name": nome, "labelListVisibility": "labelShow", "messageListVisibility": "show"},
        ).execute()
        ids[chave] = criada["id"]
        existentes[nome] = criada["id"]
        rel.etiquetas_criadas.append(nome)
    return ids


def criterio_remetentes(remetentes: list[str]) -> str:
    return " OR ".join(sorted({r.strip() for r in remetentes if r and r.strip()}))


def garantir_filtros(servico, cfg: dict, ids: dict[str, str], rel: Relatorio | None = None) -> None:
    """Um filtro por fonte: remetente -> aplica a etiqueta e retira da caixa de entrada.

    Só os filtros que adicionam as etiquetas Vagas/* são geridos aqui. Se os remetentes
    de uma fonte mudarem, o filtro antigo dessa etiqueta é apagado e criado de novo
    (a Gmail API não permite editar filtros).
    """
    rel = rel or Relatorio()
    filtros = servico.users().settings().filters().list(userId="me").execute().get("filter", [])
    for fonte in FONTES:
        criterio = criterio_remetentes(cfg["gmail"]["remetentes"].get(fonte) or [])
        label_id = ids[fonte]
        if not criterio:
            rel.fontes_sem_remetentes.append(fonte)
            continue
        da_fonte = [f for f in filtros if label_id in (f.get("action", {}).get("addLabelIds") or [])]
        igual = [
            f for f in da_fonte
            if f.get("criteria", {}).get("from") == criterio
            and "INBOX" in (f.get("action", {}).get("removeLabelIds") or [])
        ]
        if igual:
            rel.filtros_existentes.append(fonte)
            continue
        for antigo in da_fonte:
            servico.users().settings().filters().delete(userId="me", id=antigo["id"]).execute()
        servico.users().settings().filters().create(
            userId="me",
            body={
                "criteria": {"from": criterio},
                "action": {"addLabelIds": [label_id], "removeLabelIds": ["INBOX"]},
            },
        ).execute()
        (rel.filtros_substituidos if da_fonte else rel.filtros_criados).append(fonte)


def _listar_ids(servico, limite: int | None = None, **kwargs) -> list[str]:
    ids, token = [], None
    while True:
        resp = servico.users().messages().list(userId="me", pageToken=token, **kwargs).execute()
        ids += [m["id"] for m in resp.get("messages", [])]
        token = resp.get("nextPageToken")
        if not token or (limite and len(ids) >= limite):
            return ids[:limite] if limite else ids


def arquivar_antigos(servico, cfg: dict, ids: dict[str, str], rel: Relatorio | None = None) -> None:
    """O filtro só atua sobre e-mails novos: etiqueta e arquiva em lote os alertas já recebidos.

    Adicionar uma etiqueta que já existe e retirar INBOX são operações idempotentes.
    Os e-mails continuam por ler.
    """
    rel = rel or Relatorio()
    for fonte in FONTES:
        criterio = criterio_remetentes(cfg["gmail"]["remetentes"].get(fonte) or [])
        if not criterio:
            continue
        msg_ids = _listar_ids(servico, q=f"from:({criterio})", includeSpamTrash=False)
        for i in range(0, len(msg_ids), 1000):  # limite da batchModify
            servico.users().messages().batchModify(
                userId="me",
                body={"ids": msg_ids[i:i + 1000], "addLabelIds": [ids[fonte]], "removeLabelIds": ["INBOX"]},
            ).execute()
        rel.arquivados[fonte] = len(msg_ids)


def configurar(servico, cfg: dict, arquivar: bool = True) -> Relatorio:
    rel = Relatorio()
    ids = garantir_etiquetas(servico, cfg, rel)
    garantir_filtros(servico, cfg, ids, rel)
    if arquivar:
        arquivar_antigos(servico, cfg, ids, rel)
    return rel


CONSULTA_DESCOBERTA = (
    'newer_than:{dias}d (subject:(vaga OR vagas OR emprego OR job OR jobs OR "job alert" OR alerta OR '
    'offre OR emploi OR career OR careers) OR from:(linkedin OR indeed OR net-empregos OR jobs.lu OR '
    'deloitte OR pwc OR ey OR kpmg OR workday OR successfactors))'
)


def descobrir_remetentes(servico, dias: int = 60, maximo: int = 300) -> list[tuple[str, int, str]]:
    """Lista remetentes prováveis de alertas (endereço, n.º de e-mails, exemplo de assunto).

    Serve apenas para o utilizador confirmar os endereços; nada é assumido automaticamente.
    """
    msg_ids = _listar_ids(servico, limite=maximo, q=CONSULTA_DESCOBERTA.format(dias=dias), maxResults=100)
    contagem: Counter = Counter()
    exemplo: dict[str, str] = {}
    for mid in msg_ids:
        m = servico.users().messages().get(
            userId="me", id=mid, format="metadata", metadataHeaders=["From", "Subject"]
        ).execute()
        cab = {h["name"].lower(): h["value"] for h in m.get("payload", {}).get("headers", [])}
        de = cab.get("from", "")
        endereco = de.split("<")[-1].rstrip(">").strip().lower() if de else ""
        if endereco:
            contagem[endereco] += 1
            exemplo.setdefault(endereco, cab.get("subject", ""))
    return [(e, n, exemplo[e]) for e, n in contagem.most_common()]
