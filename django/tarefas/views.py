from rest_framework.exceptions import PermissionDenied
from rest_framework.permissions import IsAuthenticated
from rest_framework.viewsets import ModelViewSet

from comum.autenticacao import ProtegidoContraCsrf

from .models import Projeto, Tarefa
from .serializers import ProjetoSerializer, TarefaSerializer


def _organizacao_ativa_ou_403(request):
    """Devolve o organizacao_id da sessão, ou levanta PermissionDenied.

    Usado no perform_create dos dois ViewSets abaixo — sem organização
    ativa (token emitido antes do claim organizacaoId existir, ver
    comum/autenticacao.py) não dá pra saber em qual organização gravar o
    registro novo.
    """
    organizacao_id = request.user.organizacao_id
    if not organizacao_id:
        raise PermissionDenied("Sessão sem organização ativa — faça login novamente.")
    return organizacao_id


class ProjetoViewSet(ModelViewSet):
    serializer_class = ProjetoSerializer
    permission_classes = [IsAuthenticated, ProtegidoContraCsrf]

    def get_queryset(self):
        # Sem organizacao_id não há organização pra listar; .none() em vez
        # de filtrar por None — a coluna é nullable (linhas anteriores ao
        # backfill), então filtrar por organizacao_id=None bateria nessas
        # linhas órfãs em vez de simplesmente não devolver nada.
        organizacao_id = self.request.user.organizacao_id
        if not organizacao_id:
            return Projeto.objects.none()
        return Projeto.objects.filter(organizacao_id=organizacao_id)

    def perform_create(self, serializer):
        organizacao_id = _organizacao_ativa_ou_403(self.request)
        serializer.save(organizacao_id=organizacao_id, usuario_id=self.request.user.id)


class TarefaViewSet(ModelViewSet):
    serializer_class = TarefaSerializer
    permission_classes = [IsAuthenticated, ProtegidoContraCsrf]

    def get_queryset(self):
        organizacao_id = self.request.user.organizacao_id
        if not organizacao_id:
            return Tarefa.objects.none()
        queryset = Tarefa.objects.filter(organizacao_id=organizacao_id)
        projeto_id = self.request.query_params.get("projeto")
        if projeto_id:
            queryset = queryset.filter(projeto_id=projeto_id)
        return queryset

    def perform_create(self, serializer):
        organizacao_id = _organizacao_ativa_ou_403(self.request)
        serializer.save(organizacao_id=organizacao_id, usuario_id=self.request.user.id)
