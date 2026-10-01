import pg from 'pg';
import { z } from 'zod';
import { emailSchema } from '@aimos/shared';
import { generateToken, hashToken } from '../security/tokens';

/**
 * Cria (ou reconvida) o primeiro SUPER_ADMIN e imprime um link de uso único
 * para definição de senha. Nenhuma senha é gerada ou exibida.
 *
 *   SEED_ADMIN_EMAIL=voce@agencia.com SEED_ADMIN_NAME="Maurílio" pnpm seed:admin
 */
const input = z
  .object({
    SEED_ADMIN_EMAIL: emailSchema,
    SEED_ADMIN_NAME: z.string().trim().min(2),
    DATABASE_ADMIN_URL: z.string().min(1),
    APP_URL: z.url(),
  })
  .parse(process.env);

const client = new pg.Client({ connectionString: input.DATABASE_ADMIN_URL });
await client.connect();
try {
  await client.query('BEGIN');
  const user = (
    await client.query<{ id: string; status: string }>(
      `INSERT INTO users (email, name, global_role, status) VALUES ($1, $2, 'SUPER_ADMIN', 'invited')
       ON CONFLICT (email) DO UPDATE SET global_role = 'SUPER_ADMIN'
       RETURNING id, status`,
      [input.SEED_ADMIN_EMAIL, input.SEED_ADMIN_NAME],
    )
  ).rows[0]!;
  await client.query(`UPDATE password_tokens SET used_at = now() WHERE user_id = $1 AND used_at IS NULL`, [user.id]);
  const token = generateToken();
  await client.query(
    `INSERT INTO password_tokens (user_id, token_hash, purpose, expires_at) VALUES ($1, $2, $3, now() + interval '24 hours')`,
    [user.id, hashToken(token), user.status === 'invited' ? 'invite' : 'reset'],
  );
  await client.query(
    `INSERT INTO audit_logs (actor_user_id, action, resource_type, resource_id, result, metadata)
     VALUES ($1::uuid, 'user.seed_super_admin', 'user', $1::text, 'success', '{"source":"cli"}')`,
    [user.id],
  );
  await client.query('COMMIT');
  console.log(`SUPER_ADMIN: ${input.SEED_ADMIN_EMAIL}`);
  console.log(`Defina a senha em até 24h (uso único):\n${input.APP_URL.replace(/\/$/, '')}/set-password?token=${token}`);
} catch (err) {
  await client.query('ROLLBACK');
  console.error((err as Error).message);
  process.exitCode = 1;
} finally {
  await client.end();
}
