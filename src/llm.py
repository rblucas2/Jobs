"""Cliente do modelo local (Ollama) com saída JSON estruturada e validada por pydantic.

Se o Ollama não estiver instalado/ativo ou o modelo não existir, as funções que dependem
dele recorrem ao modo por regras (fallback), como prevê a especificação.
"""
from __future__ import annotations

from typing import TypeVar

from pydantic import BaseModel, ValidationError

T = TypeVar("T", bound=BaseModel)


class LLMIndisponivel(RuntimeError):
    pass


def _cliente(cfg: dict):
    try:
        import ollama
    except ImportError as e:  # pragma: no cover
        raise LLMIndisponivel("A biblioteca 'ollama' não está instalada.") from e
    return ollama.Client(host=cfg["ollama"]["host"], timeout=cfg["ollama"].get("timeout_s", 300))


def estado(cfg: dict) -> tuple[bool, str]:
    """(disponível, mensagem) — verifica o servidor e se o modelo configurado existe."""
    if not cfg["ollama"].get("ativo", True):
        return False, "Modelo local desativado nas Definições (modo por regras)."
    try:
        resp = _cliente(cfg).list()
    except Exception as e:
        return False, f"Ollama não responde em {cfg['ollama']['host']} ({type(e).__name__})."
    modelos = [getattr(m, "model", None) or (m.get("model") if isinstance(m, dict) else None)
               for m in (getattr(resp, "models", None) or (resp.get("models", []) if isinstance(resp, dict) else []))]
    alvo = cfg["ollama"]["modelo"]
    if not any(m and (m == alvo or m.split(":")[0] == alvo or m == f"{alvo}:latest") for m in modelos):
        return False, f"O modelo '{alvo}' não está instalado. Corra: ollama pull {alvo}"
    return True, f"Ollama ativo com o modelo {alvo}."


def disponivel(cfg: dict) -> bool:
    return estado(cfg)[0]


def gerar_json(cfg: dict, sistema: str, utilizador: str, schema: type[T], tentativas: int = 2) -> T:
    """Pede ao modelo uma resposta conforme o JSON schema e valida-a com pydantic."""
    cliente = _cliente(cfg)
    mensagens = [{"role": "system", "content": sistema}, {"role": "user", "content": utilizador}]
    opcoes = {"temperature": cfg["ollama"].get("temperatura", 0)}
    ultimo_erro: Exception | None = None
    for _ in range(max(1, tentativas)):
        kwargs = dict(model=cfg["ollama"]["modelo"], messages=mensagens,
                      format=schema.model_json_schema(), options=opcoes)
        try:
            try:
                resp = cliente.chat(**kwargs, think=False)
            except TypeError:  # versões antigas da biblioteca sem o parâmetro think
                resp = cliente.chat(**kwargs)
            except Exception as e:  # modelos sem suporte a 'think'
                if "think" not in str(e).lower():
                    raise
                resp = cliente.chat(**kwargs)
        except Exception as e:
            raise LLMIndisponivel(f"Falha ao contactar o Ollama: {e}") from e
        conteudo = resp["message"]["content"] if isinstance(resp, dict) else resp.message.content
        try:
            return schema.model_validate_json(conteudo)
        except ValidationError as e:
            ultimo_erro = e
            mensagens += [
                {"role": "assistant", "content": conteudo},
                {"role": "user", "content": f"O JSON não respeita o schema: {e}. Responde só com JSON válido."},
            ]
    raise ValueError(f"O modelo devolveu JSON inválido: {ultimo_erro}")
