from rest_framework.exceptions import PermissionDenied
from rest_framework.permissions import IsAuthenticated
from rest_framework.viewsets import ModelViewSet

from comum.autenticacao import ProtegidoContraCsrf

from .models import Projeto, Tarefa
from .serializers import ProjetoSerializer, TarefaSerializer


class ProjetoViewSet(ModelViewSet):
    serializer_class = ProjetoSerializer
    permission_classes = [IsAuthenticated, ProtegidoContraCsrf]

    def get_queryset(self):
        # Sem organizacao_id (token emitido antes do claim existir — ver
        # comum/autenticacao.py) não há organização pra listar; .none() em
        # vez de filtrar por None evita depender de como o ORM trata IS NULL
        # numa coluna NOT NULL.
        organizacao_id = self.request.user.organizacao_id
        if not organizacao_id:
            return Projeto.objects.none()
        return Projeto.objects.filter(organizacao_id=organizacao_id)

    def perform_create(self, serializer):
        organizacao_id = self.request.user.organizacao_id
        if not organizacao_id:
            raise PermissionDenied(
                "Sessão sem organização ativa — faça login novamente."
            )
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
        organizacao_id = self.request.user.organizacao_id
        if not organizacao_id:
            raise PermissionDenied(
                "Sessão sem organização ativa — faça login novamente."
            )
        serializer.save(organizacao_id=organizacao_id, usuario_id=self.request.user.id)
