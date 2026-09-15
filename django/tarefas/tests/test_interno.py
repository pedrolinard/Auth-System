import time

import jwt
import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from django.conf import settings
from rest_framework.test import APIClient

from comum.autenticacao import AUDIENCIA_SERVICO_DOMINIO
from tarefas.models import Projeto, Tarefa

pytestmark = pytest.mark.django_db

_CHAVE = rsa.generate_private_key(public_exponent=65537, key_size=2048)
_PRIVADA_PEM = _CHAVE.private_bytes(
    serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()
)
_PUBLICA_PEM = _CHAVE.public_key().public_bytes(
    serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo
).decode()

URL = "/api/dominio/interno/excluir-organizacoes"


@pytest.fixture(autouse=True)
def chave_de_teste(settings):
    settings.JWT_ACCESS_PUBLIC_KEY = _PUBLICA_PEM
    settings.JWT_JWKS_URL = ""


def _token(**sobrescrever):
    corpo = {
        "iss": settings.JWT_ACCESS_ISSUER,
        "aud": AUDIENCIA_SERVICO_DOMINIO,
        "sub": "servico:auth-gateway",
        "exp": int(time.time()) + 120,
        "acao": "excluir_organizacoes",
        "organizacoes": ["org-apagada"],
        **sobrescrever,
    }
    return jwt.encode(corpo, _PRIVADA_PEM, algorithm="RS256")


def _dados():
    apagado = Projeto.objects.create(nome="Some", organizacao_id="org-apagada", usuario_id="u1")
    Tarefa.objects.create(titulo="Some também", projeto=apagado, organizacao_id="org-apagada", usuario_id="u1")
    fica = Projeto.objects.create(nome="Fica", organizacao_id="org-viva", usuario_id="u2")
    Tarefa.objects.create(titulo="Fica também", projeto=fica, organizacao_id="org-viva", usuario_id="u2")


def _post(token):
    return APIClient().post(URL, {}, format="json", HTTP_AUTHORIZATION=f"Bearer {token}")


def test_apaga_so_as_organizacoes_do_token():
    _dados()
    resposta = _post(_token())

    assert resposta.status_code == 200
    assert resposta.data == {"projetosExcluidos": 1, "tarefasExcluidas": 1}
    assert list(Projeto.objects.values_list("organizacao_id", flat=True)) == ["org-viva"]
    assert list(Tarefa.objects.values_list("organizacao_id", flat=True)) == ["org-viva"]


def test_repetir_o_pedido_nao_da_erro():
    _dados()
    assert _post(_token()).status_code == 200
    segunda = _post(_token())
    assert segunda.status_code == 200
    assert segunda.data == {"projetosExcluidos": 0, "tarefasExcluidas": 0}


def test_organizacoes_do_corpo_sao_ignoradas():
    _dados()
    resposta = APIClient().post(
        URL, {"organizacoes": ["org-viva"]}, format="json", HTTP_AUTHORIZATION=f"Bearer {_token()}"
    )
    assert resposta.status_code == 200
    assert Projeto.objects.filter(organizacao_id="org-viva").exists()


@pytest.mark.parametrize(
    "sobrescrever",
    [
        {"aud": "cm-id-de-aplicacao"},  # access token de usuário
        {"acao": "outra_coisa"},
        {"exp": int(time.time()) - 10},
        {"iss": "outro-emissor"},
    ],
)
def test_recusa_token_que_nao_e_o_de_servico(sobrescrever):
    _dados()
    assert _post(_token(**sobrescrever)).status_code == 401
    assert Projeto.objects.count() == 2


def test_recusa_sem_token_e_lista_invalida():
    assert APIClient().post(URL, {}, format="json").status_code == 401
    assert _post(_token(organizacoes=[])).status_code == 400
    assert _post(_token(organizacoes=["x" * 41])).status_code == 400
    assert _post(_token(organizacoes=[f"o{i}" for i in range(101)])).status_code == 400


def test_token_de_servico_nao_autentica_nas_rotas_de_usuario():
    resposta = APIClient().get("/api/dominio/projetos", HTTP_AUTHORIZATION=f"Bearer {_token()}")
    assert resposta.status_code == 401
