#!/usr/bin/env python3
"""Build a source-only release ZIP without credentials or generated data."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED

root = Path(__file__).resolve().parent.parent
output = root / "zzz-PUBLIQ-Source.zip"
files = [
    ".env.example", ".gitignore", ".vercelignore", "README.md",
    "package.json",
    "package-lock.json", "components.json", "next.config.ts",
    "postcss.config.mjs", "tsconfig.json", "vercel.json",
]
directories = ["src", "public", "scripts", "reference", "docs"]
excluded_parts = {"node_modules", ".git", ".cache", ".next", "__pycache__", ".venv"}

with ZipFile(output, "w", compression=ZIP_DEFLATED, compresslevel=9) as archive:
    for relative in files:
        path = root / relative
        if not path.is_file():
            raise SystemExit(f"Missing required release file: {relative}")
        archive.write(path, f"publiq/{relative}")
    for directory in directories:
        for path in sorted((root / directory).rglob("*")):
            relative = path.relative_to(root)
            if (not path.is_file() or path.is_symlink() or
                any(part in excluded_parts for part in relative.parts) or
                path.name.startswith(".env") or path.suffix in {".pyc", ".log"}):
                continue
            archive.write(path, f"publiq/{relative.as_posix()}")
print(f"Created {output.name} ({output.stat().st_size:,} bytes)")
