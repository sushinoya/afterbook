"""Kobo device discovery."""

from __future__ import annotations

import sys
from collections.abc import Iterable, Iterator
from contextlib import contextmanager
from dataclasses import dataclass
from pathlib import Path
from tempfile import TemporaryDirectory

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


def macos_mounts(volumes_root: Path | None = None) -> list[Path]:
    """Return mounted volumes on macOS."""
    root = volumes_root or Path("/Volumes")
    if not root.is_dir():
        return []
    return [path for path in root.iterdir() if path.is_dir()]


def linux_mounts(
    home: Path | None = None,
    media_root: Path | None = None,
    run_media_root: Path | None = None,
) -> list[Path]:
    """Return common removable-media mounts on Linux."""
    user_home = home or Path.home()
    media = media_root or Path("/media")
    run_media = run_media_root or Path("/run/media")
    user = user_home.name
    roots = (media / user, run_media / user)
    mounts: list[Path] = []
    for root in roots:
        if root.is_dir():
            mounts.extend(path for path in root.iterdir() if path.is_dir())
    return mounts


def windows_mounts(candidates: Iterable[Path] | None = None) -> list[Path]:
    """Return mounted drive roots on Windows."""
    drive_roots = candidates or (
        Path(f"{letter}:\\") for letter in "ABCDEFGHIJKLMNOPQRSTUVWXYZ"
    )
    return [path for path in drive_roots if path.is_dir()]


def platform_mounts(platform_name: str | None = None) -> list[Path]:
    """Return likely removable-media mounts for the current platform."""
    current_platform = platform_name or sys.platform
    if current_platform == "darwin":
        return macos_mounts()
    if current_platform.startswith("linux"):
        return linux_mounts()
    if current_platform == "win32":
        return windows_mounts()
    return []


def discover_kobos(
    search_root: Path | None = None,
    platform_name: str | None = None,
) -> list[KoboDevice]:
    """Find connected Kobo devices."""
    if search_root is not None:
        mounts = [path for path in search_root.iterdir() if path.is_dir()]
    else:
        mounts = platform_mounts(platform_name)
    return [KoboDevice(path) for path in mounts if is_kobo_root(path)]


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


def local_output_directory(output_directory: Path, device_root: Path) -> Path:
    """Resolve an output directory and reject paths on the Kobo device."""
    resolved_output = output_directory.expanduser().resolve()
    resolved_device = device_root.resolve()
    if resolved_output == resolved_device or resolved_output.is_relative_to(resolved_device):
        raise KoboKeepsError("Output directory cannot be on the Kobo eReader")
    return resolved_output


def copy_binary_file(source: Path, destination: Path) -> None:
    """Copy a file without changing source metadata or opening it for writing."""
    with source.open("rb") as source_file, destination.open("xb") as destination_file:
        while chunk := source_file.read(1024 * 1024):
            destination_file.write(chunk)


@contextmanager
def database_snapshot(database_path: Path) -> Iterator[Path]:
    """Copy a Kobo database to local temporary storage before SQLite opens it."""
    with TemporaryDirectory(prefix="kobokeeps-") as temporary_directory:
        snapshot_root = Path(temporary_directory)
        snapshot_database = snapshot_root / database_path.name
        copy_binary_file(database_path, snapshot_database)

        for suffix in ("-wal", "-shm"):
            source_sidecar = Path(f"{database_path}{suffix}")
            if source_sidecar.is_file():
                copy_binary_file(source_sidecar, snapshot_root / source_sidecar.name)

        yield snapshot_database
