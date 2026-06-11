import fs from 'fs';
import os from 'os';
import path from 'path';
import { AppDatabase } from './database';

const createTestDatabase = (): { db: AppDatabase; cleanup: () => void } => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tavily-db-test-'));
  const dbPath = path.join(dir, 'test.db');
  const db = new AppDatabase(dbPath, 'test-encryption-key');

  return {
    db,
    cleanup: () => {
      db.close();
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
};

describe('AppDatabase quota limits', () => {
  it('initializes a new monthly quota with the latest known limit for the same key', () => {
    const { db, cleanup } = createTestDatabase();

    try {
      const key = db.addApiKey({ keyValue: 'tvly-test-key' });
      db.updateMonthlyQuotaFromUsage({
        keyId: key.id,
        yearMonth: '2026-05',
        quotaLimit: 1000,
        usedCount: 12,
      });

      const quota = db.ensureMonthlyQuota(key.id, '2026-06');

      expect(quota.quota_limit).toBe(1000);
      expect(quota.used_count).toBe(0);
    } finally {
      cleanup();
    }
  });

  it('keeps quota limit unknown when the key has no previous known limit', () => {
    const { db, cleanup } = createTestDatabase();

    try {
      const key = db.addApiKey({ keyValue: 'tvly-new-test-key' });
      const quota = db.ensureMonthlyQuota(key.id, '2026-06');

      expect(quota.quota_limit).toBeNull();
    } finally {
      cleanup();
    }
  });
});
