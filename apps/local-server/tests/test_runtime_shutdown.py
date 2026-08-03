from fastapi.testclient import TestClient

import app.main as main

BACKEND_GENERATION = main.BACKEND_GENERATION
app = main.app


def test_runtime_shutdown_requires_the_session_token():
    client = TestClient(app)
    assert client.post('/runtime/shutdown', json={'generation': BACKEND_GENERATION}).status_code == 401
    assert client.post('/runtime/shutdown', json={'generation': BACKEND_GENERATION}, headers={'Authorization': 'Bearer wrong'}).status_code == 401


def test_runtime_shutdown_accepts_only_its_own_generation():
    called = []
    app.state.shutdown_callback = lambda: called.append(True)
    client = TestClient(app)
    mismatch = client.post('/runtime/shutdown', json={'generation': BACKEND_GENERATION + 1}, headers={'Authorization': f'Bearer {main.TOKEN}'})
    assert mismatch.status_code == 409
    response = client.post('/runtime/shutdown', json={'generation': BACKEND_GENERATION}, headers={'Authorization': f'Bearer {main.TOKEN}'})
    assert response.json() == {'accepted': True, 'generation': BACKEND_GENERATION}
    assert called == [True]
