// SQLite-backed account repository; cascades to pools/meters on remove, spend history survives.
import type { AccountRecord, AccountRepo } from '../../../application/index';
import type { Meter, Pool } from '../../../domain/index';
import type { DocketDb } from './database';

/** A selected row, keyed by column name; node:sqlite hands back index-signature records. */
type DataRow = { readonly [column: string]: unknown };

/** Only our own writes fill `data`, so anything else is a programming error. */
function recordFromRow<T>(row: DataRow): T {
  if (typeof row.data !== 'string') throw new Error('repository row without JSON data');
  const parsed: unknown = JSON.parse(row.data);
  return parsed as T;
}

function optionalRecordFromRow<T>(row: DataRow | undefined): T | undefined {
  return row === undefined ? undefined : recordFromRow<T>(row);
}

export function createSqliteAccountRepo(db: DocketDb): AccountRepo {
  return {
    save: async (record: AccountRecord): Promise<void> => {
      db.raw
        .prepare(
          'INSERT INTO accounts (id, data) VALUES (?, ?) ON CONFLICT (id) DO UPDATE SET data = excluded.data',
        )
        .run(record.id, JSON.stringify(record));
    },

    get: async (id) => optionalRecordFromRow<AccountRecord>(db.raw.prepare('SELECT data FROM accounts WHERE id = ?').get(id)),

    list: async (): Promise<readonly AccountRecord[]> =>
      db.raw
        .prepare('SELECT data FROM accounts ORDER BY rowid')
        .all()
        .map((row) => recordFromRow<AccountRecord>(row)),

    remove: async (id): Promise<void> => {
      // Spend is history and survives; meters go with the pools they observe.
      db.transaction(() => {
        db.raw.prepare('DELETE FROM meters WHERE pool_id IN (SELECT id FROM pools WHERE account_id = ?)').run(id);
        db.raw.prepare('DELETE FROM pools WHERE account_id = ?').run(id);
        db.raw.prepare('DELETE FROM accounts WHERE id = ?').run(id);
      });
    },

    savePools: async (accountId, pools): Promise<void> => {
      db.transaction(() => {
        db.raw.prepare('DELETE FROM pools WHERE account_id = ?').run(accountId);
        const insert = db.raw.prepare('INSERT INTO pools (id, account_id, data) VALUES (?, ?, ?)');
        for (const pool of pools) insert.run(pool.id, pool.accountId, JSON.stringify(pool));
      });
    },

    saveMeter: async (meter): Promise<void> => {
      db.raw
        .prepare(
          'INSERT INTO meters (id, pool_id, data) VALUES (?, ?, ?) ' +
            'ON CONFLICT (id) DO UPDATE SET pool_id = excluded.pool_id, data = excluded.data',
        )
        .run(meter.id, meter.poolId, JSON.stringify(meter));
    },

    pools: async (accountId?): Promise<readonly Pool[]> => {
      const rows =
        accountId === undefined
          ? db.raw.prepare('SELECT data FROM pools ORDER BY rowid').all()
          : db.raw.prepare('SELECT data FROM pools WHERE account_id = ? ORDER BY rowid').all(accountId);
      return rows.map((row) => recordFromRow<Pool>(row));
    },

    meters: async (accountId?): Promise<readonly Meter[]> => {
      const rows =
        accountId === undefined
          ? db.raw.prepare('SELECT data FROM meters ORDER BY rowid').all()
          : db.raw
              .prepare(
                'SELECT m.data AS data FROM meters m JOIN pools p ON m.pool_id = p.id WHERE p.account_id = ? ORDER BY m.rowid',
              )
              .all(accountId);
      return rows.map((row) => recordFromRow<Meter>(row));
    },

    recordSpend: async (entry): Promise<void> => {
      db.raw
        .prepare('INSERT INTO spend (account_id, workspace, work_order_id, at, usd) VALUES (?, ?, ?, ?, ?)')
        .run(entry.accountId, entry.repo, entry.workOrderId, entry.at, entry.usd);
    },

    spend: async (filter): Promise<number> => {
      // `from`/`to` are inclusive; an empty match sums to 0, not NULL.
      const conditions = ['at >= ?', 'at <= ?'];
      const params: (string | number)[] = [filter.from, filter.to];
      if (filter.accountId !== undefined) {
        conditions.push('account_id = ?');
        params.push(filter.accountId);
      }
      if (filter.repo !== undefined) {
        conditions.push('workspace = ?');
        params.push(filter.repo);
      }
      if (filter.workOrderId !== undefined) {
        conditions.push('work_order_id = ?');
        params.push(filter.workOrderId);
      }
      const row = db.raw
        .prepare(`SELECT COALESCE(SUM(usd), 0) AS total FROM spend WHERE ${conditions.join(' AND ')}`)
        .get(...params);
      const total = row === undefined ? undefined : row.total;
      if (typeof total !== 'number') throw new Error('spend sum did not return a number');
      return total;
    },
  };
}
