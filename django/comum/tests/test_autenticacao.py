import base64
import hashlib
import hmac
import json
import time

import jwt
import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from django.conf import settings
from django.test import RequestFactory
from rest_framework.exceptions import AuthenticationFailed

from comum.autenticacao import AutenticacaoJWT, ProtegidoContraCsrf

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
    # Preenche iss/exp esperados por padrão (o gateway Next.js sempre os
    # carimba) — cada teste ainda pode sobrescrever pra exercitar o caso ruim.
    corpo = {
        "iss": settings.JWT_ACCESS_ISSUER,
        "exp": int(time.time()) + 900,
        **payload,
    }
    return jwt.encode(corpo, chave_pem, algorithm=algoritmo)


def _requisicao_com_token(token=None):
    factory = RequestFactory()
    if token:
        return factory.get("/", HTTP_AUTHORIZATION=f"Bearer {token}")
    return factory.get("/")


def _requisicao_com_cookie(token):
    request = RequestFactory().get("/")
    request.COOKIES["tokenAcesso"] = token
    return request


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


def test_token_via_cookie_autentica():
    # Desde a migração do access token do Next.js para cookie httpOnly, o
    # navegador não monta mais o header Authorization — o cookie tokenAcesso
    # precisa funcionar sozinho como fallback.
    token = _gerar_token({"sub": "usuario-123", "email": "a@example.com"})
    resultado = AutenticacaoJWT().authenticate(_requisicao_com_cookie(token))

    assert resultado is not None
    usuario, _ = resultado
    assert usuario.id == "usuario-123"


def test_header_tem_prioridade_sobre_cookie():
    token_header = _gerar_token({"sub": "usuario-do-header"})
    token_cookie = _gerar_token({"sub": "usuario-do-cookie"})

    request = _requisicao_com_token(token_header)
    request.COOKIES["tokenAcesso"] = token_cookie

    usuario, _ = AutenticacaoJWT().authenticate(request)
    assert usuario.id == "usuario-do-header"


def test_papel_default_quando_ausente_do_token():
    token = _gerar_token({"sub": "usuario-123"})
    usuario, _ = AutenticacaoJWT().authenticate(_requisicao_com_token(token))
    assert usuario.papel == "usuario"


def test_papel_lido_do_token():
    token = _gerar_token({"sub": "usuario-123", "papel": "admin"})
    usuario, _ = AutenticacaoJWT().authenticate(_requisicao_com_token(token))
    assert usuario.papel == "admin"


def test_organizacao_id_ausente_do_token_fica_none():
    # Token emitido antes do claim organizacaoId existir (ver comentário em
    # options={"require": [...]} de AutenticacaoJWT) — autentica normalmente
    # (não é erro), só sem organização; tarefas/views.py trata None como
    # "sem acesso a nada de organização", não deixa vazar.
    token = _gerar_token({"sub": "usuario-123"})
    usuario, _ = AutenticacaoJWT().authenticate(_requisicao_com_token(token))
    assert usuario.organizacao_id is None
    assert usuario.papel_organizacao is None


def test_organizacao_id_e_papel_organizacao_lidos_do_token():
    token = _gerar_token(
        {"sub": "usuario-123", "organizacaoId": "org-abc", "papelOrganizacao": "dono"}
    )
    usuario, _ = AutenticacaoJWT().authenticate(_requisicao_com_token(token))
    assert usuario.organizacao_id == "org-abc"
    assert usuario.papel_organizacao == "dono"


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


def test_token_com_emissor_errado_rejeitado():
    token = _gerar_token({"sub": "usuario-123", "iss": "outro-produto"})
    with pytest.raises(AuthenticationFailed, match="inválido"):
        AutenticacaoJWT().authenticate(_requisicao_com_token(token))


def test_token_sem_emissor_rejeitado():
    token = jwt.encode(
        {"sub": "usuario-123", "exp": int(time.time()) + 900},
        _CHAVE_PRIVADA_PEM,
        algorithm="RS256",
    )
    with pytest.raises(AuthenticationFailed, match="inválido"):
        AutenticacaoJWT().authenticate(_requisicao_com_token(token))


def test_token_sem_exp_rejeitado():
    token = jwt.encode(
        {"sub": "usuario-123", "iss": settings.JWT_ACCESS_ISSUER},
        _CHAVE_PRIVADA_PEM,
        algorithm="RS256",
    )
    with pytest.raises(AuthenticationFailed, match="inválido"):
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


def _requisicao_csrf(metodo="post", cookie=None, header=None):
    factory = RequestFactory()
    request = getattr(factory, metodo)("/")
    if cookie is not None:
        request.COOKIES["csrfToken"] = cookie
    if header is not None:
        request.META["HTTP_X_CSRF_TOKEN"] = header
    return request


def test_csrf_metodo_seguro_nao_e_checado():
    request = _requisicao_csrf("get", cookie="abc", header="xyz")
    assert ProtegidoContraCsrf().has_permission(request, None) is True


def test_csrf_sem_cookie_pula_a_checagem():
    # Cliente sem navegador (Bearer via curl/testes) — não há sessão por
    # cookie, então não há o que proteger.
    request = _requisicao_csrf("post")
    assert ProtegidoContraCsrf().has_permission(request, None) is True


def test_csrf_token_batendo_libera():
    request = _requisicao_csrf("post", cookie="token-abc", header="token-abc")
    assert ProtegidoContraCsrf().has_permission(request, None) is True


def test_csrf_token_divergente_bloqueia():
    request = _requisicao_csrf("post", cookie="token-abc", header="token-xyz")
    assert ProtegidoContraCsrf().has_permission(request, None) is False


def test_csrf_header_ausente_bloqueia():
    request = _requisicao_csrf("post", cookie="token-abc")
    assert ProtegidoContraCsrf().has_permission(request, None) is False


def test_csrf_header_nao_ascii_bloqueia_sem_erro():
    # compare_digest com str não-ASCII levanta TypeError — precisa virar 403,
    # não 500.
    request = _requisicao_csrf("post", cookie="token-abc", header="töken-abc")
    assert ProtegidoContraCsrf().has_permission(request, None) is False
