import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.modelos import BuildItem
from app.store import get_store, novo_store


@pytest.fixture
def store():
    return novo_store()


@pytest.fixture
def client(store):
    app.dependency_overrides[get_store] = lambda: store
    yield TestClient(app)
    app.dependency_overrides.clear()


def itens(*ids, **flags):
    return [BuildItem(componente_id=i, **flags) for i in ids]


BASE_OK = ["r5-7600", "mb-b650m-a", "ram-fury-d5-32", "ssd-nv3-1t", "psu-a750gl", "case-lancool-216", "rtx-4060-8g"]
