from rest_framework import serializers

from .models import Item


class ItemSerializer(serializers.ModelSerializer):
    class Meta:
        model = Item
        fields = ["id", "titulo", "usuario_id", "criado_em"]
        read_only_fields = ["id", "usuario_id", "criado_em"]
