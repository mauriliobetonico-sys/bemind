/**
 * VisãoOS — Servidor WebSocket para atualizações em tempo real
 *
 * Clientes (browser) conectam via WS e recebem eventos.
 * O PHP faz POST em /broadcast para enviar eventos a todos os clientes.
 */

require('dotenv').config({ path: '../visaoos/.env' });

const WebSocket = require('ws');
const express   = require('express');
const http      = require('http');

const PORT      = process.env.WS_PORT   || 6001;
const WS_SECRET = process.env.WS_SECRET || process.env.JWT_SECRET || 'visaoos_ws_secret';

const app    = express();
app.use(express.json());

const server = http.createServer(app);
const wss    = new WebSocket.Server({ server, path: '/ws' });

// ── Clientes conectados, indexados por role ───────────────────────────────
const clients = new Map(); // ws → { userId, role, authenticated }

wss.on('connection', (ws, req) => {
    const clientIp = req.socket.remoteAddress;
    clients.set(ws, { userId: null, role: null, authenticated: false, ip: clientIp });

    console.log(`[WS] Nova conexão de ${clientIp} | Total: ${clients.size}`);

    // Timeout de autenticação (5s)
    const authTimeout = setTimeout(() => {
        if (!clients.get(ws)?.authenticated) {
            ws.close(4001, 'Authentication timeout');
        }
    }, 5000);

    ws.on('message', (data) => {
        try {
            const msg = JSON.parse(data.toString());

            // Autenticação: cliente envia { type: 'auth', token: '<jwt>' }
            if (msg.type === 'auth') {
                const payload = verifyJWT(msg.token);
                if (payload) {
                    clearTimeout(authTimeout);
                    clients.set(ws, {
                        userId:        payload.sub,
                        role:          payload.role,
                        authenticated: true,
                        ip:            clientIp,
                    });
                    ws.send(JSON.stringify({ type: 'auth', status: 'ok', role: payload.role }));
                    console.log(`[WS] Autenticado: user=${payload.sub} role=${payload.role}`);
                } else {
                    ws.send(JSON.stringify({ type: 'auth', status: 'error', message: 'Token inválido' }));
                    ws.close(4001, 'Invalid token');
                }
                return;
            }

            // Ping/pong para manter conexão viva
            if (msg.type === 'ping') {
                ws.send(JSON.stringify({ type: 'pong', ts: Date.now() }));
            }

        } catch {
            // ignora mensagens inválidas
        }
    });

    ws.on('close', () => {
        clients.delete(ws);
        console.log(`[WS] Desconectado. Total: ${clients.size}`);
    });

    ws.on('error', (err) => {
        console.error('[WS] Erro:', err.message);
        clients.delete(ws);
    });

    // Envia mensagem de boas-vindas
    ws.send(JSON.stringify({ type: 'welcome', message: 'VisãoOS WebSocket v2.0', ts: Date.now() }));
});

// ── Endpoint HTTP para o PHP enviar eventos ───────────────────────────────
app.post('/broadcast', (req, res) => {
    const { event, data, secret, roles } = req.body;

    if (secret !== WS_SECRET) {
        return res.status(401).json({ error: 'Acesso negado.' });
    }

    const payload = JSON.stringify({ type: 'event', event, data, ts: Date.now() });
    let count = 0;

    clients.forEach((info, ws) => {
        if (!info.authenticated) return;
        if (ws.readyState !== WebSocket.OPEN) return;
        // Filtra por role se especificado
        if (roles && roles.length > 0 && !roles.includes(info.role)) return;
        ws.send(payload);
        count++;
    });

    console.log(`[WS] Evento "${event}" → ${count} cliente(s)`);
    res.json({ sent: count, event });
});

// ── Status ────────────────────────────────────────────────────────────────
app.get('/status', (req, res) => {
    const byRole = {};
    clients.forEach((info) => {
        if (!info.authenticated) return;
        byRole[info.role] = (byRole[info.role] || 0) + 1;
    });
    res.json({
        status:      'ok',
        clients:     clients.size,
        byRole,
        uptime:      process.uptime(),
        memory:      process.memoryUsage().heapUsed,
        ts:          new Date().toISOString(),
    });
});

// ── JWT verification (HS256, sem biblioteca) ──────────────────────────────
const crypto = require('crypto');
function verifyJWT(token) {
    try {
        const parts = token.split('.');
        if (parts.length !== 3) return null;
        const [header, payload, sig] = parts;
        const expected = crypto
            .createHmac('sha256', WS_SECRET)
            .update(`${header}.${payload}`)
            .digest('base64url');
        if (expected !== sig) return null;
        const data = JSON.parse(Buffer.from(payload, 'base64url').toString());
        if (!data || data.exp < Math.floor(Date.now() / 1000)) return null;
        return data;
    } catch {
        return null;
    }
}

// ── Heartbeat para limpar conexões mortas ─────────────────────────────────
setInterval(() => {
    clients.forEach((info, ws) => {
        if (ws.readyState !== WebSocket.OPEN) {
            clients.delete(ws);
        }
    });
}, 30000);

server.listen(PORT, () => {
    console.log(`[WS] VisãoOS WebSocket Server rodando na porta ${PORT}`);
    console.log(`[WS] Endpoint HTTP para broadcast: POST http://localhost:${PORT}/broadcast`);
});
