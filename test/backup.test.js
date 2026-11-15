import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { BACKUP_EVERY_MS, backupDatabase, listBackups, startBackups } from '../src/backup.js';
import { PickupStore, openDatabase } from '../src/store.js';

const context = { guild: '200000000000000001', channel: '500000000000000001', user: '400000000000000001' };
const silent = { log() {}, error() {} };

function tempDir(t, open = []) {
  const dir = mkdtempSync(join(tmpdir(), 'sa-pickups-backup-'));
  t.after(() => {
    for (const db of open) db.close();
    rmSync(dir, { recursive: true, force: true });
  });
  return dir;
}

test('El respaldo copia la base, pasa la comprobación y conserva solo los más recientes', (t) => {
  const opened = [];
  const dir = tempDir(t, opened);
  let now = Date.UTC(2026, 10, 14, 21, 0, 0);
  const store = new PickupStore(join(dir, 'pickups.sqlite'), () => now);
  opened.push(store.db);
  store.create(context, 5, 'primera', 'host_draft');

  const first = backupDatabase(store, join(dir, 'respaldos'), { keep: 3 });
  assert.match(first, /respaldo-20261114T210000Z\.sqlite$/);
  store.create({ ...context, channel: '500000000000000002' }, 5, 'segunda', 'host_draft');

  const copy = new DatabaseSync(first);
  assert.deepEqual(copy.prepare('SELECT request_id FROM pickups').all().map((row) => row.request_id), ['primera']);
  copy.close();

  for (let day = 1; day <= 4; day++) {
    now += BACKUP_EVERY_MS;
    backupDatabase(store, join(dir, 'respaldos'), { keep: 3 });
  }
  assert.deepEqual(listBackups(join(dir, 'respaldos')),
    ['respaldo-20261116T210000Z.sqlite', 'respaldo-20261117T210000Z.sqlite', 'respaldo-20261118T210000Z.sqlite']);
  assert.equal(existsSync(first), false);
});

test('El respaldo de una base cifrada sigue cifrado con la misma clave', (t) => {
  const opened = [];
  const dir = tempDir(t, opened);
  const path = join(dir, 'pickups.sqlite');
  const key = 'ab'.repeat(32);
  const Encrypted = createRequire(import.meta.url)('better-sqlite3-multiple-ciphers');
  const setup = new Encrypted(path);
  setup.pragma("cipher = 'chacha20'");
  setup.key(Buffer.from(key, 'hex'));
  setup.exec('CREATE TABLE inicio (x)');
  setup.close();

  const store = new PickupStore(path, Date.now, key);
  opened.push(store.db);
  store.create(context, 5, 'cifrada', 'host_draft');
  const backup = backupDatabase(store, join(dir, 'respaldos'), { encryptionKey: key });

  const plain = new DatabaseSync(backup);
  assert.throws(() => plain.prepare('SELECT * FROM pickups').all(), /not a database|encrypted/i);
  plain.close();
  const copy = openDatabase(backup, key);
  assert.equal(copy.prepare('SELECT request_id FROM pickups').get().request_id, 'cifrada');
  copy.close();
});

test('Al arrancar solo respalda si el último respaldo tiene más de un día', (t) => {
  const opened = [];
  const dir = tempDir(t, opened);
  const backups = join(dir, 'respaldos');
  let now = Date.UTC(2026, 10, 14, 21, 0, 0);
  const store = new PickupStore(join(dir, 'pickups.sqlite'), () => now);
  opened.push(store.db);

  startBackups(store, { dir: backups, log: silent })();
  assert.equal(listBackups(backups).length, 1);
  now += BACKUP_EVERY_MS - 60_000;
  startBackups(store, { dir: backups, log: silent })();
  assert.equal(listBackups(backups).length, 1);
  now += 60_000;
  startBackups(store, { dir: backups, log: silent })();
  assert.equal(listBackups(backups).length, 2);
});
