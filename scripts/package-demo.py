#!/usr/bin/env python3
"""Package only explicit .NET/Express demo sources and synthetic evidence."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED

ROOT = Path(__file__).resolve().parents[1]
FILES = [
    'package.json', 'package-lock.json', 'README.md', '.gitignore', 'run.sh',
    'scripts/start-demo.mjs', 'scripts/test-combinations.mjs',
    'scripts/setup-launchdarkly.py', 'scripts/package-demo.py',
    'test/dotnet-integration.test.mjs', 'test/test_setup.py', 'test/coverage.test.mjs',
    'src/DemoUI/package.json', 'src/DemoUI/package-lock.json', 'src/DemoUI/server.mjs',
    'src/DemoUI/public/route.mjs', 'src/DemoUI/public/coverage.mjs', 'src/DemoUI/public/index.html', 'src/DemoUI/public/styles.css', 'src/DemoUI/public/app.js',
    'artifacts/dotnet-test-results.txt', 'artifacts/live-fee-matrix-results.txt',
     'artifacts/coverage-test-results.txt',
]
for service in ['PaymentService', 'RiskService', 'NotificationService']:
    FILES += [f'src/{service}/{name}' for name in [
        f'{service}.csproj', 'Program.cs', 'Contracts.cs', 'ApplicationLogs.cs', 'packages.lock.json']]

def package(root=ROOT):
    output = root.parent / 'three-team-demo.zip'
    with ZipFile(output, 'w', ZIP_DEFLATED) as archive:
        for relative in FILES:
            path = root / relative
            if (any(part.startswith('.env') for part in Path(relative).parts)
                or path.is_symlink() or not path.resolve().is_relative_to(root.resolve())):
                raise ValueError('Unsafe package entry refused')
            if path.is_file():
                archive.write(path, 'three-team-demo/' + relative)
    with ZipFile(output) as archive:
        if archive.testzip() is not None:
            raise ValueError('Archive integrity check failed')
        if any(any(part.startswith('.env') or part in ['bin', 'obj', 'node_modules']
                   for part in Path(name).parts) for name in archive.namelist()):
            raise ValueError('Generated dependencies or credential filename in archive')
    return output

if __name__ == '__main__':
    print(package())
