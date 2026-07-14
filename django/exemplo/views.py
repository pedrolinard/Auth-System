from rest_framework.permissions import IsAuthenticated
from rest_framework.viewsets import ModelViewSet

from .models import Item
from .serializers import ItemSerializer


class ItemViewSet(ModelViewSet):
    serializer_class = ItemSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        return Item.objects.filter(usuario_id=self.request.user.id)

    def perform_create(self, serializer):
        serializer.save(usuario_id=self.request.user.id)
