import { migrate } from './migrate';

const adminUrl = process.env.DATABASE_ADMIN_URL;
if (!adminUrl) {
  console.error('DATABASE_ADMIN_URL não definido');
  process.exit(1);
}

migrate({ adminUrl, appPassword: process.env.APP_DB_PASSWORD }).catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
