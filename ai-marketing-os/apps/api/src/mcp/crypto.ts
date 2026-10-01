import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/**
 * Credenciais de integração cifradas com AES-256-GCM. A chave vem do
 * ambiente (CREDENTIALS_KEY), nunca do banco. O AAD amarra o texto cifrado
 * ao tenant e à conexão: copiar o segredo para outra linha não o decifra.
 */
export class CredentialVault {
  private readonly key: Buffer | null;

  constructor(hexKey: string | undefined) {
    this.key = hexKey ? Buffer.from(hexKey, 'hex') : null;
  }

  get configured(): boolean {
    return this.key !== null;
  }

  private aad(tenantId: string, connectionId: string) {
    return Buffer.from(`mcp:${tenantId}:${connectionId}`);
  }

  encrypt(secrets: Record<string, string>, tenantId: string, connectionId: string): string {
    if (!this.key) throw new Error('CREDENTIALS_KEY não configurada');
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    cipher.setAAD(this.aad(tenantId, connectionId));
    const ct = Buffer.concat([cipher.update(JSON.stringify(secrets), 'utf8'), cipher.final()]);
    return `v1.${iv.toString('base64')}.${cipher.getAuthTag().toString('base64')}.${ct.toString('base64')}`;
  }

  decrypt(payload: string, tenantId: string, connectionId: string): Record<string, string> {
    if (!this.key) throw new Error('CREDENTIALS_KEY não configurada');
    const [v, iv, tag, ct] = payload.split('.');
    if (v !== 'v1' || !iv || !tag || !ct) throw new Error('credencial em formato desconhecido');
    const decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(iv, 'base64'));
    decipher.setAAD(this.aad(tenantId, connectionId));
    decipher.setAuthTag(Buffer.from(tag, 'base64'));
    const pt = Buffer.concat([decipher.update(Buffer.from(ct, 'base64')), decipher.final()]);
    return JSON.parse(pt.toString('utf8')) as Record<string, string>;
  }
}
