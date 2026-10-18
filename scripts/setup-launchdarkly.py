#!/usr/bin/env python3
"""USER-RUN ONLY: create one isolated demo project. Never run via an agent.
No secret output, files, command-line arguments, shell sourcing or SDK key storage.
"""
import json
import getpass
import re
import sys
import ssl
import socket
import urllib.error
import urllib.request
from pathlib import Path

BASE = 'https://app.launchdarkly.com/api/v2'
PROJECT = 'launch-darkly-demo'
ENV = 'production'
FLAGS = ['payments-v2', 'risk-v2', 'notifications-v2']

class SetupError(Exception):
    pass

class ApiError(SetupError):
    def __init__(self, status, operation='request'):
        self.status = status
        super().__init__('HTTP_ERROR: %s; HTTP %d. Response body suppressed.' % (operation, status))

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args):
        return None

def validate_token(value):
    if not re.fullmatch(r'[A-Za-z0-9._-]{12,512}', value) or value.startswith(('sdk-', 'mob-')):
        raise SetupError('Unsupported management token format; no request sent.')
    return value


def allowed(method, path):
    if method == 'GET' and path == '/caller-identity':
        return True
    if path in ('/projects/' + PROJECT, '/projects/' + PROJECT + '/environments/' + ENV):
        return method == 'GET'
    if path == '/flags/' + PROJECT:
        return method == 'POST'
    return method in ('GET', 'PATCH') and path in ['/flags/' + PROJECT + '/' + f for f in FLAGS]

def tls_context():
    # Use the existing OS-maintained CA bundle on macOS. This fixes Python.org
    # installs whose OpenSSL default CA paths are missing; verification remains required.
    ca = Path('/etc/ssl/cert.pem')
    if sys.platform == 'darwin' and ca.is_file():
        return ssl.create_default_context(cafile=str(ca))
    return ssl.create_default_context()

def make_opener():
    return urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect(),
                                      urllib.request.HTTPSHandler(context=tls_context()))

def transport_error(error, operation):
    reason = error.reason if isinstance(error, urllib.error.URLError) else error
    if isinstance(reason, ssl.SSLCertVerificationError):
        return SetupError('TLS_CERTIFICATE_VERIFY_FAILED: %s; certificate verification code %s. Verification remains enabled.' % (operation, reason.verify_code))
    if isinstance(reason, ssl.SSLError):
        category = 'TLS_PROTOCOL_ERROR'
    elif isinstance(reason, socket.gaierror):
        category = 'DNS_LOOKUP_FAILED'
    elif isinstance(reason, (TimeoutError, socket.timeout)):
        category = 'NETWORK_TIMEOUT'
    elif isinstance(reason, ConnectionError):
        category = 'CONNECTION_FAILED'
    else:
        category = 'TRANSPORT_ERROR'
    return SetupError('%s: %s. Raw diagnostic details suppressed; no automatic retry.' % (category, operation))

class Api:
    def __init__(self, token):
        self.token = token
        self.writes_attempted = False
        self.opener = make_opener()

    def request(self, method, path, body=None):
        if not allowed(method, path):
            raise SetupError('Request rejected by fixed demo resource allowlist.')
        operation = method + ' ' + path
        req = urllib.request.Request(BASE + path, method=method,
            data=None if body is None else json.dumps(body).encode(),
            headers={'Authorization': self.token, 'Content-Type': 'application/json',
                     'LD-API-Version': '20240415'})
        if method in ('POST', 'PATCH'):
            self.writes_attempted = True
        try:
            with self.opener.open(req, timeout=20) as response:
                status = getattr(response, 'status', 200)
                try:
                    result = json.load(response)
                except (ValueError, UnicodeError):
                    raise SetupError('INVALID_JSON_RESPONSE: %s; HTTP %s. Body suppressed.' % (operation, status)) from None
                if not isinstance(result, dict):
                    raise SetupError('UNEXPECTED_RESPONSE_SHAPE: %s; HTTP %s. Body suppressed.' % (operation, status))
                return result
        except urllib.error.HTTPError as error:
            raise ApiError(error.code, operation) from None
        except SetupError:
            raise
        except (urllib.error.URLError, OSError) as error:
            raise transport_error(error, operation) from None
        except Exception:
            raise SetupError('RESPONSE_FAILURE: %s; details suppressed. No automatic retry.' % operation) from None

