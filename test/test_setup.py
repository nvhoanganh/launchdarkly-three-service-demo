"""Offline only. All HTTP is mocked; never reads credential files."""
import contextlib
import copy
import importlib.util
import io
import json
from pathlib import Path
import tempfile
import ssl
import socket
import unittest
import urllib.error
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('setup', Path(__file__).resolve().parents[1] / 'scripts/setup-launchdarkly.py')
setup = importlib.util.module_from_spec(spec)
spec.loader.exec_module(setup)
FAKE_TOKEN = 'fixture-management-token-only'

class MockHTTP:
    def __init__(self, exists=False, fail_status=None):
        self.calls = []
        self.exists = exists
        self.fail_status = fail_status
        self.flags = {}

    def open(self, request, timeout):
        method = request.get_method()
        path = request.full_url.removeprefix(setup.BASE)
        body = json.loads(request.data) if request.data else None
        self.calls.append((method, path, body))
        assert request.full_url.startswith('https://app.launchdarkly.com/api/v2/')
        assert setup.allowed(method, path)
        assert request.get_header('Authorization') == FAKE_TOKEN
        if self.fail_status:
            raise urllib.error.HTTPError(request.full_url, self.fail_status, 'SECRET-BODY-MUST-NOT-LEAK', {}, io.BytesIO(b'SECRET'))
        if path == '/caller-identity':
            result = {'accountId': 'fixture-account', 'tokenId': 'fixture-token', 'serviceToken': True}
        elif method == 'GET' and path == '/projects/' + setup.PROJECT + '/environments/production':
            result = {'key': 'production', 'apiKey': 'fixture-sdk-must-not-leak'}
        elif method == 'GET' and path.startswith('/projects/'):
            result = {'key': setup.PROJECT}
        elif method == 'GET' and path.startswith('/flags/') and path.split('/')[-1] not in self.flags:
            if not self.exists:
                raise urllib.error.HTTPError(request.full_url, 404, 'missing', {}, None)
            result = {'key': path.split('/')[-1]}
        elif path == '/projects':
            assert body['environments'][0]['key'] == 'demo'
            assert len(body['environments']) == 1
            assert body['environments'][0]['critical'] is False
            result = {**body, 'environments': [{**body['environments'][0], 'apiKey': 'fixture-sdk-must-not-leak'}]}
        elif method == 'POST':
            name = body['key']
            self.flags[name] = {**body, '_version': 1, 'environments': {'production': {'on': False, 'rules': [], 'offVariation': 1, 'fallthrough': {'variation': 1}, 'targets': [], 'contextTargets': [], 'prerequisites': [], 'version': 1, 'trackEvents': False}, 'test': {'on': False, 'rules': [], 'offVariation': 1, 'fallthrough': {'variation': 1}}}}
            result = self.flags[name]
        else:
            name = path.split('/')[-1]
            flag = self.flags[name]
            if method == 'PATCH':
                for op in body:
                    if op['op'] == 'test':
                        assert flag['_version'] == op['value']
                    else:
                        assert op['path'].startswith('/environments/production/')
                        flag['environments']['production'][op['path'].split('/')[-1]] = op['value']
                flag['_version'] += 1
            result = flag
        result = copy.deepcopy(result)
        if method == 'POST' and path.startswith('/flags/'):
            result.pop('environments', None)  # Do not rely on creation response expansion.
        if isinstance(result, dict) and 'environments' in result:
            for env in result['environments'].values():
                env['_environmentName'] = 'Fixture environment'
                for rule in env.get('rules', []):
                    rule['_id'] = 'fixture-rule-id'
                    rule['disabled'] = False
                    for clause in rule['clauses']:
                        clause['_id'] = 'fixture-clause-id'
        return io.BytesIO(json.dumps(result).encode())

def api_with(mock):
    api = setup.Api(FAKE_TOKEN)
    api.opener = mock
    return api

