import { buildApp } from './app';
import { createContext } from './bootstrap';

const ctx = createContext();
const app = await buildApp(ctx);

const shutdown = async (signal: string) => {
  app.log.info({ signal }, 'encerrando');
  await app.close();
  await ctx.pool.end();
  process.exit(0);
};
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

await app.listen({ host: ctx.env.API_HOST, port: ctx.env.API_PORT });
