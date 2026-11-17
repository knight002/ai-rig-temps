# ai-rig temps widget

Live temperature + fan-speed widget on this laptop, showing the
**ai-rig (192.168.0.74)**.

## How it works

```
[ai-rig :8788]  temps_server.py   ──HTTP JSON──▶   ai-rigtemps@a.local  (this laptop)
 polls sensors/nvidia-smi                              GNOME Shell extension in the top bar
```

Two parts:

1. **Server** — runs on the ai-rig as a systemd **user** service
   `temps-server.service` (enabled + linger, so it survives logout).
   Serves `GET /temps` on `0.0.0.0:8788`.
2. **Widget** — a GNOME Shell extension (`ai-rigtemps@a.local`) that
   places a compact temperature read-out in the **top bar**, to the
   left of the system icons. Refreshes every 2 s. Clicking it opens a
   menu with the full list (all temps + all fans).

> The earlier GTK3 floating-bar version (`temps_widget.py`) was replaced
> by the shell extension because a separate window can only float over
> the panel, never sit inside it, and kept getting covered by the dock.
> It is kept for reference only.

## Repo layout

| Path                          | What                                  | Runs on |
|-------------------------------|---------------------------------------|---------|
| `temps_server.py`             | JSON server (polled from the widget)  | ai-rig  |
| `extension/ai-rigtemps@a.local/` | GNOME Shell extension (widget)    | laptop  |
| `extension/install.sh`        | copies the extension to `~/.local/share` + enables it | laptop |
| `temps_widget.py`             | (legacy) GTK3 bar widget — superseded | laptop  |

## Install / update

On the **ai-rig** (one-time):
```
# server is a user systemd service; make sure it's up
ssh ai-rig 'systemctl --user enable --now temps-server.service'
ssh ai-rig 'systemctl --user status temps-server.service'
```
The server file lives at `~/workspace/ubuntu-temps/temps_server.py` on
the ai-rig. Re-deploy it from this repo if you change it:
```
scp temps_server.py ai-rig:~/workspace/ubuntu-temps/temps_server.py
ssh ai-rig 'systemctl --user restart temps-server.service'
```

On the **laptop** (widget):
```
./extension/install.sh
```
Then **log out and back in** (a GNOME Shell restart) so the extension
loads. To re-enable after a shell restart without re-installing:
```
gnome-extensions enable ai-rigtemps@a.local
```

## Verifying the data path

```
curl http://192.168.0.74:8788/temps | python3 -m json.tool
ssh ai-rig 'nvidia-smi --query-gpu=temperature.gpu,fan.speed --format=csv,noheader,nounits'
```

The endpoint returns:
```json
{"host":"ai-rig","ts":…,"temps":[…],"fans":[…]}
```

## Colors / layout

- Bar (compact): `CPU …°  GPU …°  VRM …°`  →  leftmost in the right
  box, before the system icons/clock.
- Menu (full): every temp (`CPU`, `VRM_E`, `VRM_W`, `NVMe`, `GPU`) and
  every fan (`USB4`, `M.2`, `GPU`).
- Temp: `<65` green, `65–79` orange, `≥80` red. Fans: blue. GPU fan
  shown as `%`.
- If the rig is unreachable the bar shows a red **OFFLINE** badge and
  the menu is empty.

## Firewall

`ufw` on the ai-rig allows `tcp 8788` from `192.168.0.0/24`.

## Troubleshooting

- **Widget shows dots / stale value** — the extension failed to load.
  Check:
  ```
  journalctl --user --no-pager | grep -i ai-rigtemps
  ```
  and re-run `./extension/install.sh` + log out/in.
- **`gnome-extensions show ai-rigtemps@a.local` → State: ERROR** —
  log out/in; the running shell cached the old module.
- **Server not responding** — `ssh ai-rig 'systemctl --user status
  temps-server.service'` and `curl http://127.0.0.1:8788/temps` on the
  ai-rig to separate network from local issues.