class SetupTests(unittest.TestCase):
    def test_create_and_verify_all_targeting_combinations(self):
        mock = MockHTTP()
        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            setup.provision(api_with(mock), lambda account: account == 'fixture-account')
        self.assertIn('SETUP VERIFIED', output.getvalue())
        self.assertNotIn(FAKE_TOKEN, output.getvalue())
        self.assertNotIn('fixture-sdk', output.getvalue())
        for index, name in enumerate(setup.FLAGS):
            flag = mock.flags[name]
            self.assertTrue(flag['environments']['production']['on'])
            self.assertFalse(flag['environments']['test']['on'])
            self.assertEqual(flag['environments']['test']['rules'], [])
            for n in range(8):
                bits = format(n, '03b')
                attrs = {'combination': bits}
                variation = 1
                for rule in flag['environments']['production']['rules']:
                    if all(c['contextKind'] == 'user' and c['op'] == 'in' and not c['negate'] and attrs[c['attribute']] in c['values'] for c in rule['clauses']):
                        variation = rule['variation']; break
                self.assertEqual(variation == 0, bits[index] == '1')
        self.assertTrue(all('/default' not in p and (m == 'GET' or p.startswith('/flags/launch-darkly-demo')) for m, p, _ in mock.calls))

    def test_existing_project_never_mutated(self):
        mock = MockHTTP(exists=True)
        with self.assertRaisesRegex(setup.SetupError, 'already exists'):
            setup.provision(api_with(mock), lambda _: True)
        self.assertTrue(all(m == 'GET' for m, _, _ in mock.calls))

    def test_identity_rejection_never_mutates(self):
        mock = MockHTTP()
        with self.assertRaisesRegex(setup.SetupError, 'confirmation'):
            setup.provision(api_with(mock), lambda _: False)
        self.assertTrue(all(m == 'GET' for m, _, _ in mock.calls))

    def test_http_errors_redacted_no_retry(self):
        mock = MockHTTP(fail_status=403)
        with self.assertRaises(setup.ApiError) as error:
            setup.provision(api_with(mock), lambda _: True)
        self.assertNotIn('SECRET', str(error.exception))
        self.assertNotIn(FAKE_TOKEN, str(error.exception))
        self.assertEqual(len(mock.calls), 1)

    def test_allowlist_and_redirect_protection(self):
        api = api_with(MockHTTP())
        for method, path in [('POST', '/projects'), ('PATCH', '/projects/default'), ('GET', 'https://evil.test'), ('DELETE', '/projects/three-team-demo'), ('PATCH', '/flags/default/payments-v2')]:
            with self.assertRaises(setup.SetupError):
                api.request(method, path)
        self.assertIsNone(setup.NoRedirect().redirect_request(None))

    def test_new_token_validation_without_file_reads(self):
        self.assertEqual(setup.validate_token(FAKE_TOKEN), FAKE_TOKEN)
        for value in ['$(touch nope)', 'sdk-fake-token-000', 'one\ntwo', '']:
            with self.assertRaises(setup.SetupError):
                setup.validate_token(value)


    def test_partial_write_failure_refuses_rerun(self):
        mock = MockHTTP()
        original_open = mock.open
        def fail_patch(request, timeout):
            if request.get_method() == 'PATCH':
                raise urllib.error.HTTPError(request.full_url, 400, 'SECRET', {}, None)
            return original_open(request, timeout)
        api = api_with(mock)
        mock.open = fail_patch
        with contextlib.redirect_stdout(io.StringIO()), self.assertRaises(setup.ApiError):
            setup.provision(api, lambda _: True)
        self.assertTrue(api.writes_attempted)
        self.assertEqual(list(mock.flags), ['payments-v2'])
        self.assertFalse(mock.flags['payments-v2']['environments']['production']['on'])
        mock.open = original_open
        before = len(mock.calls)
        with self.assertRaisesRegex(setup.SetupError, 'already exists'):
            setup.provision(api_with(mock), lambda _: True)
        self.assertTrue(all(method == 'GET' for method, _, _ in mock.calls[before:]))

class DiagnosticsTests(unittest.TestCase):
    def test_safe_categories_never_include_exception_text(self):
        tls = ssl.SSLCertVerificationError(1, 'SECRET-CERTIFICATE-TEXT')
        tls.verify_code = 20
        cases = [(tls, 'TLS_CERTIFICATE_VERIFY_FAILED'),
                 (socket.gaierror('SECRET-DNS-TEXT'), 'DNS_LOOKUP_FAILED'),
                 (TimeoutError('SECRET-TIMEOUT-TEXT'), 'NETWORK_TIMEOUT'),
                 (ConnectionRefusedError('SECRET-CONNECTION-TEXT'), 'CONNECTION_FAILED')]
        for reason, category in cases:
            message = str(setup.transport_error(urllib.error.URLError(reason), 'GET /caller-identity'))
            self.assertIn(category, message)
            self.assertIn('GET /caller-identity', message)
            self.assertNotIn('SECRET', message)

    def test_diagnose_never_reads_credentials_or_sends_authorization(self):
        class Unauthenticated:
            def open(self, request, timeout):
                self_request = request
                assert not self_request.has_header('Authorization')
                assert request.get_method() == 'GET'
                raise urllib.error.HTTPError(request.full_url, 401, 'SECRET', {}, None)
        with patch.object(setup.getpass, 'getpass', side_effect=AssertionError('Must not read credential')), \
             patch.object(setup, 'make_opener', return_value=Unauthenticated()), \
             contextlib.redirect_stdout(io.StringIO()) as output:
            self.assertEqual(setup.main(['--diagnose']), 0)
        self.assertIn('expected without credentials', output.getvalue())
        self.assertNotIn('SECRET', output.getvalue())

    def test_tls_failure_before_confirmation_has_no_writes(self):
        class BrokenTLS:
            def open(self, request, timeout):
                error = ssl.SSLCertVerificationError(1, 'SECRET')
                error.verify_code = 20
                raise urllib.error.URLError(error)
        api = api_with(BrokenTLS())
        with self.assertRaisesRegex(setup.SetupError, 'TLS_CERTIFICATE_VERIFY_FAILED: GET /caller-identity'):
            setup.provision(api, lambda _: self.fail('Must not reach confirmation'))
        self.assertFalse(api.writes_attempted)

    def test_invalid_json_reports_status_without_body(self):
        class BadJSON:
            def open(self, request, timeout):
                response = io.BytesIO(b'SECRET-invalid-json')
                response.status = 200
                return response
        with self.assertRaisesRegex(setup.SetupError, 'INVALID_JSON_RESPONSE: GET /caller-identity; HTTP 200') as error:
            api_with(BadJSON()).request('GET', '/caller-identity')
        self.assertNotIn('SECRET', str(error.exception))

    def test_mac_trust_context_keeps_verification(self):
        context = setup.tls_context()
        self.assertTrue(context.check_hostname)
        self.assertEqual(context.verify_mode, ssl.CERT_REQUIRED)

if __name__ == '__main__':
    unittest.main()
