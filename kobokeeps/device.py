"""Kobo device discovery."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from kobokeeps.errors import KoboKeepsError

DATABASE_RELATIVE_PATH = Path(".kobo") / "KoboReader.sqlite"


@dataclass(frozen=True, slots=True)
class KoboDevice:
    """A mounted Kobo eReader."""

    root: Path

    @property
    def database_path(self) -> Path:
        return self.root / DATABASE_RELATIVE_PATH


def is_kobo_root(path: Path) -> bool:
    """Return whether a mounted path looks like a Kobo eReader."""
    return (path / DATABASE_RELATIVE_PATH).is_file()


def macos_mounts(volumes_root: Path = Path("/Volumes")) -> list[Path]:
    """Return mounted volumes on macOS."""
    if not volumes_root.is_dir():
        return []
    return [path for path in volumes_root.iterdir() if path.is_dir()]


def discover_kobos(volumes_root: Path = Path("/Volumes")) -> list[KoboDevice]:
    """Find connected Kobo devices on macOS."""
    return [KoboDevice(path) for path in macos_mounts(volumes_root) if is_kobo_root(path)]


def select_device(device_path: Path | None = None) -> KoboDevice:
    """Resolve an explicit device path or the only connected Kobo."""
    if device_path is not None:
        root = device_path.expanduser().resolve()
        if not is_kobo_root(root):
            raise KoboKeepsError(f"No Kobo database found at {root}")
        return KoboDevice(root)

    devices = discover_kobos()
    if not devices:
        raise KoboKeepsError("No connected Kobo eReader found")
    if len(devices) > 1:
        raise KoboKeepsError("Multiple Kobo eReaders found. Use --device to choose one")
    return devices[0]
