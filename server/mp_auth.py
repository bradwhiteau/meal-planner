"""Meal Planner sign-in helper.

A tiny web service that keeps each phone signed in to Google, so the app never needs the sign-in popup again.
It does not see or store any meal planner data: phones still talk to Google Drive directly. It only holds each
phone's long-lasting Google sign-in (a refresh token, encrypted with Windows DPAPI) and hands out one-hour
access tokens to the phone that owns it.

Endpoints
  GET  /start?state=..&return=..[&hint=email]   sends the app (same window) to Google, asking for offline access
  GET  /callback                      Google comes back here; sends the app back to `return` with a one-time code
  POST /redeem                        Authorization: Bearer <one-time code>  ->  {key, email, access_token, expires_in}
  POST /token                         Authorization: Bearer <device key>  ->  {access_token, expires_in}
  POST /signout                       Authorization: Bearer <device key>  ->  forgets and revokes the sign-in
  GET  /health                        "ok"

Run:  python mp_auth.py [path\\to\\mp-auth.config.json]
Standard library only. See SETUP.md beside this file.
"""
import base64
import ctypes
import getpass
import hashlib
import html
import json
import os
import secrets
import socket
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

GOOGLE_AUTH = 'https://accounts.google.com/o/oauth2/v2/auth'
GOOGLE_TOKEN = 'https://oauth2.googleapis.com/token'
GOOGLE_REVOKE = 'https://oauth2.googleapis.com/revoke'
DRIVE_ABOUT = 'https://www.googleapis.com/drive/v3/about?fields=user(emailAddress)'
SCOPES = ['https://www.googleapis.com/auth/drive.readonly', 'https://www.googleapis.com/auth/drive.file']
DEFAULT_ORIGINS = ['https://bradwhiteau.github.io']
PENDING_SECONDS = 600     # a sign-in has 10 minutes to come back from Google
CODE_SECONDS = 120        # and the app 2 minutes to collect it
MAX_PENDING = 200
STATE_OK = set('abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_')


# ---------- encryption at rest (Windows DPAPI: only this Windows user on this machine can decrypt) ----------

class _Blob(ctypes.Structure):
    _fields_ = [('cbData', ctypes.c_uint32), ('pbData', ctypes.POINTER(ctypes.c_char))]


def _dpapi(data, protect):
    crypt32, kernel32 = ctypes.windll.crypt32, ctypes.windll.kernel32
    buf = ctypes.create_string_buffer(data, len(data))
    src, out = _Blob(len(data), ctypes.cast(buf, ctypes.POINTER(ctypes.c_char))), _Blob()
    fn = crypt32.CryptProtectData if protect else crypt32.CryptUnprotectData
    if not fn(ctypes.byref(src), None, None, None, None, 0x1, ctypes.byref(out)):   # 0x1: no UI
        raise OSError('DPAPI failed')
    try:
        return ctypes.string_at(out.pbData, out.cbData)
    finally:
        kernel32.LocalFree(out.pbData)


def seal(text):
    raw = text.encode()
    if os.name == 'nt':
        return 'dpapi:' + base64.b64encode(_dpapi(raw, True)).decode()
    return 'plain:' + base64.b64encode(raw).decode()     # only for running the tests off Windows


def unseal(s):
    kind, _, b = s.partition(':')
    raw = base64.b64decode(b)
    return (_dpapi(raw, False) if kind == 'dpapi' else raw).decode()


def key_id(key):
    """Sessions are stored under a hash of the device key, so the file alone can't be used to get tokens."""
    return hashlib.sha256(key.encode()).hexdigest()


# ---------- Google calls (replaced in the tests) ----------

def google_post(url, fields):
    req = urllib.request.Request(url, data=urllib.parse.urlencode(fields).encode(), method='POST',
                                 headers={'Content-Type': 'application/x-www-form-urlencoded'})
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            return r.status, json.loads(r.read() or b'{}')
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read() or b'{}')
        except ValueError:
            return e.code, {}


