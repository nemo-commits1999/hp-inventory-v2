"""HP Inventory Pro - server lokal mini."""
import os
import socket
import subprocess
import webbrowser
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

HOST = "127.0.0.1"
PORT = 8477
APP_DIR = os.path.dirname(os.path.abspath(__file__))
URL = f"http://{HOST}:{PORT}"

EDGE_PATHS = [
    os.path.expandvars(r"%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"),
    os.path.expandvars(r"%ProgramFiles%\Microsoft\Edge\Application\msedge.exe"),
    os.path.expandvars(r"%LocalAppData%\Microsoft\Edge\Application\msedge.exe"),
]


def port_busy():
    s = socket.socket()
    try:
        s.bind((HOST, PORT))
        return False
    except OSError:
        return True
    finally:
        s.close()


def open_in_browser():
    for path in EDGE_PATHS:
        if os.path.isfile(path):
            try:
                subprocess.Popen([path, f"--app={URL}", "--window-size=1280,900"], close_fds=True)
                return "edge-app"
            except OSError:
                pass
    webbrowser.open(URL)
    return "default-browser"


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=APP_DIR, **kwargs)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def log_message(self, fmt, *args):
        pass


def main():
    if port_busy():
        print("Server sudah berjalan - membuka aplikasi...")
        open_in_browser()
        return

    server = ThreadingHTTPServer((HOST, PORT), Handler)
    how = open_in_browser()
    print()
    print("  HP INVENTORY PRO AKTIF")
    print(f"  Alamat aplikasi : {URL}")
    print(f"  Browser         : {'jendela app Edge' if how == 'edge-app' else 'browser bawaan'}")
    print("  Biarkan jendela hitam ini terbuka selama aplikasi dipakai.")
    print()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
        print("Aplikasi dimatikan. Sampai jumpa!")


if __name__ == "__main__":
    main()















































































































































































































































































