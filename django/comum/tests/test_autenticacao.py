import base64
import hashlib
import hmac
import json
import time

import jwt
import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from django.test import RequestFactory
from rest_framework.exceptions import AuthenticationFailed

from comum.autenticacao import AutenticacaoJWT

# Par de chaves RSA descartável, gerado só para os testes — isola os cenários
# da chave real do Next.js (que só existe no .env, não deve ser usada aqui).
_CHAVE_PRIVADA = rsa.generate_private_key(public_exponent=65537, key_size=2048)
_CHAVE_PRIVADA_PEM = _CHAVE_PRIVADA.private_bytes(
    encoding=serialization.Encoding.PEM,
    format=serialization.PrivateFormat.PKCS8,
    encryption_algorithm=serialization.NoEncryption(),
)
_CHAVE_PUBLICA_PEM = _CHAVE_PRIVADA.public_key().public_bytes(
    encoding=serialization.Encoding.PEM,
    format=serialization.PublicFormat.SubjectPublicKeyInfo,
)


@pytest.fixture(autouse=True)
def usar_chave_de_teste(settings):
    settings.JWT_ACCESS_PUBLIC_KEY = _CHAVE_PUBLICA_PEM.decode("utf-8")


def _gerar_token(payload, chave_pem=_CHAVE_PRIVADA_PEM, algoritmo="RS256"):
    return jwt.encode(payload, chave_pem, algorithm=algoritmo)


def _requisicao_com_token(token=None):
    factory = RequestFactory()
    if token:
        return factory.get("/", HTTP_AUTHORIZATION=f"Bearer {token}")
    return factory.get("/")


def test_token_valido_autentica_com_id_correto():
    token = _gerar_token({"sub": "usuario-123", "email": "a@example.com"})
    resultado = AutenticacaoJWT().authenticate(_requisicao_com_token(token))

    assert resultado is not None
    usuario, _ = resultado
    assert usuario.id == "usuario-123"
    assert usuario.is_authenticated is True


def test_sem_header_retorna_none():
    resultado = AutenticacaoJWT().authenticate(_requisicao_com_token())
    assert resultado is None


def test_token_expirado_rejeitado():
    token = _gerar_token({"sub": "usuario-123", "exp": int(time.time()) - 60})
    with pytest.raises(AuthenticationFailed, match="expirado"):
        AutenticacaoJWT().authenticate(_requisicao_com_token(token))


def test_assinatura_invalida_rejeitada():
    token = _gerar_token({"sub": "usuario-123"})
    token_adulterado = token[:-4] + ("A" if token[-4] != "A" else "B") + token[-3:]
    with pytest.raises(AuthenticationFailed, match="inválido"):
        AutenticacaoJWT().authenticate(_requisicao_com_token(token_adulterado))


def test_token_sem_sub_rejeitado():
    token = _gerar_token({"email": "a@example.com"})
    with pytest.raises(AuthenticationFailed, match="sub"):
        AutenticacaoJWT().authenticate(_requisicao_com_token(token))


def _base64url(dados: bytes) -> str:
    return base64.urlsafe_b64encode(dados).rstrip(b"=").decode("ascii")


def test_confusao_de_algoritmo_hs256_rejeitada():
    # Simula o ataque clássico de confusão de algoritmo: assina manualmente
    # (via hmac, não via jwt.encode — o PyJWT recusa usar uma chave em
    # formato PEM como segredo HMAC, então isso testaria a proteção do PyJWT
    # do lado de quem forja, não a do servidor) um token HS256 usando a
    # chave PÚBLICA RS256 como se fosse um segredo simétrico. Como
    # AutenticacaoJWT fixa algorithms=["RS256"], o servidor deve rejeitar
    # mesmo que a assinatura HMAC "bata" com a chave pública.
    cabecalho = _base64url(json.dumps({"alg": "HS256", "typ": "JWT"}).encode())
    corpo = _base64url(json.dumps({"sub": "usuario-123"}).encode())
    assinatura = hmac.new(
        _CHAVE_PUBLICA_PEM, f"{cabecalho}.{corpo}".encode(), hashlib.sha256
    ).digest()
    token_forjado = f"{cabecalho}.{corpo}.{_base64url(assinatura)}"

    with pytest.raises(AuthenticationFailed, match="inválido"):
        AutenticacaoJWT().authenticate(_requisicao_com_token(token_forjado))
