from __future__ import annotations

import shutil
import sys
from pathlib import Path

import pytest
import yaml

RAIZ = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(RAIZ))

from src import db  # noqa: E402
from src.config import carregar_config  # noqa: E402
from src.perfil.modelo import Perfil  # noqa: E402

FIXTURES = Path(__file__).parent / "fixtures"


@pytest.fixture
def perfil() -> Perfil:
    dados = yaml.safe_load((FIXTURES / "perfil_exemplo.yaml").read_text(encoding="utf-8"))
    return Perfil.model_validate(dados)


@pytest.fixture
def cfg(tmp_path) -> dict:
    """Config isolada numa pasta temporária (nunca toca no config.yaml real)."""
    shutil.copy(RAIZ / "config.yaml", tmp_path / "config.yaml")
    (tmp_path / "templates").mkdir()
    shutil.copy(RAIZ / "templates" / "cv_modelo.docx", tmp_path / "templates" / "cv_modelo.docx")
    c = carregar_config(tmp_path / "config.yaml")
    c["_root"] = str(tmp_path)
    c["ollama"]["ativo"] = False  # testes sem modelo local
    return c


@pytest.fixture
def conn():
    c = db.ligar(":memory:")
    yield c
    c.close()


@pytest.fixture
def cfg_com_perfil(cfg, perfil):
    """Config com o perfil de exemplo gravado e validado (versão 1)."""
    from src.perfil import versoes
    n = versoes.guardar_nova_versao(cfg, perfil, "teste")
    versoes.validar_versao(cfg, n)
    return cfg
