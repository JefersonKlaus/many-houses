#!/usr/bin/env python3
"""Development tasks, the same on Windows, macOS and Linux. Needs Python 3.12+ (and Node 22 for the
JS syntax check). Everything is installed inside .venv/, nothing globally.

    python dev.py setup     create .venv with the test tools and download Chromium for the browser test
    python dev.py serve     the site + in-memory API at http://127.0.0.1:8765, no login, with demo data (--port, --empty)
    python dev.py test      backend tests and the JS syntax check (quick)
    python dev.py e2e       the browser test (a real Chromium)
    python dev.py all       test + e2e: what CI runs, except Terraform
"""
from __future__ import annotations

import argparse
import os
import shutil
import subprocess
import sys
import tempfile
import venv
from pathlib import Path

ROOT = Path(__file__).resolve().parent
VENV = ROOT / ".venv"
VENV_PYTHON = VENV / ("Scripts/python.exe" if os.name == "nt" else "bin/python")
NODE_HINT = "Node 22 is needed for the JS syntax check: https://nodejs.org."


def python() -> str:
    """The .venv's Python when it exists (after `setup`), otherwise the one running this script."""
    return str(VENV_PYTHON) if VENV_PYTHON.exists() else sys.executable


def run(*command: str) -> int:
    print("\n$", " ".join(str(c) for c in command), flush=True)
    return subprocess.call([str(c) for c in command], cwd=ROOT)


def setup(args: argparse.Namespace) -> int:
    if sys.version_info < (3, 12):
        sys.exit(f"Python 3.12 or newer is needed (this is {sys.version.split()[0]}).")
    if not VENV_PYTHON.exists():
        print(f"Creating {VENV.name}/ ...")
        venv.create(VENV, with_pip=True)
    install = [python(), "-m", "playwright", "install", *(["--with-deps"] if args.with_deps else []), "chromium"]
    code = run(python(), "-m", "pip", "install", "--upgrade", "-r", "requirements-dev.txt") or run(*install)
    if code:
        return code
    if not shutil.which("node"):
        print(f"\nWARNING: {NODE_HINT}")
    print("\nReady. Try:  python dev.py serve   (then open http://127.0.0.1:8765)   or   python dev.py test")
    return 0


def serve(args: argparse.Namespace) -> int:
    try:
        return run(python(), "local/server.py", "--port", str(args.port), *(["--empty"] if args.empty else []))
    except KeyboardInterrupt:
        return 0


def test(_: argparse.Namespace) -> int:
    results = {"backend tests": run(python(), "-m", "pytest", "-q", "local/tests")}
    node = shutil.which("node")
    results["JS syntax" if node else "JS syntax (no Node)"] = _check_js_syntax(node) if node else None
    print("\n" + "\n".join(f"  {'ok     ' if code == 0 else 'SKIPPED' if code is None else 'FAILED '} {name}"
                           for name, code in results.items()))
    if None in results.values():
        print(f"  {NODE_HINT}")
    return 1 if any(results.values()) else 0


def _check_js_syntax(node: str) -> int:
    """`node --check` on each module (copied as .mjs, since the files use `import`/`export`), like CI."""
    print("\n$ node --check frontend/js/**/*.js", flush=True)
    failed = 0
    with tempfile.TemporaryDirectory() as tmp:
        for file in sorted((ROOT / "frontend/js").rglob("*.js")):
            copy = Path(tmp) / (file.relative_to(ROOT).as_posix().replace("/", "_") + ".mjs")
            shutil.copyfile(file, copy)
            if subprocess.call([node, "--check", str(copy)]):
                print(f"  syntax error in {file.relative_to(ROOT)}")
                failed = 1
    return failed


def e2e(_: argparse.Namespace) -> int:
    return run(python(), "local/e2e.py")


def all_checks(args: argparse.Namespace) -> int:
    return test(args) or e2e(args)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    commands = parser.add_subparsers(dest="command", required=True)
    setup_parser = commands.add_parser("setup", help="create .venv and install the tools and Chromium")
    setup_parser.add_argument("--with-deps", action="store_true",
                              help="also install Chromium's system libraries (Linux; uses sudo/apt)")
    serve_parser = commands.add_parser("serve", help="the site + in-memory API, no login")
    serve_parser.add_argument("--port", type=int, default=8765)
    serve_parser.add_argument("--empty", action="store_true", help="start with no data (default: demo data)")
    commands.add_parser("test", help="backend tests and JS syntax")
    commands.add_parser("e2e", help="the browser test")
    commands.add_parser("all", help="test + e2e")
    args = parser.parse_args()
    handlers = {"setup": setup, "serve": serve, "test": test, "e2e": e2e, "all": all_checks}
    return handlers[args.command](args)


if __name__ == "__main__":
    sys.exit(main())
