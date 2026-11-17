import 'dotenv/config';
import fs from 'node:fs';
import http from 'node:http';
import { config, databasePath } from './server/config';
import { checkpoint, ensureSettings, get, openDatabase, createBackup, syncCounters } from './server/db';
import { pruneSessions } from './server/auth';
import { importLegacyDatabase } from './server/legacyImport';
import { createApp } from './server/app';
import { autoBackupDue, latestBackupAt } from './server/services/backup';
import { getSettingsRow } from './server/services/settings';

async function main(): Promise<void> {
  const db = openDatabase(databasePath());
  const settings = ensureSettings(db);

  const productCount = Number(
    get<{ count: number }>(db, 'SELECT COUNT(*) AS count FROM products')?.count ?? 0,
  );
  if (config.seedLegacy && productCount === 0 && fs.existsSync(config.legacySeedPath)) {
    try {
      const imported = importLegacyDatabase(db, config.legacySeedPath, config.timezone);
      console.log(
        `[db] Imported legacy data: ${imported.products} products, ${imported.sales} sales, ${imported.credits} credits`,
      );
    } catch (error) {
      console.error('[db] Legacy import failed; starting with an empty store.', error);
    }
  }

  pruneSessions(db);
  syncCounters(db);
  if (autoBackupDue(latestBackupAt())) {
    try {
      const backup = createBackup(db, databasePath());
      if (backup) console.log(`[backup] Created ${backup}`);
    } catch (error) {
      console.error('[backup] Initial backup failed', error);
    }
  }

  if (settings.pin_is_default === 1) {
    console.warn(
      '[security] The store PIN is still the default 1234. Change it in Settings before going live.',
    );
  }
  if (!config.mpesa.enabled) {
    console.warn(
      `[mpesa] Daraja STK Push disabled (missing: ${config.mpesa.missing.join(', ') || 'credentials'}). Manual M-Pesa entry is ${
        config.manualMpesaEnabled ? 'enabled' : 'disabled'
      }.`,
    );
  }

  const httpServer = http.createServer();
  let viteClose: (() => Promise<void>) | null = null;

  if (!config.isProduction) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: process.env.DISABLE_HMR === 'true' ? false : { server: httpServer },
      },
      appType: 'spa',
    });
    viteClose = () => vite.close();
    httpServer.on('request', createApp(db, { dev: true, vite: vite.middlewares }));
  } else {
    if (!fs.existsSync(config.distDir)) {
      console.error('[startup] dist/ is missing. Run "npm run build" before starting in production.');
      process.exit(1);
    }
    httpServer.on('request', createApp(db));
  }

  const backupTimer = setInterval(
    () => {
      try {
        if (autoBackupDue(latestBackupAt())) {
          const target = createBackup(db, databasePath());
          if (target) console.log(`[backup] Created ${target}`);
        }
      } catch (error) {
        console.error('[backup] Scheduled backup failed', error);
      }
    },
    6 * 60 * 60 * 1000,
  );
  backupTimer.unref();

  const sessionTimer = setInterval(
    () => {
      try {
        pruneSessions(db);
      } catch (error) {
        console.error('[auth] Session pruning failed', error);
      }
    },
    60 * 60 * 1000,
  );
  sessionTimer.unref();

  httpServer.listen(config.port, config.host, () => {
    console.log(
      `Whispers Cosmetics ${config.version} listening on http://localhost:${config.port} (${config.timezone})`,
    );
    console.log(
      `M-Pesa: ${config.mpesa.enabled ? `STK Push enabled (${config.mpesa.environment})` : 'STK Push disabled'}; manual entry ${
        config.manualMpesaEnabled ? 'enabled' : 'disabled'
      }`,
    );
  });

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[shutdown] ${signal} received, closing server...`);
    clearInterval(backupTimer);
    clearInterval(sessionTimer);
    httpServer.close();
    try {
      checkpoint(db);
      const target = createBackup(db, databasePath());
      if (target) console.log(`[backup] Final backup ${target}`);
    } catch (error) {
      console.error('[shutdown] Backup failed', error);
    }
    try {
      if (viteClose) await viteClose();
      db.close();
    } catch (error) {
      console.error('[shutdown] Cleanup failed', error);
    }
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((error) => {
  console.error('Failed to start Whispers Cosmetics', error);
  process.exit(1);
});