def google_get(url, token):
    req = urllib.request.Request(url, headers={'Authorization': 'Bearer ' + token})
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            return r.status, json.loads(r.read() or b'{}')
    except urllib.error.HTTPError as e:
        return e.code, {}


# ---------- the service ----------

class Helper:
    def __init__(self, cfg):
        self.client_id = cfg['client_id']
        self.client_secret = cfg['client_secret']
        self.public_url = cfg['public_url'].rstrip('/')
        self.origins = cfg.get('allowed_origins') or DEFAULT_ORIGINS
        self.store_path = cfg.get('sessions_file') or os.path.join(os.path.dirname(os.path.abspath(__file__)), 'mp-auth-sessions.json')
        self.lock = threading.Lock()
        self.pending = {}      # state -> (started, return url)
        self.codes = {}        # one-time code -> (made, what the app collects)
        self.cache = {}        # key id -> (access token, expires at); memory only
        self.sessions = self._load()

    def _load(self):
        try:
            with open(self.store_path, encoding='utf-8') as f:
                return json.load(f)
        except FileNotFoundError:
            return {}

    def _save(self):
        tmp = self.store_path + '.tmp'
        with open(tmp, 'w', encoding='utf-8') as f:
            json.dump(self.sessions, f, indent=1)
        os.replace(tmp, self.store_path)

    @property
    def redirect_uri(self):
        return self.public_url + '/callback'

    def return_ok(self, url):
        u = urllib.parse.urlsplit(url or '')
        return f'{u.scheme}://{u.netloc}' in self.origins and not u.fragment

    def start(self, state, ret, hint):
        if not (20 <= len(state) <= 100 and set(state) <= STATE_OK) or not self.return_ok(ret):
            return None
        now = time.time()
        with self.lock:
            for s, (t, _) in list(self.pending.items()):
                if now - t > PENDING_SECONDS:
                    del self.pending[s]
            if len(self.pending) >= MAX_PENDING:
                return None
            self.pending[state] = (now, ret)
        q = {'client_id': self.client_id, 'redirect_uri': self.redirect_uri, 'response_type': 'code',
             'scope': ' '.join(SCOPES), 'access_type': 'offline', 'prompt': 'consent',
             'include_granted_scopes': 'true', 'state': state}
        if hint and '@' in hint and len(hint) < 200:
            q['login_hint'] = hint
        return GOOGLE_AUTH + '?' + urllib.parse.urlencode(q)

    def callback(self, state, code, error):
        """Returns (where to send the app, or None; text to show when there's nowhere to send it)."""
        with self.lock:
            started, ret = self.pending.pop(state, (0, ''))
        if not started or time.time() - started > PENDING_SECONDS:
            return None, 'This sign-in has expired. Go back to the Meal Planner and try again.'

        def back(**kv):
            return ret + '#' + urllib.parse.urlencode({'mp-auth-state': state, **kv})
        if error or not code:
            return back(**{'mp-auth-error': 'Sign-in cancelled'}), ''
        status, tok = google_post(GOOGLE_TOKEN, {'code': code, 'client_id': self.client_id, 'client_secret': self.client_secret,
                                                 'redirect_uri': self.redirect_uri, 'grant_type': 'authorization_code'})
        granted = set((tok.get('scope') or '').split())
        if status != 200 or not tok.get('access_token'):
            return back(**{'mp-auth-error': 'Google said no: ' + str(tok.get('error_description') or tok.get('error') or status)}), ''
        if not set(SCOPES) <= granted:
            return back(**{'mp-auth-error': "Drive access wasn't granted. Tick both boxes when Google asks."}), ''
        if not tok.get('refresh_token'):
            return back(**{'mp-auth-error': "Google didn't give a lasting sign-in. Try again."}), ''
        _, about = google_get(DRIVE_ABOUT, tok['access_token'])
        email = ((about or {}).get('user') or {}).get('emailAddress', '')
        key, once = secrets.token_urlsafe(32), secrets.token_urlsafe(32)
        kid = key_id(key)
        expires_in = int(tok.get('expires_in') or 3600)
        now = time.time()
        with self.lock:
            self.sessions[kid] = {'email': email, 'rt': seal(tok['refresh_token']), 'created': int(now), 'used': int(now)}
            self.cache[kid] = (tok['access_token'], now + expires_in)
            for c, (t, _) in list(self.codes.items()):
                if now - t > CODE_SECONDS:
                    del self.codes[c]
            self.codes[once] = (now, {'key': key, 'email': email, 'access_token': tok['access_token'], 'expires_in': expires_in})
            self._save()
        log(f'signed in: {email or "(unknown)"}')
        return back(**{'mp-auth-code': once}), ''

    def redeem(self, once):
        with self.lock:
            made, got = self.codes.pop(once or '', (0, None))
        if not got or time.time() - made > CODE_SECONDS:
            return 401, {'error': 'code expired'}
        return 200, got

    def token(self, key):
        """Returns (http status, body)."""
        kid = key_id(key or '')
        with self.lock:
            sess = self.sessions.get(kid)
            cached = self.cache.get(kid)
        if not sess:   # another copy may have saved it since this one loaded: look again before turning it away
            with self.lock:
                self.sessions = {**self._load(), **self.sessions}
                sess = self.sessions.get(kid)
        if not sess:
            log("token asked for by a phone this helper doesn't know")
            return 401, {'error': 'unknown device'}
        if cached and cached[1] - time.time() > 300:
            return 200, {'access_token': cached[0], 'expires_in': int(cached[1] - time.time())}
        status, tok = google_post(GOOGLE_TOKEN, {'client_id': self.client_id, 'client_secret': self.client_secret,
                                                 'refresh_token': unseal(sess['rt']), 'grant_type': 'refresh_token'})
        if status == 400 and tok.get('error') == 'invalid_grant':     # revoked, or unused for 6 months
            with self.lock:
                self.sessions.pop(kid, None)
                self.cache.pop(kid, None)
                self._save()
            log(f'sign-in lapsed: {sess.get("email") or "(unknown)"}')
            return 401, {'error': 'sign-in lapsed'}
        if status != 200 or not tok.get('access_token'):
            return 502, {'error': 'Google unavailable'}
        expires_in = int(tok.get('expires_in') or 3600)
        with self.lock:
            self.cache[kid] = (tok['access_token'], time.time() + expires_in)
            if kid in self.sessions:
                self.sessions[kid]['used'] = int(time.time())
                if tok.get('refresh_token'):
                    self.sessions[kid]['rt'] = seal(tok['refresh_token'])
                self._save()
        return 200, {'access_token': tok['access_token'], 'expires_in': expires_in}

    def signout(self, key):
        kid = key_id(key or '')
        with self.lock:
            sess = self.sessions.pop(kid, None)
            self.cache.pop(kid, None)
            if sess:
                self._save()
        if sess:
            try:
                google_post(GOOGLE_REVOKE, {'token': unseal(sess['rt'])})
            except Exception:   # noqa: BLE001 (forgetting it here is what matters)
                pass
            log(f'signed out: {sess.get("email") or "(unknown)"}')
        return 204


