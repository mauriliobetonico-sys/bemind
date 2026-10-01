import { connect } from 'node:net';
import type { Readable } from 'node:stream';

export type ScanResult = { status: 'clean' } | { status: 'infected'; signature: string };

/**
 * Cliente mínimo do protocolo INSTREAM do clamd (ClamAV).
 * Envia o arquivo em blocos [tamanho uint32 BE][dados] e termina com 0.
 */
export function scanStream(host: string, port: number, source: Readable, timeoutMs = 120_000): Promise<ScanResult> {
  return new Promise((resolve, reject) => {
    const socket = connect({ host, port });
    let response = '';
    const fail = (err: Error) => {
      socket.destroy();
      reject(err);
    };
    socket.setTimeout(timeoutMs, () => fail(new Error('timeout do ClamAV')));
    socket.on('error', fail);
    socket.on('data', (d) => (response += d.toString('utf8')));
    socket.on('end', () => {
      const line = response.replace(/\0/g, '').trim();
      if (/:\s*OK$/.test(line)) return resolve({ status: 'clean' });
      const found = line.match(/:\s*(.+)\s+FOUND$/);
      if (found) return resolve({ status: 'infected', signature: found[1]! });
      reject(new Error(`resposta inesperada do ClamAV: ${line.slice(0, 200)}`));
    });
    socket.on('connect', () => {
      socket.write('zINSTREAM\0');
      source.on('data', (chunk: Buffer) => {
        const len = Buffer.alloc(4);
        len.writeUInt32BE(chunk.length);
        if (!socket.write(Buffer.concat([len, chunk]))) {
          source.pause();
          socket.once('drain', () => source.resume());
        }
      });
      source.on('end', () => socket.write(Buffer.alloc(4)));
      source.on('error', fail);
    });
  });
}
