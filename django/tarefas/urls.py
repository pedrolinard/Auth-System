from django.urls import path
from rest_framework.routers import DefaultRouter

from comum.saude import saude

from .views import ProjetoViewSet, TarefaViewSet
from .views_interno import excluir_dados

router = DefaultRouter(trailing_slash=False)
router.register("projetos", ProjetoViewSet, basename="projeto")
router.register("tarefas", TarefaViewSet, basename="tarefa")

urlpatterns = [
    path("saude", saude, name="saude"),
    path("interno/excluir-dados", excluir_dados, name="excluir-dados"),
    *router.urls,
]
