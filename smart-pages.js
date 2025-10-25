const fs = require('fs');
const path = require('path');
const url = require('url');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

function send(res, code, headers, body) {
  res.writeHead(code, headers);
  res.end(body);
}

function serveFile(res, filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const type = MIME[ext] || 'application/octet-stream';
  fs.readFile(filePath, (err, data) => {
    if (err) {
      return send(res, 404, { 'Content-Type': 'text/plain; charset=utf-8', 'Access-Control-Allow-Origin': '*' }, 'Not found');
    }
    send(res, 200, { 'Content-Type': type, 'Access-Control-Allow-Origin': '*' }, data);
  });
}

function handle(req, res) {
  const urlObj = url.parse(req.url, true);
  const pathname = decodeURIComponent(urlObj.pathname || '/');

  // 根目錄導向登入頁
  if (pathname === '/') {
    return serveFile(res, path.join(process.cwd(), 'login.html'));
  }

  // 登入頁
  if (pathname === '/login.html') {
    return serveFile(res, path.join(process.cwd(), 'login.html'));
  }

  // 回呼頁（public 目錄）
  if (pathname === '/callback.html') {
    return serveFile(res, path.join(process.cwd(), 'public', 'callback.html'));
  }

  // 選擇用戶頁
  if (pathname === '/select-user.html') {
    return serveFile(res, path.join(process.cwd(), 'select-user.html'));
  }

  // 其他靜態資產（/public/...）
  if (pathname.startsWith('/public/')) {
    return serveFile(res, path.join(process.cwd(), pathname));
  }

  // 其他根目錄檔案（例如 /clinic-dashboard.html）
  if (pathname.startsWith('/')) {
    const candidate = path.join(process.cwd(), pathname.replace(/^\/+/, ''));
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      return serveFile(res, candidate);
    }
  }

  // 其他沒命中 → 404
  return send(res, 404, { 'Access-Control-Allow-Origin': '*' }, 'Not found');
}

module.exports = { handle };
