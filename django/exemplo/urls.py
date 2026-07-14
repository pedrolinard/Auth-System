from rest_framework.routers import DefaultRouter

from .views import ItemViewSet

router = DefaultRouter(trailing_slash=False)
router.register("itens", ItemViewSet, basename="item")

urlpatterns = router.urls
