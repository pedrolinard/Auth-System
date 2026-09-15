from django.urls import path
from rest_framework.routers import DefaultRouter

from comum.saude import saude

from .views import ProjetoViewSet, TarefaViewSet

router = DefaultRouter(trailing_slash=False)
router.register("projetos", ProjetoViewSet, basename="projeto")
router.register("tarefas", TarefaViewSet, basename="tarefa")

urlpatterns = [path("saude", saude, name="saude"), *router.urls]