def diagnose():
    """No credential read, Authorization header, account request or mutation."""
    print('Unauthenticated diagnostic: Python ' + sys.version.split()[0])
    print('TLS verification: enabled; redirects: disabled; proxy environment: ignored.')
    print('CA source: ' + ('existing macOS system CA bundle' if sys.platform == 'darwin' and Path('/etc/ssl/cert.pem').is_file() else 'Python default trust store'))
    operation = 'GET /caller-identity (no Authorization)'
    req = urllib.request.Request(BASE + '/caller-identity', method='GET')
    try:
        with make_opener().open(req, timeout=20) as response:
            print('HTTPS reachable; HTTP %s. Response body not read.' % response.status)
    except urllib.error.HTTPError as error:
        print('HTTPS reachable; HTTP %s%s' % (error.code, ' (expected without credentials).' if error.code == 401 else '. No response body displayed.'))
        return 0 if error.code == 401 else 1
    except (urllib.error.URLError, OSError) as error:
        print(str(transport_error(error, operation)))
        return 1
    return 0

def clause(attribute, values):
    return {'contextKind': 'demo', 'attribute': attribute, 'op': 'in', 'negate': False, 'values': values}

def rules(index):
    combinations = [format(n, '03b') for n in range(8) if format(n, '03b')[index] == '1']
    return [
        {'description': 'Rollback cohort stays baseline', 'variation': 1, 'trackEvents': False,
         'clauses': [clause('cohort', ['rollback'])]},
        {'description': 'Synthetic test and release combinations', 'variation': 0, 'trackEvents': False,
         'clauses': [clause('cohort', ['test', 'release']), clause('combination', combinations)]}
    ]

def check_flag(flag, name):
    if flag.get('key') != name or [v.get('value') for v in flag.get('variations', [])] != [True, False] or any(type(v.get('value')) is not bool for v in flag.get('variations', [])):
        raise SetupError('Unexpected flag identity/variations; stopped without further changes.')
    if ENV not in flag.get('environments', {}):
        raise SetupError('Unexpected environment set; stopped without further changes.')
    if not isinstance(flag.get('_version'), int):
        raise SetupError('Missing flag version; stopped without further changes.')

def check_targeting(flag, index, expected_on):
    check_flag(flag, FLAGS[index])
    env = flag['environments'][ENV]
    expected = rules(index)
    actual = env.get('rules', [])
    fields = ('contextKind', 'attribute', 'op', 'negate', 'values')
    valid_rules = len(actual) == len(expected)
    if valid_rules:
        for found, wanted in zip(actual, expected):
            clauses = found.get('clauses', [])
            valid_rules = valid_rules and (found.get('variation') == wanted['variation'] and
                not found.get('disabled', False) and not found.get('rollout') and
                len(clauses) == len(wanted['clauses']) and
                all({k: a.get(k) for k in fields} == b for a, b in zip(clauses, wanted['clauses'])))
    availability = flag.get('clientSideAvailability', {})
    if (env.get('on') is not expected_on or env.get('offVariation') != 1 or
        env.get('fallthrough', {}).get('variation') != 1 or env.get('fallthrough', {}).get('rollout') or
        env.get('targets') or env.get('contextTargets') or env.get('prerequisites') or
        availability.get('usingEnvironmentId') is not False or availability.get('usingMobileKey') is not False or
        not valid_rules):
        raise SetupError('Saved targeting verification failed for ' + FLAGS[index] + '; stop and inspect only these demo flags.')

