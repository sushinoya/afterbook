from __future__ import annotations

import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
WEB_ROOT = Path(__file__).resolve().parents[1]
PACKAGE_ROOT = ROOT / "afterbook"
OUTPUT = WEB_ROOT / "python" / "afterbook.zip"


def main() -> int:
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(OUTPUT, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        for path in sorted(PACKAGE_ROOT.rglob("*.py")):
            archive.write(path, path.relative_to(ROOT))
    print(OUTPUT)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
