#!/usr/bin/env python3
"""Serves ai-rig temps/fans/usage as JSON on 0.0.0.0:8788 (LAN only, no auth)."""
import json
import re
import subprocess
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

GiB = 1024 ** 3
MiB = 1024 ** 2

# previous /proc/stat cpu sample for delta-based CPU% (module scope, shared)
_prev_cpu = None


def run(cmd):
    try:
        return subprocess.run(
            cmd, capture_output=True, text=True, timeout=5, check=False
        ).stdout
    except Exception:
        return ""


def cpu_percent():
    """CPU busy % since the last call (delta of /proc/stat fields)."""
    global _prev_cpu
    try:
        with open("/proc/stat") as f:
            parts = f.readline().split()[1:]
        cur = tuple(int(x) for x in parts)
    except Exception:
        return None
    if _prev_cpu is None:
        _prev_cpu = cur
        return 0.0
    idle_d = cur[3] - _prev_cpu[3]
    total_d = sum(cur) - sum(_prev_cpu)
    _prev_cpu = cur
    if total_d <= 0:
        return 0.0
    return round(100.0 * (1.0 - idle_d / total_d), 1)


def ram_gib():
    """(used_gib, total_gib) from /proc/meminfo."""
    try:
        info = {}
        with open("/proc/meminfo") as f:
            for line in f:
                k, v = line.split(":", 1)
                info[k] = int(v.strip().split()[0]) * 1024  # kB -> bytes
        total = info.get("MemTotal", 0)
        avail = info.get("MemAvailable", info.get("MemFree", 0))
        used = max(0, total - avail)
        return round(used / GiB, 1), round(total / GiB, 1)
    except Exception:
        return None, None


def vram_gib():
    """(used_gib, total_gib) GPU VRAM via nvidia-smi (MiB -> GiB)."""
    try:
        out = run(
            ["nvidia-smi", "--query-gpu=memory.used,memory.total",
             "--format=csv,noheader,nounits"]
        ).strip().split(",")
        used = int(out[0].strip())
        total = int(out[1].strip())
        return round(used * MiB / GiB, 1), round(total * MiB / GiB, 1)
    except Exception:
        return None, None


def gpu_percent():
    """GPU utilization % (busy) via nvidia-smi."""
    try:
        out = run(
            ["nvidia-smi", "--query-gpu=utilization.gpu",
             "--format=csv,noheader,nounits"]
        ).strip()
        if out and out != "[N/A]":
            return int(out.split(",")[0].strip())
    except Exception:
        pass
    return None


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
        ["nvidia-smi",
         "--query-gpu=temperature.gpu,fan.speed,utilization.gpu",
         "--format=csv,noheader,nounits"]
    ).strip()
    if out:
        parts = [p.strip() for p in out.split(",")]
        if len(parts) >= 3 and parts[0] != "[N/A]":
            add_temp("GPU", float(parts[0]))
            try:
                fans.append(
                    {"label": "GPU fan", "value": int(parts[1]), "unit": "%"}
                )
            except ValueError:
                pass
    return temps, fans


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        temps, fans = collect()
        ram_used, ram_total = ram_gib()
        vram_used, vram_total = vram_gib()
        body = json.dumps({
            "host": "ai-rig",
            "ts": time.time(),
            "temps": temps,
            "fans": fans,
            "cpu_percent": cpu_percent(),
            "gpu_percent": gpu_percent(),
            "ram_used_gib": ram_used,
            "ram_total_gib": ram_total,
            "vram_used_gib": vram_used,
            "vram_total_gib": vram_total,
        }).encode()
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
