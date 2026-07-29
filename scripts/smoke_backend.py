import argparse
import os
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
from pathlib import Path


def get(url, token=None):
    request = urllib.request.Request(url)
    if token:
        request.add_header('Authorization', 'Bearer ' + token)
    with urllib.request.urlopen(request, timeout=2) as response:
        return response.status, response.read().decode('utf-8')


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--executable', required=True)
    parser.add_argument('--port', type=int, default=8876)
    args = parser.parse_args()
    data_dir = Path(tempfile.mkdtemp(prefix='ai-worklog-smoke-'))
    token = 'smoke-token'
    env = os.environ.copy()
    env.update({'WORKLOG_DATA_DIR': str(data_dir), 'WORKLOG_SESSION_TOKEN': token, 'WORKLOG_PORT': str(args.port)})
    process = subprocess.Popen([args.executable], env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    try:
        health = None
        for _ in range(40):
            try:
                health = get('http://127.0.0.1:%d/health' % args.port)
                break
            except Exception:
                if process.poll() is not None:
                    raise RuntimeError('backend exited before health check')
                time.sleep(0.25)
        if not health or health[0] != 200 or '"status":"ok"' not in health[1].replace(' ', ''):
            raise RuntimeError('health check failed')
        try:
            get('http://127.0.0.1:%d/projects' % args.port)
        except urllib.error.HTTPError as error:
            if error.code != 401:
                raise
        else:
            raise RuntimeError('token validation did not reject an unauthenticated request')
        if not (data_dir / 'worklog.db').exists():
            raise RuntimeError('database was not created under WORKLOG_DATA_DIR')
        print('PACKAGED_BACKEND_SMOKE=PASS')
        print('HEALTH=PASS')
        print('TOKEN_CHECK=PASS')
        print('USER_DATA_DIR=PASS')
    finally:
        if os.name == 'nt':
            subprocess.call(['taskkill', '/F', '/T', '/PID', str(process.pid)], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            subprocess.call(['taskkill', '/F', '/IM', os.path.basename(args.executable)], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            executable_path = str(Path(args.executable).resolve()).replace("'", "''")
            subprocess.call(['powershell.exe', '-NoProfile', '-Command', "Get-Process ai-worklog-server -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq '%s' } | Stop-Process -Force" % executable_path], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        else:
            process.kill()
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait()
        shutil.rmtree(str(data_dir), ignore_errors=True)


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print('PACKAGED_BACKEND_SMOKE=FAIL: %s' % error, file=sys.stderr)
        sys.exit(1)
