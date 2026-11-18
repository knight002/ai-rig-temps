#!/usr/bin/env python3
"""Background poller for the ai-rig temps endpoint.

Polls http://<host>:<port>/temps every INTERVAL seconds in its OWN
process (so a slow/dead rig can never block the GNOME Shell main loop)
and writes the latest result to a local cache file. The GNOME Shell
extension reads that file each tick.

On failure the file is left untouched, so the extension keeps showing
the last good value until it goes stale.
"""
import json
import os
import time
import urllib.request

HOST = os.environ.get("AI_RIG_HOST", "192.168.0.74")
PORT = int(os.environ.get("AI_RIG_PORT", "8788"))
INTERVAL = float(os.environ.get("AI_RIG_INTERVAL", "2.0"))
TIMEOUT = float(os.environ.get("AI_RIG_TIMEOUT", "2.0"))
OUT = os.path.expanduser(
    os.environ.get("AI_RIG_TEMPS_OUT", "~/.cache/ai-rigtemps/data.json")
)


def poll():
    url = "http://%s:%d/temps" % (HOST, PORT)
    try:
        with urllib.request.urlopen(url, timeout=TIMEOUT) as resp:
            data = json.loads(resp.read().decode())
        data["ts"] = time.time()
        os.makedirs(os.path.dirname(OUT), exist_ok=True)
        tmp = OUT + ".tmp"
        with open(tmp, "w") as f:
            json.dump(data, f)
        os.replace(tmp, OUT)  # atomic swap
    except Exception:
        # keep the last good file; the extension will mark it stale
        pass


def main():
    while True:
        poll()
        time.sleep(INTERVAL)


if __name__ == "__main__":
    main()
