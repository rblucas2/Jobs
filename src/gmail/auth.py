"""Autenticação OAuth na Gmail API (aplicação de ambiente de trabalho).

credentials.json e token.json ficam na pasta do projeto e estão no .gitignore.
"""
from __future__ import annotations

from ..config import resolver

# gmail.modify: ler e etiquetar; gmail.settings.basic: criar filtros.
SCOPES = [
    "https://www.googleapis.com/auth/gmail.modify",
    "https://www.googleapis.com/auth/gmail.settings.basic",
]


class CredenciaisEmFalta(RuntimeError):
    pass


def obter_servico(cfg: dict):
    from google.auth.exceptions import RefreshError
    from google.auth.transport.requests import Request
    from google.oauth2.credentials import Credentials
    from google_auth_oauthlib.flow import InstalledAppFlow
    from googleapiclient.discovery import build

    cred_path = resolver(cfg, cfg["gmail"]["credenciais"])
    token_path = resolver(cfg, cfg["gmail"]["token"])

    creds = None
    if token_path.exists():
        creds = Credentials.from_authorized_user_file(str(token_path), SCOPES)
    if creds and not creds.valid and creds.expired and creds.refresh_token:
        try:
            creds.refresh(Request())
        except RefreshError:
            # Em projetos Google Cloud em modo "Testing" o token expira ao fim de alguns dias:
            # pede-se nova autorização no browser.
            creds = None
    if not creds or not creds.valid:
        if not cred_path.exists():
            raise CredenciaisEmFalta(
                f"Não encontrei {cred_path.name}. Crie credenciais OAuth de 'aplicação de ambiente "
                "de trabalho' no Google Cloud e guarde o ficheiro na pasta do projeto (ver README)."
            )
        flow = InstalledAppFlow.from_client_secrets_file(str(cred_path), SCOPES)
        creds = flow.run_local_server(port=0)
    token_path.write_text(creds.to_json(), encoding="utf-8")
    return build("gmail", "v1", credentials=creds, cache_discovery=False)


def token_existe(cfg: dict) -> bool:
    return resolver(cfg, cfg["gmail"]["token"]).exists()
