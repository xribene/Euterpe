/**
 * A plain static file server with the cross-origin isolation headers, standing in for Netlify / Vercel /
 * GitHub Pages + headers: serves a build (dist/) without Vite. Used by `euterpe smoke --build`.
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const TYPES = {
    '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css',
    '.json': 'application/json', '.wasm': 'application/wasm', '.svg': 'image/svg+xml', '.png': 'image/png',
    '.ico': 'image/x-icon', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.woff': 'font/woff', '.woff2': 'font/woff2',
    '.ttf': 'font/ttf', '.eot': 'application/vnd.ms-fontobject', '.onnx': 'application/octet-stream',
    '.bin': 'application/octet-stream',
};

/**
 * @param {string} dir - The directory to serve.
 * @param {number} [port=0] - 0: any free port.
 * @return {Promise<{url: string, close: () => Promise<void>}>}
 */
export function serveStatic(dir, port = 0) {
    const root = path.resolve(dir);
    const server = http.createServer((req, res) => {
        const url = decodeURIComponent(req.url.split('?')[0]);
        let file = path.join(root, url);
        if (!file.startsWith(root)) {
            res.writeHead(403).end();
            return;
        }
        if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
        if (!fs.existsSync(file)) {
            res.writeHead(404).end('not found');
            return;
        }
        res.writeHead(200, {
            'Content-Type': TYPES[path.extname(file)] ?? 'application/octet-stream',
            'Cross-Origin-Opener-Policy': 'same-origin',
            'Cross-Origin-Embedder-Policy': 'require-corp',
        });
        fs.createReadStream(file).pipe(res);
    });
    return new Promise((resolve) => server.listen(port, () => resolve({
        url: `http://localhost:${server.address().port}/`,
        close: () => new Promise((done) => server.close(done)),
    })));
}
