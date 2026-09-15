import base64

import pytest
from django.core.cache import cache
from rest_framework.test import APIClient

from comum.autenticacao import UsuarioRemoto
from comum.banco import ler_certificado_ca, opcoes_tls
from comum.limites import MENSAGEM_LIMITE, LimitePorUsuario

pytestmark = pytest.mark.django_db

PEM = "-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----"


@pytest.fixture
def limite_baixo(monkeypatch):
    # A taxa é lida do settings na importação da classe; os testes baixam o
    # limite direto nela pra não precisar de 300 requisições.
    monkeypatch.setattr(LimitePorUsuario, "THROTTLE_RATES", {"usuario": "3/min"})
    cache.clear()
    yield
    cache.clear()


def cliente(usuario_id):
    client = APIClient()
    client.force_authenticate(user=UsuarioRemoto(id=usuario_id, organizacao_id="org-limite"))
    return client


def test_passar_do_limite_responde_429(limite_baixo):
    client = cliente("usuario-limite")
    for _ in range(3):
        assert client.get("/api/dominio/projetos").status_code == 200
    resposta = client.get("/api/dominio/projetos")
    assert resposta.status_code == 429
    assert resposta.data["detail"] == MENSAGEM_LIMITE
    assert "Retry-After" in resposta


def test_o_limite_e_por_usuario(limite_baixo):
    client_a = cliente("usuario-limite-a")
    for _ in range(3):
        client_a.get("/api/dominio/projetos")
    assert client_a.get("/api/dominio/projetos").status_code == 429

    assert cliente("usuario-limite-b").get("/api/dominio/projetos").status_code == 200


def test_saude_publica_nao_e_limitada(limite_baixo):
    client = APIClient()
    for _ in range(5):
        assert client.get("/api/dominio/saude").status_code in (200, 503)


def test_tls_sem_certificado_nao_mexe_na_conexao():
    assert opcoes_tls(None) == {}
    assert opcoes_tls("  ") == {}


def test_tls_com_certificado_verifica_cadeia_e_host(tmp_path):
    opcoes = opcoes_tls(PEM, diretorio=str(tmp_path))
    assert opcoes["sslmode"] == "verify-full"
    with open(opcoes["sslrootcert"], encoding="utf-8") as arquivo:
        assert arquivo.read() == PEM


def test_certificado_em_base64_ou_com_quebra_escapada():
    assert ler_certificado_ca(base64.b64encode(PEM.encode()).decode()) == PEM
    assert ler_certificado_ca(PEM.replace("\n", "\\n")) == PEM
