from app.api import health


class HealthyRedis:
    def ping(self):
        return True


def test_readiness_checks_all_required_dependencies(monkeypatch):
    monkeypatch.setattr(health.shutil, "which", lambda executable: f"/usr/bin/{executable}")
    monkeypatch.setattr(health, "_module_available", lambda _: True)
    monkeypatch.setattr(health, "_icc_available", lambda: True)
    monkeypatch.setattr(health.Redis, "from_url", lambda _: HealthyRedis())

    assert health.readiness_checks() == {
        "valkey": True,
        "qpdf": True,
        "pikepdf": True,
        "pypdfium2": True,
        "icc": True,
    }


def test_readiness_marks_failed_dependency_without_exposing_versions(monkeypatch):
    monkeypatch.setattr(health.shutil, "which", lambda _: None)
    monkeypatch.setattr(health, "_module_available", lambda module: module == "pikepdf")
    monkeypatch.setattr(health, "_icc_available", lambda: False)
    monkeypatch.setattr(health.Redis, "from_url", lambda _: HealthyRedis())

    checks = health.readiness_checks()
    assert checks["qpdf"] is False
    assert checks["pikepdf"] is True
    assert checks["pypdfium2"] is False
    assert checks["icc"] is False
    assert all(isinstance(value, bool) for value in checks.values())
