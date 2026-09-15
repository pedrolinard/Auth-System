import base64
import tempfile
from pathlib import Path


def ler_certificado_ca(valor: str) -> str:
    """Aceita o PEM como veio (quebras reais ou `\\n` escapado) ou em base64.

    Mesmo formato que o lado Next.js aceita (src/lib/configBanco.ts), então a
    mesma variável DATABASE_CA_CERT serve pros dois projetos.
    """
    texto = valor.strip()
    if texto.startswith("-----BEGIN"):
        return texto.replace("\\n", "\n")
    return base64.b64decode(texto).decode("utf-8").strip()


def opcoes_tls(certificado_ca: str | None, diretorio: str | None = None) -> dict:
    """Opções do psycopg pra TLS com verificação completa (cadeia e host).

    Sem certificado, devolve {} e vale o que estiver na DATABASE_URL, como
    sempre foi. O psycopg só lê o CA de um arquivo, então o PEM da variável de
    ambiente é gravado no diretório temporário (o único gravável na Vercel).
    """
    if not certificado_ca or not certificado_ca.strip():
        return {}
    caminho = Path(diretorio or tempfile.gettempdir()) / "database-ca.pem"
    caminho.write_text(ler_certificado_ca(certificado_ca), encoding="utf-8")
    return {"sslmode": "verify-full", "sslrootcert": str(caminho)}
