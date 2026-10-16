"""Probe server for the hosted Always on cost probe: GET /run runs one engine search on the empty fixture state and returns its measured cost basis as JSON."""
import json
import os
import re
import subprocess
import time
from http.server import BaseHTTPRequestHandler, HTTPServer

WORK = '/work/app'


def net_bytes():
    """(received, sent) bytes on eth0 so far: what the run read from boards and what left the container (egress is what Cloudflare bills)."""
    for line in open('/proc/net/dev').read().splitlines():
        if line.strip().startswith('eth0:'):
            fields = line.split(':')[1].split()
            return int(fields[0]), int(fields[8])
    return 0, 0


def cgroup_number(name):
    try:
        return int(open(f'/sys/fs/cgroup/{name}').read().strip())
    except (OSError, ValueError):
        return None


def one_run():
    os.makedirs(WORK, exist_ok=True)
    rx0, tx0 = net_bytes()
    started = time.time()
    done = subprocess.run(['/usr/bin/time', '-v', 'python', '-m', 'src', 'daily', '--mode', 'scheduled', '--db', f'{WORK}/jobs.sqlite'],
                          capture_output=True, text=True, timeout=900)
    wall = time.time() - started
    rx1, tx1 = net_bytes()
    stats = done.stderr
    grab = lambda pattern: (re.search(pattern, stats) or [None, None])[1]
    return {
        'exit': done.returncode,
        'wall_s': round(wall, 1),
        'user_cpu_s': float(grab(r'User time \(seconds\): ([\d.]+)') or 0),
        'system_cpu_s': float(grab(r'System time \(seconds\): ([\d.]+)') or 0),
        'max_rss_kb': int(grab(r'Maximum resident set size \(kbytes\): (\d+)') or 0),
        'cgroup_memory_peak_bytes': cgroup_number('memory.peak'),
        'net_received_bytes': rx1 - rx0,
        'net_sent_bytes': tx1 - tx0,
        'tail': done.stdout.strip().splitlines()[-3:],
    }


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path != '/run':
            self.send_response(404)
            self.end_headers()
            return
        body = json.dumps(one_run()).encode()
        self.send_response(200)
        self.send_header('content-type', 'application/json')
        self.end_headers()
        self.wfile.write(body)


if __name__ == '__main__':
    HTTPServer(('0.0.0.0', 8080), Handler).serve_forever()
