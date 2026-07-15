"""
URL configuration for config project.

The `urlpatterns` list routes URLs to views. For more information please see:
    https://docs.djangoproject.com/en/5.2/topics/http/urls/
Examples:
Function views
    1. Add an import:  from my_app import views
    2. Add a URL to urlpatterns:  path('', views.home, name='home')
Class-based views
    1. Add an import:  from other_app.views import Home
    2. Add a URL to urlpatterns:  path('', Home.as_view(), name='home')
Including another URLconf
    1. Import the include() function: from django.urls import include, path
    2. Add a URL to urlpatterns:  path('blog/', include('blog.urls'))
"""
from django.urls import include, path

# django.contrib.admin fica instalado (é dependência de contenttypes/auth,
# usados internamente por outras partes do Django) mas a rota /admin/ não é
# registrada de propósito: este serviço não tem model de Usuario próprio nem
# fluxo de login do Django — expor o painel de admin seria só superfície de
# ataque sem função real (ninguém consegue logar nele, já que não existe
# superusuário nem processo pra criar um).
urlpatterns = [
    path('api/dominio/', include('tarefas.urls')),
]
