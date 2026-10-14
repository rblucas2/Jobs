"""Configuração única do Gmail (M0). Pode ser repetida sem criar duplicados.

    python setup_gmail.py              # etiquetas Vagas/*, filtros por fonte e arquivo dos alertas antigos
    python setup_gmail.py --descobrir  # lista remetentes prováveis de alertas, para confirmar no config.yaml
    python setup_gmail.py --sem-arquivar   # não mexe nos e-mails antigos

Na primeira execução abre o browser para autorizar o acesso (credentials.json tem de existir).
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from src.config import carregar_config  # noqa: E402
from src.gmail import organizacao  # noqa: E402
from src.gmail.auth import CredenciaisEmFalta, obter_servico  # noqa: E402


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--descobrir", action="store_true", help="listar remetentes prováveis dos alertas")
    p.add_argument("--dias", type=int, default=60, help="janela da descoberta, em dias (por defeito 60)")
    p.add_argument("--sem-arquivar", action="store_true", help="não etiquetar/arquivar os alertas antigos")
    args = p.parse_args()

    cfg = carregar_config()
    try:
        servico = obter_servico(cfg)
    except CredenciaisEmFalta as e:
        print(e)
        return 1

    if args.descobrir:
        print(f"Remetentes prováveis de alertas nos últimos {args.dias} dias (confirme antes de usar):\n")
        for endereco, n, assunto in organizacao.descobrir_remetentes(servico, args.dias):
            print(f"  {n:4d}  {endereco:45s}  ex.: {assunto[:60]}")
        print("\nCopie os endereços certos para gmail.remetentes no config.yaml (ou na página Definições)"
              " e corra de novo: python setup_gmail.py")
        return 0

    rel = organizacao.configurar(servico, cfg, arquivar=not args.sem_arquivar)
    print(rel.texto() or "Nada a fazer: tudo já estava configurado.")
    print("\nOs alertas novos vão diretamente para Vagas/* sem passar pela caixa de entrada.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