LOG_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'mp-auth.log')   # Task Scheduler drops the console


def log(msg):
    line = time.strftime('%Y-%m-%d %H:%M:%S') + ' ' + msg
    print(line, flush=True)
    if not LOG_FILE:
        return
    try:
        if os.path.exists(LOG_FILE) and os.path.getsize(LOG_FILE) > 1_000_000:
            os.replace(LOG_FILE, LOG_FILE + '.old')
        with open(LOG_FILE, 'a', encoding='utf-8') as f:
            f.write(line + '\n')
    except OSError:
        pass


class Server(ThreadingHTTPServer):
    """Only one copy may listen. On Windows the usual "reuse address" lets a second copy share the port and answer
    some of the requests, so a phone could be turned away by the copy that never saw it sign in."""
    allow_reuse_address = False

    def server_bind(self):
        if hasattr(socket, 'SO_EXCLUSIVEADDRUSE'):
            self.socket.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
        super().server_bind()


PAGE = """<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Meal Planner sign-in</title>
<body style="font:17px -apple-system,system-ui,sans-serif;padding:40px 24px;text-align:center;color:#222"><p>{text}</p>"""


def make_handler(helper):
    class Handler(BaseHTTPRequestHandler):
        server_version = 'mp-auth'
        sys_version = ''

        def log_message(self, *args):   # keep tokens and codes out of the log
            pass

        def _cors(self):
            origin = self.headers.get('Origin', '')
            if origin in helper.origins:
                self.send_header('Access-Control-Allow-Origin', origin)
                self.send_header('Vary', 'Origin')
                self.send_header('Access-Control-Allow-Methods', 'POST')
                self.send_header('Access-Control-Allow-Headers', 'Authorization')
                self.send_header('Access-Control-Max-Age', '86400')

        def _send(self, status, body=b'', ctype='application/json', extra=None):
            if isinstance(body, (dict, list)):
                body = json.dumps(body).encode()
            elif isinstance(body, str):
                body = body.encode()
            self.send_response(status)
            self._cors()
            self.send_header('Cache-Control', 'no-store')
            self.send_header('X-Content-Type-Options', 'nosniff')
            self.send_header('Referrer-Policy', 'no-referrer')
            for k, v in (extra or {}).items():
                self.send_header(k, v)
            if body:
                self.send_header('Content-Type', ctype)
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            if body:
                self.wfile.write(body)

        def _key(self):
            auth = self.headers.get('Authorization', '')
            return auth[7:].strip() if auth.startswith('Bearer ') else ''

        def do_OPTIONS(self):
            self._send(204)

        def do_GET(self):
            u = urllib.parse.urlsplit(self.path)
            q = dict(urllib.parse.parse_qsl(u.query))
            if u.path == '/health':
                return self._send(200, 'ok', 'text/plain')
            if u.path == '/start':
                url = helper.start(q.get('state', ''), q.get('return', ''), q.get('hint', ''))
                if not url:
                    return self._send(400, 'Bad or too many sign-in requests. Try again from the app.', 'text/plain; charset=utf-8')
                return self._send(302, extra={'Location': url})
            if u.path == '/callback':
                try:
                    url, text = helper.callback(q.get('state', ''), q.get('code', ''), q.get('error', ''))
                except Exception as e:   # noqa: BLE001
                    log(f'callback error: {type(e).__name__}')
                    url, text = None, 'Something went wrong. Go back to the Meal Planner and try again.'
                if url:
                    return self._send(302, extra={'Location': url})
                return self._send(400, PAGE.format(text=html.escape(text)), 'text/html; charset=utf-8')
            return self._send(404, 'not found', 'text/plain')

        def do_POST(self):
            path = urllib.parse.urlsplit(self.path).path
            if path == '/token':
                try:
                    status, body = helper.token(self._key())
                except Exception as e:   # noqa: BLE001
                    log(f'token error: {type(e).__name__}')
                    status, body = 500, {'error': 'helper problem'}
                return self._send(status, body)
            if path == '/redeem':
                return self._send(*helper.redeem(self._key()))
            if path == '/signout':
                return self._send(helper.signout(self._key()))
            return self._send(404, 'not found', 'text/plain')

    return Handler


def main():
    here = os.path.dirname(os.path.abspath(__file__))
    cfg_path = sys.argv[1] if len(sys.argv) > 1 else os.path.join(here, 'mp-auth.config.json')
    with open(cfg_path, encoding='utf-8') as f:
        cfg = json.load(f)
    helper = Helper(cfg)
    host, port = cfg.get('host', '127.0.0.1'), int(cfg.get('port', 8790))
    try:
        srv = Server((host, port), make_handler(helper))
    except OSError:
        log(f'Not started: port {port} is already in use (is another copy of the helper running?)')
        sys.exit(1)
    log(f'Meal Planner sign-in helper on http://{host}:{port} for {helper.public_url} '
        f'({len(helper.sessions)} phones signed in, running as {getpass.getuser()}, process {os.getpid()})')
    srv.serve_forever()


if __name__ == '__main__':
    main()
