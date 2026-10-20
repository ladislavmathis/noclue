import { createServer, type Server } from 'node:http';
import { WebSocketServer, type WebSocket } from 'ws';
import { connectHub, type HubConfig } from '../../packages/core/src/hub';

/**
 * Browser tests only. Serves the production hub (packages/core) over a localhost WebSocket so
 * the test build of the extension (npm run build:test) can run real tab capture, VAD and PCM
 * against injected fake AI providers. Production builds run the same hub inside the page.
 */
export async function buildApp(config: Omit<HubConfig, 'configured'> & { configured?: boolean }) {
  let server: Server | undefined;
  let wss: WebSocketServer | undefined;
  const sockets = new Set<WebSocket>();
  return {
    async listen({ host, port }: { host: string; port: number }) {
      server = createServer((_req, res) => {
        res.statusCode = 404;
        res.end();
      });
      wss = new WebSocketServer({ server, path: '/session', maxPayload: 65536 });
      wss.on('connection', (socket) => {
        sockets.add(socket);
        const connection = connectHub(
          { configured: true, ...config },
          {
            send: (event) => {
              if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(event));
            },
            close: (code, reason) => socket.close(code, reason),
          },
        );
        socket.on('message', (raw, binary) => {
          const data = binary ? new Uint8Array(raw as Buffer) : (raw as Buffer).toString();
          connection.receive(data);
        });
        socket.on('close', () => {
          sockets.delete(socket);
          connection.closed();
        });
        socket.on('error', () => connection.closed());
      });
      await new Promise<void>((resolve, reject) => {
        server!.once('error', reject);
        server!.listen(port, host, () => resolve());
      });
    },
    async close() {
      for (const socket of sockets) socket.terminate();
      await new Promise<void>((resolve) => (wss ? wss.close(() => resolve()) : resolve()));
      await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
    },
  };
}
