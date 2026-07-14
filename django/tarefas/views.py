from rest_framework.permissions import IsAuthenticated
from rest_framework.viewsets import ModelViewSet

from comum.autenticacao import ProtegidoContraCsrf

from .models import Projeto, Tarefa
from .serializers import ProjetoSerializer, TarefaSerializer


class ProjetoViewSet(ModelViewSet):
    serializer_class = ProjetoSerializer
    permission_classes = [IsAuthenticated, ProtegidoContraCsrf]

    def get_queryset(self):
        return Projeto.objects.filter(usuario_id=self.request.user.id)

    def perform_create(self, serializer):
        serializer.save(usuario_id=self.request.user.id)


class TarefaViewSet(ModelViewSet):
    serializer_class = TarefaSerializer
    permission_classes = [IsAuthenticated, ProtegidoContraCsrf]

    def get_queryset(self):
        queryset = Tarefa.objects.filter(usuario_id=self.request.user.id)
        projeto_id = self.request.query_params.get("projeto")
        if projeto_id:
            queryset = queryset.filter(projeto_id=projeto_id)
        return queryset

    def perform_create(self, serializer):
        serializer.save(usuario_id=self.request.user.id)
