import jwt
from django.conf import settings
from django.db import transaction
from django.db.models import Q
from rest_framework.decorators import api_view, authentication_classes, permission_classes, throttle_classes
from rest_framework.permissions import AllowAny
from rest_framework.response import Response

from comum.autenticacao import AUDIENCIA_SERVICO_DOMINIO, AutenticacaoJWT

from .models import Projeto, Tarefa

# Mesmo tamanho de lote do gateway (src/lib/exclusaoDominio.ts), somando as
# duas listas.
MAX_ALVOS = 100


def _payload_servico(request):
    """Valida o token de SERVIÇO do gateway (src/lib/token.ts:
    gerarTokenServicoDominio). Devolve o payload ou None.

    Mesma chave RS256 e emissor do access token, resolvida pelo mesmo JWKS —
    a diferença que importa é a audiência fixa: um access token de usuário
    (aud = id da aplicação) não passa aqui, e AutenticacaoJWT recusa este
    token nas rotas de usuário.
    """
    cabecalho = request.headers.get("Authorization", "")
    if not cabecalho.startswith("Bearer "):
        return None
    token = cabecalho[len("Bearer "):]
    try:
        chave = AutenticacaoJWT()._chave_de_verificacao(token)
        return jwt.decode(
            token,
            chave,
            algorithms=["RS256"],
            issuer=settings.JWT_ACCESS_ISSUER,
            audience=AUDIENCIA_SERVICO_DOMINIO,
            options={"require": ["exp", "iss", "aud"]},
        )
    except Exception:
        return None


def _lista_de_ids(valor):
    if valor is None:
        return []
    if not isinstance(valor, list) or not all(isinstance(i, str) and 0 < len(i) <= 40 for i in valor):
        return None
    return valor


@api_view(["POST"])
@authentication_classes([])
@permission_classes([AllowAny])
@throttle_classes([])
def excluir_dados(request):
    """Apaga projetos e tarefas de organizações e contas excluídas no gateway.

    Chamado pelo gateway quando uma conta é excluída (e de novo pelo job de
    limpeza, se falhou) — sem isso, os dados ficavam órfãos neste schema, que
    não tem FK com o outro serviço (LGPD). Duas listas no token:

    - `organizacoes`: tudo com esse organizacao_id;
    - `usuarios`: os registros LEGADOS da conta (organizacao_id nulo, de antes
      do multi-tenant). Os que já têm organização seguem a organização — um
      projeto que a pessoa criou numa organização que continua existindo é da
      organização, não dela.

    Idempotente: repetir o pedido só não encontra nada pra apagar. O escopo
    vem do TOKEN; o corpo é ignorado, então ninguém amplia um token capturado.
    """
    payload = _payload_servico(request)
    if not payload or payload.get("acao") != "excluir_dados":
        return Response({"detail": "Token de serviço inválido."}, status=401)

    organizacoes = _lista_de_ids(payload.get("organizacoes"))
    usuarios = _lista_de_ids(payload.get("usuarios"))
    if (
        organizacoes is None
        or usuarios is None
        or not (organizacoes or usuarios)
        or len(organizacoes) + len(usuarios) > MAX_ALVOS
    ):
        return Response({"detail": "Listas de exclusão inválidas."}, status=400)

    filtro = Q(organizacao_id__in=organizacoes) | Q(organizacao_id__isnull=True, usuario_id__in=usuarios)
    with transaction.atomic():
        tarefas, _ = Tarefa.objects.filter(filtro).delete()
        projetos, _ = Projeto.objects.filter(filtro).delete()

    return Response({"projetosExcluidos": projetos, "tarefasExcluidas": tarefas})
