// Minimal git smart-HTTP server backed by the system git binary. Test-only:
// lets gitSync.cjs exercise its real clone/fetch/push paths against a local
// bare repo without touching GitHub.
const http = require('http');
const path = require('path');
const { spawn } = require('child_process');

function createGitHttpServer(repoRoot) {
  return http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const m = url.pathname.match(/^\/(.+)\/(info\/refs|git-upload-pack|git-receive-pack)$/);
    if (!m) {
      res.statusCode = 404;
      res.end();
      return;
    }
    const repoDir = path.join(repoRoot, ...m[1].split('/'));
    if (m[2] === 'info/refs') {
      const service = url.searchParams.get('service');
      if (service !== 'git-upload-pack' && service !== 'git-receive-pack') {
        res.statusCode = 400;
        res.end();
        return;
      }
      res.writeHead(200, { 'content-type': `application/x-${service}-advertisement` });
      const header = `# service=${service}\n`;
      res.write((header.length + 4).toString(16).padStart(4, '0') + header + '0000');
      const child = spawn('git', [service.replace('git-', ''), '--stateless-rpc', '--advertise-refs', repoDir]);
      child.stdout.pipe(res);
      child.on('error', () => res.end());
    } else {
      res.writeHead(200, { 'content-type': `application/x-${m[2]}-result` });
      const child = spawn('git', [m[2].replace('git-', ''), '--stateless-rpc', repoDir]);
      req.pipe(child.stdin);
      child.stdout.pipe(res);
      child.on('error', () => res.end());
    }
  });
}

module.exports = { createGitHttpServer };
