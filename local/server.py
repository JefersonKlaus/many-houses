"""Local server to try the frontend without AWS: serves the site and the API (the SAME code as the
Lambdas, one per action, routed like API Gateway) with an in-memory database, and NO login (no Cognito):
every request is the same user.

    python local/server.py [--port 8765] [--empty]

It starts with demo data (local/seed.py): a few houses with their renovation costs. `--empty` starts
with nothing registered.

Data lives in memory and is lost when the server stops. It only listens on 127.0.0.1: never expose
it, since it has no authentication. The deployed app is not affected: there, API Gateway still
requires a valid Cognito token for every request.

`start(require_login=True)` is used by local/e2e.py to test the login screen: the site then logs in
through Cognito (which the test simulates) and the server accepts the simulated tokens: "token-<user>",
and when <user> is "u" + DDD + number ("u11987654321"), that is the login's phone (to test invites),
optionally followed by "-" and the login's name ("u11987654321-Ana Lima")."""
import argparse
import email.parser
import email.policy
import os
import re
import sys
from datetime import date
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlparse

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(Path(__file__).resolve().parent))

from api_gateway import dispatch                    # noqa: E402  (also puts the backend on the path)
from houses_core.ports import Dependencies          # noqa: E402
from memory_photos import UPLOAD_URL, MemoryPhotos  # noqa: E402
from memory_repository import MemoryRepository     # noqa: E402
from seed import seed as load_demo_data             # noqa: E402

MAX_PHOTO_BYTES = 8 * 1024 * 1024                   # like S3's form (s3_photos.MAX_BYTES)
LOCAL_OWNER = "local-user"                          # the user every request belongs to without login
LOCAL_PHONE = "+5511999990000"                      # and their phone (the demo data has invites to it)
LOCAL_NAME = "Carlos Lima"                          # and their name
# Same as CloudFront's (infra/frontend.tf): if the site breaks with it, the test catches it before deploy.
CSP = ("default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; "
       "connect-src 'self' https://cognito-idp.sa-east-1.amazonaws.com; frame-ancestors 'none'; "
       "base-uri 'none'; form-action 'self'")
CONTENT_TYPES = {".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".svg": "image/svg+xml"}


class RequestHandler(BaseHTTPRequestHandler):
    def _claims(self):
        """Plays the part of API Gateway's JWT authorizer: decides which user the request is from, and
        their phone (Cognito's ID token has it: the login is the phone)."""
        if not self.server.require_login:
            return {"sub": LOCAL_OWNER, "phone_number": LOCAL_PHONE, "name": LOCAL_NAME}
        authorization = self.headers.get("Authorization", "")
        if not authorization.startswith("Bearer token-"):
            return None
        user = authorization[len("Bearer token-"):]
        login = re.fullmatch(r"u(\d{10,11})(?:-([A-Za-z ]+))?", user)
        if not login:
            return {"sub": user}
        return {"sub": f"u{login[1]}", "phone_number": f"+55{login[1]}", **({"name": login[2]} if login[2] else {})}

    def _api(self):
        url = urlparse(self.path)
        event = {"rawPath": url.path[len("/api"):], "requestContext": {"http": {"method": self.command}},
                 "queryStringParameters": {k: v[0] for k, v in parse_qs(url.query).items()} or None,
                 "body": self.rfile.read(int(self.headers.get("Content-Length") or 0)).decode()}
        claims = self._claims()
        if claims:
            event["requestContext"]["authorizer"] = {"jwt": {"claims": claims}}
        response = dispatch(event, self.server.deps)
        body = response["body"].encode()
        self.send_response(response["statusCode"])
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _config(self):
        api_url = f"http://{self.headers['Host']}/api"
        if self.server.require_login:
            return f'export const CONFIG = {{region:"sa-east-1",clientId:"local",apiUrl:"{api_url}"}};'
        return f'export const CONFIG = {{region:"",clientId:"",apiUrl:"{api_url}",skipLogin:true}};'

    def _static(self):
        path = urlparse(self.path).path.lstrip("/") or "index.html"
        file = (ROOT / "frontend" / path).resolve()
        if path == "js/config.js":
            body = self._config().encode()
        elif (ROOT / "frontend").resolve() in file.parents and file.is_file():
            body = file.read_bytes()
        else:
            self.send_error(404)
            return
        self.send_response(200)
        self.send_header("Content-Type", CONTENT_TYPES.get(file.suffix, "text/plain") + "; charset=utf-8")
        self.send_header("Content-Security-Policy", CSP)
        self.send_header("Cache-Control", "no-store")       # edits to the frontend show up on reload
        self.end_headers()
        self.wfile.write(body)

    def _upload_photo(self):
        """Plays S3 receiving a photo: the form the API signed (its key) and the file, as multipart."""
        length = int(self.headers.get("Content-Length") or 0)
        if not 0 < length <= MAX_PHOTO_BYTES:
            return self.send_error(400)
        message = email.parser.BytesParser(policy=email.policy.HTTP).parsebytes(
            f"Content-Type: {self.headers.get('Content-Type', '')}\r\n\r\n".encode() + self.rfile.read(length))
        parts = {part.get_param("name", header="content-disposition"): part for part in message.iter_parts()}
        key = parts["key"].get_content().strip() if "key" in parts else ""
        if not key or "file" not in parts or ".." in key:
            return self.send_error(400)
        self.server.deps.photos.put(key, parts["file"].get_content_type(), parts["file"].get_payload(decode=True))
        self.send_response(204)
        self.end_headers()

    def _photo(self):
        found = self.server.deps.photos.files.get(unquote(urlparse(self.path).path[len("/local-photos/"):]))
        if not found:
            return self.send_error(404)
        content_type, body = found
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path.startswith("/local-photos/"):
            return self._photo()
        self._api() if self.path.startswith("/api") else self._static()

    def do_POST(self):
        self._upload_photo() if urlparse(self.path).path == UPLOAD_URL else self._api()

    do_PUT = do_DELETE = _api

    def log_message(self, *args):
        pass


class LocalServer(ThreadingHTTPServer):
    # On Windows, "reuse address" lets a second server take a port that is already in use, and the
    # requests then go to the other one. Here a busy port is an error instead ("address already in use").
    allow_reuse_address = os.name != "nt"


def start(port=8765, require_login=False, demo_data=False):
    """A server with its own in-memory database, empty unless `demo_data`. Call `serve_forever()` on it."""
    server = LocalServer(("127.0.0.1", port), RequestHandler)    # port 0: any free one (the tests)
    server.require_login = require_login
    server.deps = Dependencies(MemoryRepository(), MemoryPhotos())
    if demo_data:
        load_demo_data(server.deps, LOCAL_OWNER, date.today(), LOCAL_PHONE, LOCAL_NAME)
    return server


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--empty", action="store_true", help="start with no data")
    args = parser.parse_args()
    print(f"http://127.0.0.1:{args.port}  (in memory, {'empty' if args.empty else 'demo data'}, no login; Ctrl+C to stop)")
    server = start(args.port, demo_data=not args.empty)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        server.server_close()
