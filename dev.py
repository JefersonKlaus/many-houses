#!/usr/bin/env python3
"""Development tasks, the same on Windows, macOS and Linux. Needs Python 3.12+ and Node 22 (the site, web/, is
React + TypeScript and is built with Vite). Python tools go inside .venv/, Node packages inside web/node_modules/.

    python dev.py setup     create .venv with the test tools, download Chromium and install the site's packages
    python dev.py serve     build the site, then the site + in-memory API at http://127.0.0.1:8765, no login,
                            with demo data (--port, --empty). For hot reload while editing the site, keep this
                            running and use `npm run dev` in web/.
    python dev.py test      backend tests, the site's type-check and build
    python dev.py e2e       build the site, then the browser test (a real Chromium)
    python dev.py all       test + e2e: what CI runs, except Terraform
"""
from __future__ import annotations

import argparse
import os
import shutil
import subprocess
import sys
import venv
from pathlib import Path

ROOT = Path(__file__).resolve().parent
VENV = ROOT / ".venv"
VENV_PYTHON = VENV / ("Scripts/python.exe" if os.name == "nt" else "bin/python")
NODE_HINT = "Node 22 is needed to build the site (web/): https://nodejs.org."


def python() -> str:
    """The .venv's Python when it exists (after `setup`), otherwise the one running this script."""
    return str(VENV_PYTHON) if VENV_PYTHON.exists() else sys.executable


def run(*command: str) -> int:
    print("\n$", " ".join(str(c) for c in command), flush=True)
    return subprocess.call([str(c) for c in command], cwd=ROOT)


def npm() -> str | None:
    return shutil.which("npm")


def build_site() -> int:
    """The site's packages (once) and its production build into web/dist/, which the local server serves."""
    tool = npm()
    if not tool:
        print(NODE_HINT)
        return 1
    if not (ROOT / "web" / "node_modules").is_dir() and run(tool, "ci", "--prefix", "web"):
        return 1
    return run(tool, "run", "build", "--prefix", "web")


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
    tool = npm()
    if not tool:
        print(f"\nWARNING: {NODE_HINT}")
    elif run(tool, "ci", "--prefix", "web"):
        return 1
    print("\nReady. Try:  python dev.py serve   (then open http://127.0.0.1:8765)   or   python dev.py test")
    return 0


def serve(args: argparse.Namespace) -> int:
    if build_site():
        return 1
    try:
        return run(python(), "local/server.py", "--port", str(args.port), *(["--empty"] if args.empty else []))
    except KeyboardInterrupt:
        return 0


def test(_: argparse.Namespace) -> int:
    results = {"backend tests": run(python(), "-m", "pytest", "-q", "local/tests"),
               "site types + build" if npm() else "site types + build (no Node)": build_site() if npm() else None}
    print("\n" + "\n".join(f"  {'ok     ' if code == 0 else 'SKIPPED' if code is None else 'FAILED '} {name}"
                           for name, code in results.items()))
    if None in results.values():
        print(f"  {NODE_HINT}")
    return 1 if any(results.values()) else 0


def e2e(_: argparse.Namespace) -> int:
    return build_site() or run(python(), "local/e2e.py")


def all_checks(args: argparse.Namespace) -> int:
    return test(args) or run(python(), "local/e2e.py")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    commands = parser.add_subparsers(dest="command", required=True)
    setup_parser = commands.add_parser("setup", help="create .venv, install the tools, Chromium and the site's packages")
    setup_parser.add_argument("--with-deps", action="store_true",
                              help="also install Chromium's system libraries (Linux; uses sudo/apt)")
    serve_parser = commands.add_parser("serve", help="build the site, then the site + in-memory API, no login")
    serve_parser.add_argument("--port", type=int, default=8765)
    serve_parser.add_argument("--empty", action="store_true", help="start with no data (default: demo data)")
    commands.add_parser("test", help="backend tests, site type-check and build")
    commands.add_parser("e2e", help="build the site, then the browser test")
    commands.add_parser("all", help="test + e2e")
    args = parser.parse_args()
    handlers = {"setup": setup, "serve": serve, "test": test, "e2e": e2e, "all": all_checks}
    return handlers[args.command](args)


if __name__ == "__main__":
    sys.exit(main())