def provision(api, confirm, report=print):
    identity = api.request('GET', '/caller-identity')
    account = identity.get('accountId', '')
    token_id = identity.get('tokenId', '')
    if (not isinstance(account, str) or not re.fullmatch(r'[A-Za-z0-9_-]{6,128}', account)
        or not isinstance(token_id, str) or not token_id
        or identity.get('environmentId') or identity.get('projectId')):
        raise SetupError('Cannot establish an account-level management token identity; no writes attempted. Check that this is a management API token, not an SDK key.')
    project = api.request('GET', '/projects/' + PROJECT)
    if project.get('key') != PROJECT:
        raise SetupError('Project identity mismatch; expected launch-darkly-demo. No writes attempted.')
    environment = api.request('GET', '/projects/' + PROJECT + '/environments/' + ENV)
    if environment.get('key') != ENV:
        raise SetupError('Environment identity mismatch; expected production. No writes attempted.')
    for name in FLAGS:
        try:
            api.request('GET', '/flags/' + PROJECT + '/' + name)
        except ApiError as error:
            if error.status != 404:
                raise
        else:
            raise SetupError('A requested demo flag already exists; refusing to overwrite existing configuration. No writes attempted.')
    if not confirm(account):
        raise SetupError('Account/project/environment confirmation did not match. No changes made.')
    report('Creating 3 new flags in existing launch-darkly-demo; enabling targeting only in production.')
    # Only new allowlisted flags are written; existing flag collisions abort before writes.
    for index, name in enumerate(FLAGS):
        created = api.request('POST', '/flags/' + PROJECT, {
            'key': name, 'name': name, 'description': 'Synthetic three-team demo; both code paths already deployed.',
            'variations': [{'value': True, 'name': 'New logic'}, {'value': False, 'name': 'Baseline'}],
            'defaults': {'onVariation': 1, 'offVariation': 1}, 'isFlagOn': False,
            'clientSideAvailability': {'usingEnvironmentId': False, 'usingMobileKey': False},
            'tags': ['three-team-demo'], 'temporary': True})
        if created.get('key') != name:
            raise SetupError('Created flag identity mismatch; stopped without further changes.')
        created = api.request('GET', '/flags/' + PROJECT + '/' + name)
        check_flag(created, name)
        path = '/environments/' + ENV
        api.request('PATCH', '/flags/' + PROJECT + '/' + name, [
            {'op': 'test', 'path': '/_version', 'value': created['_version']},
            {'op': 'replace', 'path': path + '/rules', 'value': rules(index)},
            {'op': 'replace', 'path': path + '/fallthrough', 'value': {'variation': 1}},
            {'op': 'replace', 'path': path + '/offVariation', 'value': 1}])
    # Verify every prepared configuration before enabling any flag.
    for index, name in enumerate(FLAGS):
        check_targeting(api.request('GET', '/flags/' + PROJECT + '/' + name), index, False)
    # Re-read with version guards before each enable; cross-flag changes are not atomic.
    for index, name in enumerate(FLAGS):
        current = api.request('GET', '/flags/' + PROJECT + '/' + name)
        check_targeting(current, index, False)
        api.request('PATCH', '/flags/' + PROJECT + '/' + name, [
            {'op': 'test', 'path': '/_version', 'value': current['_version']},
            {'op': 'replace', 'path': '/environments/' + ENV + '/on', 'value': True}])
    for index, name in enumerate(FLAGS):
        current = api.request('GET', '/flags/' + PROJECT + '/' + name)
        check_targeting(current, index, True)
    report('SETUP VERIFIED: project=launch-darkly-demo environment=production flags=3')
    report('API configuration verified only. Live SDK evaluation and rollback are not yet validated.')
    report('Open https://app.launchdarkly.com/projects/launch-darkly-demo/settings/environments')
    report('User handoff: obtain ONLY launch-darkly-demo production environment SDK key in LaunchDarkly; enter it locally via hidden shell input. Do not paste it in chat.')

def main(argv=None):
    args = sys.argv[1:] if argv is None else argv
    if args == ['--diagnose']:
        return diagnose()
    if args:
        print('Usage: setup-launchdarkly.py [--diagnose]', file=sys.stderr)
        return 2
    if not sys.stdin.isatty():
        print('Run this command personally in an interactive Terminal; no request sent.', file=sys.stderr)
        return 2
    print('User-run setup: enter your NEW management API key below; other project configuration is never read.')
    print('Uses existing launch-darkly-demo/production; creates 3 flags. No other project changes. No key output/storage.')
    def confirm(account):
        print('Authenticated LaunchDarkly account ID: ' + account)
        answer = input('Verify this account in LaunchDarkly; to confirm, type its exact account ID: ').strip()
        project = input('To authorize these production demo flags, type launch-darkly-demo/production: ').strip()
        return answer == account and project == PROJECT + '/' + ENV
    api = None
    try:
        api = Api(validate_token(getpass.getpass('New LaunchDarkly management API key (hidden): ').strip()))
        provision(api, confirm)
        return 0
    except (KeyboardInterrupt, EOFError):
        print('Stopped. No automatic retry; inspect the new project if setup had begun.', file=sys.stderr)
        return 1
    except SetupError as error:
        print(str(error), file=sys.stderr)
        if api is None or not api.writes_attempted:
            print('No create/update request was attempted by this invocation. Safe to rerun after fixing the cause; existing-flag collision refusal remains enabled.', file=sys.stderr)
        else:
            print('A write was attempted; partial new demo flags may remain. No automatic retry/cleanup. Inspect only the three demo flags in launch-darkly-demo; rerunning refuses existing flag keys.', file=sys.stderr)
        return 1
    except Exception:
        print('Setup stopped; diagnostic details suppressed to protect credentials. Inspect only the new demo project.', file=sys.stderr)
        return 1
    finally:
        # No attempt to claim reliable memory zeroization in Python.
        pass

if __name__ == '__main__':
    sys.exit(main())
