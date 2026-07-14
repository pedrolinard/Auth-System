from rest_framework.routers import DefaultRouter

from .views import ProjetoViewSet, TarefaViewSet

router = DefaultRouter(trailing_slash=False)
router.register("projetos", ProjetoViewSet, basename="projeto")
router.register("tarefas", TarefaViewSet, basename="tarefa")

urlpatterns = router.urls
