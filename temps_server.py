#!/usr/bin/env python3
"""Serves ai-rig temps/fans as JSON on 0.0.0.0:8788 (LAN only, no auth)."""
import json
import re
import subprocess
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


def run(cmd):
    try:
        return subprocess.run(
            cmd, capture_output=True, text=True, timeout=5, check=False
        ).stdout
    except Exception:
        return ""


def collect():
    temps = []
    fans = []
    seen = set()

    def add_temp(label, value):
        if label not in seen:
            seen.add(label)
            temps.append({"label": label, "value": value, "unit": "°C"})

    out = run(["sensors"])
    for line in out.splitlines():
        m = re.match(r"^\s*(\S[^:]*):\s+([+-]?\d+\.?\d*)°C", line)
        if m:
            name, val = m.group(1).strip(), float(m.group(2))
            if name == "Tctl":
                add_temp("CPU", val)
            elif name in ("VRM_E", "VRM_W"):
                add_temp(name, val)
            elif name.startswith("Composite"):
                add_temp("NVMe", val)
        m = re.match(r"^\s*(USB4|M\.2):\s+(\d+)\s*RPM", line)
        if m and int(m.group(2)) > 0:
            fans.append(
                {"label": m.group(1), "value": int(m.group(2)), "unit": "RPM"}
            )
    out = run(
        [
            "nvidia-smi",
            "--query-gpu=temperature.gpu,fan.speed,utilization.gpu",
            "--format=csv,noheader,nounits",
        ]
    ).strip()
    if out:
        parts = [p.strip() for p in out.split(",")]
        if len(parts) >= 3 and parts[0] != "[N/A]":
            add_temp("GPU", float(parts[0]))
            try:
                fans.append(
                    {"label": "GPU", "value": int(parts[1]), "unit": "%"}
                )
            except ValueError:
                pass
    return temps, fans


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        temps, fans = collect()
        body = json.dumps(
            {"host": "ai-rig", "ts": time.time(), "temps": temps, "fans": fans}
        ).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args):
        pass


if __name__ == "__main__":
    ThreadingHTTPServer(("0.0.0.0", 8788), Handler).serve_forever()
