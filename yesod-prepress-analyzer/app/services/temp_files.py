from __future__ import annotations

import os
import tempfile
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path


@contextmanager
def job_workspace(analysis_id: str, root: str | None = None) -> Iterator[Path]:
    safe_id = "".join(
        character for character in analysis_id if character.isalnum() or character in "-_"
    )[:64]
    with tempfile.TemporaryDirectory(prefix=f"yesod-{safe_id or 'job'}-", dir=root) as directory:
        path = Path(directory)
        os.chmod(path, 0o700)
        yield path
