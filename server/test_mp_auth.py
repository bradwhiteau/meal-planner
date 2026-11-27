"""Tests for the sign-in helper, with Google faked. Run: python -I server/test_mp_auth.py"""
import json
import os
import re
import sys
import tempfile
import threading
import unittest
import urllib.error
import urllib.parse
import urllib.request
from http.server import ThreadingHTTPServer

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import mp_auth  # noqa: E402

APP = 'https://bradwhiteau.github.io'


class FakeGoogle:
    def __init__(self):
        self.calls, self.revoked, self.n, self.dead = [], [], 0, set()

    def post(self, url, fields):
        self.calls.append((url, dict(fields)))
        if url == mp_auth.GOOGLE_REVOKE:
            self.revoked.append(fields['token'])
            return 200, {}
        assert fields['client_secret'] == 'SECRET'
        if fields['grant_type'] == 'authorization_code':
            if fields['code'] == 'no-drive':
                return 200, {'access_token': 'a0', 'expires_in': 3599, 'refresh_token': 'r0', 'scope': mp_auth.SCOPES[1]}
            return 200, {'access_token': 'access-1', 'expires_in': 3599, 'refresh_token': 'refresh-' + fields['code'], 'scope': ' '.join(mp_auth.SCOPES)}
        if fields['refresh_token'] in self.dead:
            return 400, {'error': 'invalid_grant'}
        self.n += 1
        return 200, {'access_token': f'access-r{self.n}', 'expires_in': 3599}

    def get(self, url, token):
        return 200, {'user': {'emailAddress': 'ash@example.com'}}


