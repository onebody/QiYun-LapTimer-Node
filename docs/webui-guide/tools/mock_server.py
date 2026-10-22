#!/usr/bin/env python3
"""QiYun LapTimer Web UI 文档截图用 mock 服务。

在浏览器里原样跑起 data/ 前端（无需真机）：托管静态文件，模拟固件的
REST/SSE 接口，并提供 /mock/* 控制口注入 RSSI 基值、过门峰值序列与过圈事件。

用法:
    python3 docs/webui-guide/tools/mock_server.py [port]
    # 默认 8765，打开 http://127.0.0.1:8765/

控制口:
    GET /mock/rssi?base=45&jitter=3     设置 RSSI 基值与抖动
    GET /mock/pass?peak=180&steps=12    注入一次"过门"峰值序列（先升后降）
    GET /mock/lap?ms=12500              注入一条过圈事件
    GET /mock/state                     查看当前 mock 状态
"""
import json
import random
import re
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse, parse_qs

ROOT = Path(__file__).resolve().parents[3]
DATA = ROOT / "data"
PORT = 8765

STATE = {
    "rssi_sending": False,
    "base": 45.0,
    "jitter": 3.0,
    "queue": [],          #  scripted rssi values, FIFO
    "laps": [],           #  pending lap events (ms)
    "noise_since": None,  #  timestamp of /calibration/noise/start
    "noise_max": 0,
    "noise_samples": 0,
    "config": {
        "freq": 5865, "minLap": 30, "alarm": 30, "anType": 2, "anRate": 10,
        "enterRssi": 120, "exitRssi": 100, "droneSize": 5, "gateDiameterMm": 2000,
        "calibSamples": 20, "name": "张三", "pilotId": "P001",
        "ssid": "", "pwd": "", "apiAddress": "http://192.168.1.100:8080",
    },
}
LOCK = threading.RLock()  # 可重入：sse_loop 持锁期间会调 next_rssi()
SSE_CLIENTS = []

MIME = {".html": "text/html; charset=utf-8", ".htm": "text/html; charset=utf-8",
        ".js": "application/javascript", ".css": "text/css", ".ico": "image/x-icon",
        ".png": "image/png", ".jpg": "image/jpeg"}


def next_rssi():
    with LOCK:
        if STATE["queue"]:
            v = STATE["queue"].pop(0)
        else:
            v = STATE["base"] + random.uniform(-STATE["jitter"], STATE["jitter"])
        v = max(0, min(255, int(round(v))))
        # 与固件一致：底噪统计取窗口内最大值，脚本注入的过门峰值同样计入
        # （lib/LAPTIMER/laptimer.cpp:83-86），故校准第 3 步峰值恒为 -Infinity
        if STATE["noise_since"] is not None:
            STATE["noise_samples"] += 1
            STATE["noise_max"] = max(STATE["noise_max"], v)
        return v


