from app.core.config import Settings


def test_host_allowlists_accept_comma_separated_env(monkeypatch):
    monkeypatch.setenv("ALLOWED_DOWNLOAD_HOSTS", "abc.supabase.co")
    monkeypatch.setenv("ALLOWED_CALLBACK_HOSTS", "abc.supabase.co, Other.Example.com")
    settings = Settings(_env_file=None)
    assert settings.allowed_download_hosts == ["abc.supabase.co"]
    assert settings.allowed_callback_hosts == ["abc.supabase.co", "other.example.com"]
