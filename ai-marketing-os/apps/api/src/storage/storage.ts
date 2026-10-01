import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, rename, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { Transform, type Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class FileTooLargeError extends Error {
  constructor(readonly limitBytes: number) {
    super('Arquivo maior que o limite permitido');
  }
}

export interface StoredObject {
  sizeBytes: number;
  sha256: string;
}

/**
 * Armazenamento em disco (volume), isolado por tenant: tenants/{tenantId}/{fileId}.
 * O nome original do arquivo NUNCA entra no caminho. Os IDs são validados
 * como UUID para impedir path traversal. A autorização acontece antes, na API:
 * não existe URL pública para estes arquivos.
 */
export class LocalStorage {
  constructor(private readonly root: string) {}

  /** Caminho local (usado para detecção de tipo e varredura). */
  localPath(tenantId: string, fileId: string): string {
    return this.pathFor(tenantId, fileId);
  }

  private pathFor(tenantId: string, fileId: string): string {
    if (!UUID_RE.test(tenantId) || !UUID_RE.test(fileId)) throw new Error('identificador inválido para o storage');
    return path.join(path.resolve(this.root), 'tenants', tenantId.toLowerCase(), fileId.toLowerCase());
  }

  /** Grava o stream calculando tamanho e SHA-256; aborta e apaga se exceder o limite. */
  async put(tenantId: string, fileId: string, source: Readable, maxBytes: number): Promise<StoredObject> {
    const finalPath = this.pathFor(tenantId, fileId);
    const tmpPath = `${finalPath}.uploading`;
    await mkdir(path.dirname(finalPath), { recursive: true, mode: 0o750 });

    const hash = createHash('sha256');
    let size = 0;
    const meter = new Transform({
      transform(chunk: Buffer, _enc, cb) {
        size += chunk.length;
        if (size > maxBytes) return cb(new FileTooLargeError(maxBytes));
        hash.update(chunk);
        cb(null, chunk);
      },
    });
    try {
      await pipeline(source, meter, createWriteStream(tmpPath, { mode: 0o640 }));
      // @fastify/multipart sinaliza truncamento em vez de lançar erro.
      if ((source as Readable & { truncated?: boolean }).truncated) throw new FileTooLargeError(maxBytes);
      await rename(tmpPath, finalPath);
    } catch (err) {
      await rm(tmpPath, { force: true });
      throw err;
    }
    return { sizeBytes: size, sha256: hash.digest('hex') };
  }

  open(tenantId: string, fileId: string): Readable {
    return createReadStream(this.pathFor(tenantId, fileId));
  }

  async exists(tenantId: string, fileId: string): Promise<boolean> {
    return stat(this.pathFor(tenantId, fileId)).then(
      () => true,
      () => false,
    );
  }

  async remove(tenantId: string, fileId: string): Promise<void> {
    await rm(this.pathFor(tenantId, fileId), { force: true });
  }
}