def sse_loop():
    while True:
        time.sleep(0.2)
        with LOCK:
            sending = STATE["rssi_sending"]
            laps = STATE["laps"][:]
            STATE["laps"].clear()
            rssi = next_rssi() if sending else None
        dead = []
        for i, q in enumerate(SSE_CLIENTS):
            try:
                if rssi is not None:
                    q.put(("rssi", str(rssi)))
                for ms in laps:
                    q.put(("lap", str(ms)))
            except Exception:
                dead.append(i)
        for i in reversed(dead):
            SSE_CLIENTS.pop(i)


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, *a):
        pass

    def _send(self, code, body, ctype="application/json", extra=None):
        if isinstance(body, str):
            body = body.encode()
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(body)

    def _ok(self):
        self._send(200, '{"status": "OK"}')

    def do_POST(self):
        path = urlparse(self.path).path
        length = int(self.headers.get("Content-Length") or 0)
        raw = self.rfile.read(length) if length else b""
        if path == "/config":
            try:
                with LOCK:
                    STATE["config"].update(json.loads(raw or b"{}"))
            except Exception:
                pass
            self._ok()
        elif path == "/timer/rssiStart":
            with LOCK:
                STATE["rssi_sending"] = True
            self._ok()
        elif path == "/timer/rssiStop":
            with LOCK:
                STATE["rssi_sending"] = False
            self._ok()
        elif path == "/calibration/noise/start":
            with LOCK:
                STATE["noise_since"] = time.time()
                STATE["noise_max"] = 0
                STATE["noise_samples"] = 0
            self._ok()
        elif path == "/calibration/noise/stop":
            with LOCK:
                target = STATE["config"].get("calibSamples", 20)
                body = json.dumps({"status": "OK", "maxNoise": STATE["noise_max"],
                                   "samples": max(STATE["noise_samples"], target),
                                   "target": target, "ok": True})
                STATE["noise_since"] = None
            self._send(200, body)
        elif path in ("/update", "/update/fs/single"):
            self._ok()
        else:
            self._ok()

    def do_GET(self):
        url = urlparse(self.path)
        path = url.path
        qs = parse_qs(url.query)

        if path == "/mock/rssi":
            with LOCK:
                STATE["base"] = float(qs.get("base", [STATE["base"]])[0])
                STATE["jitter"] = float(qs.get("jitter", [STATE["jitter"]])[0])
            return self._ok()
        if path == "/mock/pass":
            peak = float(qs.get("peak", [180])[0])
            steps = int(qs.get("steps", [12])[0])
            with LOCK:
                base = STATE["base"]
                half = steps // 2
                seq = [base + (peak - base) * (i + 1) / half for i in range(half)]
                seq += [peak - (peak - base) * (i + 1) / (steps - half) for i in range(steps - half)]
                STATE["queue"].extend(seq)
            return self._ok()
        if path == "/mock/lap":
            with LOCK:
                STATE["laps"].append(int(qs.get("ms", [12500])[0]))
            return self._ok()
        if path == "/mock/state":
            with LOCK:
                return self._send(200, json.dumps(STATE, default=str))

        if path == "/events":
            import queue as _q
            q = _q.Queue()
            SSE_CLIENTS.append(q)
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream")
            self.send_header("Cache-Control", "no-cache")
            self.send_header("Connection", "keep-alive")
            self.end_headers()
            self.wfile.write(b"event: start\ndata: start\n\n")
            try:
                while True:
                    ev, data = q.get(timeout=30)
                    self.wfile.write(f"event: {ev}\ndata: {data}\n\n".encode())
                    self.wfile.flush()
            except Exception:
                pass
            return

        if path == "/version":
            return self._send(200, '{"version":"1.0.9","filesystemVersion":"1.0.7"}')
        if path == "/config":
            with LOCK:
                return self._send(200, json.dumps(STATE["config"]))
        if path == "/status":
            return self._send(200, "Heap:\n\tFree:\t120000\nFirmware:\n\tVersion:\t1.0.9(mock)\n",
                              "text/plain")
        if path == "/update":
            return self._file(DATA / "update" / "index.htm")
        if path in ("/", "/generate_204", "/gen_204", "/hotspot-detect.html",
                    "/connectivity-check.html", "/fwlink", "/ncsi.txt", "/success.txt"):
            return self._file(DATA / "index.html")

        rel = path.lstrip("/")
        target = (DATA / rel).resolve()
        if not str(target).startswith(str(DATA.resolve())) or not target.is_file():
            return self._send(404, '{"status":"FAIL"}')
        return self._file(target)

    def _file(self, target: Path):
        if not target.is_file():
            return self._send(404, "not found", "text/plain")
        body = target.read_bytes()
        self._send(200, body, MIME.get(target.suffix, "application/octet-stream"),
                   {"Cache-Control": "max-age=600"})


if __name__ == "__main__":
    import sys
    port = int(sys.argv[1]) if len(sys.argv) > 1 else PORT
    threading.Thread(target=sse_loop, daemon=True).start()
    print(f"mock server on http://127.0.0.1:{port}/  (data dir: {DATA})")
    ThreadingHTTPServer(("127.0.0.1", port), Handler).serve_forever()
