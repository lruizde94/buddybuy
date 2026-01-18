"""
Servidor proxy local para Mercadona Productos
Ejecutar con: python server.py
"""

import http.server
import socketserver
import urllib.request
import urllib.error
import json
from urllib.parse import urlparse
import os

PORT = 3000
MERCADONA_API = "https://tienda.mercadona.es"

class ProxyHandler(http.server.SimpleHTTPRequestHandler):
    
    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()
    
    def do_GET(self):
        # Proxy API requests to Mercadona
        if self.path.startswith('/api/'):
            self.proxy_request()
        else:
            # Serve static files
            super().do_GET()
    
    def proxy_request(self):
        api_url = f"{MERCADONA_API}{self.path}"
        
        try:
            headers = {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'Accept': 'application/json',
                'Accept-Language': 'es-ES,es;q=0.9'
            }
            
            req = urllib.request.Request(api_url, headers=headers)
            
            with urllib.request.urlopen(req, timeout=30) as response:
                data = response.read()
                
                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                self.wfile.write(data)
                
        except urllib.error.HTTPError as e:
            self.send_response(e.code)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            self.wfile.write(json.dumps({'error': str(e)}).encode())
            
        except Exception as e:
            self.send_response(500)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            self.wfile.write(json.dumps({'error': str(e)}).encode())
    
    def end_headers(self):
        self.send_header('Cache-Control', 'no-cache')
        super().end_headers()

def main():
    # Change to script directory
    os.chdir(os.path.dirname(os.path.abspath(__file__)))
    
    with socketserver.TCPServer(("", PORT), ProxyHandler) as httpd:
        print(f"""
╔═══════════════════════════════════════════════════════════╗
║                                                           ║
║   🛒 Mercadona Productos - Servidor Local                 ║
║                                                           ║
║   Servidor corriendo en: http://localhost:{PORT}            ║
║                                                           ║
║   Presiona Ctrl+C para detener el servidor                ║
║                                                           ║
╚═══════════════════════════════════════════════════════════╝
        """)
        
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nServidor detenido.")

if __name__ == "__main__":
    main()
