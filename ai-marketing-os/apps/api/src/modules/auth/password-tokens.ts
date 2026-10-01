import type { Tx } from '../../db/pool';
import { generateToken, hashToken } from '../../security/tokens';

export type TokenPurpose = 'invite' | 'reset';

/**
 * Cria um token de uso único e invalida os anteriores do mesmo propósito.
 * Deve rodar em escopo 'system'. Devolve o token em claro (só para o e-mail).
 */
export async function issuePasswordToken(tx: Tx, userId: string, purpose: TokenPurpose, ttlMs: number): Promise<string> {
  await tx.query(
    `UPDATE password_tokens SET used_at = now() WHERE user_id = $1 AND purpose = $2 AND used_at IS NULL`,
    [userId, purpose],
  );
  const token = generateToken();
  await tx.query(
    `INSERT INTO password_tokens (user_id, token_hash, purpose, expires_at) VALUES ($1, $2, $3, $4)`,
    [userId, hashToken(token), purpose, new Date(Date.now() + ttlMs)],
  );
  return token;
}

/** Consome o token (atomicamente). Retorna o usuário ou null se inválido/expirado/usado. */
export async function consumePasswordToken(tx: Tx, token: string): Promise<{ userId: string; purpose: TokenPurpose } | null> {
  const row = (
    await tx.query<{ user_id: string; purpose: TokenPurpose }>(
      `UPDATE password_tokens SET used_at = now()
        WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now()
        RETURNING user_id, purpose`,
      [hashToken(token)],
    )
  ).rows[0];
  return row ? { userId: row.user_id, purpose: row.purpose } : null;
}