class HelperTest(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp()
        self.g = FakeGoogle()
        mp_auth.google_post, mp_auth.google_get = self.g.post, self.g.get
        mp_auth.LOG_FILE = ''
        self.cfg = {'client_id': 'CID', 'client_secret': 'SECRET', 'public_url': 'https://meals.example.au/',
                    'sessions_file': os.path.join(self.dir, 's.json')}
        self.start_server()

    def start_server(self):
        self.helper = mp_auth.Helper(self.cfg)
        self.srv = ThreadingHTTPServer(('127.0.0.1', 0), mp_auth.make_handler(self.helper))
        threading.Thread(target=self.srv.serve_forever, daemon=True).start()
        self.base = f'http://127.0.0.1:{self.srv.server_address[1]}'

    def tearDown(self):
        self.srv.shutdown()
        self.srv.server_close()

    def req(self, path, method='GET', key=None, origin=APP):  # noqa: C901
        h = {'Origin': origin}
        if key:
            h['Authorization'] = 'Bearer ' + key
        r = urllib.request.Request(self.base + path, method=method, headers=h, data=b'' if method == 'POST' else None)

        class NoRedirect(urllib.request.HTTPRedirectHandler):
            def redirect_request(self, *a, **k):
                return None
        try:
            resp = urllib.request.build_opener(NoRedirect).open(r, timeout=10)
            return resp.status, dict(resp.headers), resp.read().decode()
        except urllib.error.HTTPError as e:
            return e.code, dict(e.headers), e.read().decode()

    def sign_in(self, state='s' * 30, code='abc'):
        ret = urllib.parse.quote(APP + '/meal-planner/')
        st, h, _ = self.req(f'/start?state={state}&return={ret}&hint=ash@example.com')
        self.assertEqual(st, 302)
        q = dict(urllib.parse.parse_qsl(urllib.parse.urlsplit(h['Location']).query))
        st, h, page = self.req(f'/callback?state={q["state"]}&code={code}')
        if st != 302:
            return q, None, page
        loc = h['Location']
        self.assertTrue(loc.startswith(APP + '/meal-planner/#'), loc)
        back = dict(urllib.parse.parse_qsl(urllib.parse.urlsplit(loc).fragment))
        self.assertEqual(back['mp-auth-state'], state)
        if 'mp-auth-error' in back:
            return q, {'error': back['mp-auth-error']}, loc
        st, _, body = self.req('/redeem', 'POST', back['mp-auth-code'])
        self.assertEqual(st, 200)
        self.assertEqual(self.req('/redeem', 'POST', back['mp-auth-code'])[0], 401, 'one-time code')
        return q, json.loads(body), loc

    def test_whole_flow(self):
        q, msg, page = self.sign_in()
        self.assertEqual(q['access_type'], 'offline')
        self.assertEqual(q['redirect_uri'], 'https://meals.example.au/callback')
        self.assertEqual(q['login_hint'], 'ash@example.com')
        self.assertEqual(msg['email'], 'ash@example.com')
        self.assertEqual(msg['access_token'], 'access-1')
        key = msg['key']
        self.assertGreater(len(key), 40)
        self.assertNotIn(key, page, 'the key itself never goes in a URL')

        stored = open(self.cfg['sessions_file'], encoding='utf-8').read()
        self.assertNotIn('refresh-abc', stored, 'refresh token is encrypted on disk')
        self.assertNotIn(key, stored, 'device key is not stored, only its hash')

        st, h, body = self.req('/token', 'POST', key)
        self.assertEqual((st, json.loads(body)['access_token']), (200, 'access-1'), 'fresh token from the cache')
        self.assertEqual(h.get('Access-Control-Allow-Origin'), APP)

        # A restart: the cache is gone, so it refreshes with the stored (decrypted) refresh token.
        self.tearDown()
        self.start_server()
        st, _, body = self.req('/token', 'POST', key)
        self.assertEqual((st, json.loads(body)['access_token']), (200, 'access-r1'))
        self.assertEqual(self.g.calls[-1][1]['refresh_token'], 'refresh-abc')

        st, _, _ = self.req('/token', 'POST', 'wrong-key')
        self.assertEqual(st, 401)

        st, _, _ = self.req('/signout', 'POST', key)
        self.assertEqual(st, 204)
        self.assertEqual(self.g.revoked, ['refresh-abc'])
        self.assertEqual(self.req('/token', 'POST', key)[0], 401)

    def test_state_and_return_are_checked(self):
        ret = urllib.parse.quote(APP + '/meal-planner/')
        self.assertEqual(self.req(f'/start?state=short&return={ret}')[0], 400)
        self.assertEqual(self.req('/start?state=' + 'x' * 25 + '<&return=' + ret)[0], 400)
        self.assertEqual(self.req('/start?state=' + 'x' * 30 + '&return=' + urllib.parse.quote('https://evil.example/'))[0], 400, 'only returns to the app')
        self.sign_in(state='t' * 30)
        st, _, page = self.req(f'/callback?state={"t" * 30}&code=again')
        self.assertEqual(st, 400, 'a used sign-in gives nothing')
        self.assertEqual(self.req('/callback?state=never-started-xxxxxxxxxxx&code=abc')[0], 400)
        self.assertEqual(self.req('/redeem', 'POST', 'made-up')[0], 401)

    def test_lapsed_sign_in(self):
        _, msg, _ = self.sign_in(code='old')
        self.helper.cache.clear()
        self.g.dead.add('refresh-old')
        self.assertEqual(self.req('/token', 'POST', msg['key'])[0], 401)
        self.assertEqual(self.helper.sessions, {}, 'forgets a sign-in Google has dropped')

    def test_missing_drive_tick(self):
        _, msg, _ = self.sign_in(code='no-drive')
        self.assertIn('Tick both boxes', msg['error'])
        self.assertNotIn('key', msg)

    def test_cors_only_for_the_app(self):
        _, h, _ = self.req('/token', 'OPTIONS', origin='https://evil.example')
        self.assertNotIn('Access-Control-Allow-Origin', h)
        _, h, _ = self.req('/token', 'OPTIONS')
        self.assertEqual(h.get('Access-Control-Allow-Origin'), APP)

    def test_only_one_copy_can_listen(self):
        # 2.21.1 hour check: two copies shared the port, and the one that never saw the sign-in turned the phone away.
        first = mp_auth.Server(('127.0.0.1', 0), mp_auth.make_handler(self.helper))
        try:
            with self.assertRaises(OSError):
                mp_auth.Server(('127.0.0.1', first.server_address[1]), mp_auth.make_handler(self.helper)).server_close()
        finally:
            first.server_close()

    def test_a_sign_in_saved_by_another_copy_is_found(self):
        older = mp_auth.Helper(self.cfg)            # loaded before the phone signed in
        key = self.sign_in()[1]['key']
        status, body = older.token(key)
        self.assertEqual(status, 200, body)

    def test_seal_round_trip(self):
        s = mp_auth.seal('hello')
        self.assertTrue(s.startswith('dpapi:' if os.name == 'nt' else 'plain:'))
        self.assertEqual(mp_auth.unseal(s), 'hello')


if __name__ == '__main__':
    unittest.main(verbosity=2)
