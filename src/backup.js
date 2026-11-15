import { copyFileSync, mkdirSync, readdirSync, renameSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { openDatabase } from './store.js';

export const BACKUP_EVERY_MS = 24 * 3_600_000;
const CHECK_EVERY_MS = 3_600_000;
const BACKUP_NAME = /^respaldo-(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z\.sqlite$/;

const stamp = (time) => new Date(time).toISOString().replace(/\.\d{3}Z$/, 'Z').replace(/[-:]/g, '');

function removeCopy(path) {
  for (const suffix of ['', '-wal', '-shm', '-journal']) rmSync(path + suffix, { force: true });
}

// Lista los respaldos del más antiguo al más reciente.
export function listBackups(dir) {
  try {
    return readdirSync(dir).filter((name) => BACKUP_NAME.test(name)).sort();
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

function backupTime(name) {
  const [, y, mo, d, h, mi, s] = BACKUP_NAME.exec(name);
  return Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s));
}

// Copia el archivo de la base tal como está en disco, así que un respaldo de una base cifrada sigue cifrado con la misma clave.
export function backupDatabase(store, dir, { keep = 7, encryptionKey } = {}) {
  if (!store.path || store.path === ':memory:') throw new Error('Solo se respaldan bases guardadas en un archivo.');
  mkdirSync(dir, { recursive: true });
  const target = join(dir, `respaldo-${stamp(store.now())}.sqlite`);
  const partial = `${target}.parcial`;
  // Todo lo que sigue es síncrono: ninguna interacción puede escribir entre el checkpoint y la copia.
  const checkpoint = store.db.prepare('PRAGMA wal_checkpoint(TRUNCATE)').get();
  if (checkpoint?.busy) throw new Error('La base estaba ocupada y no se pudo consolidar antes del respaldo.');
  copyFileSync(store.path, partial);
  try {
    const copy = openDatabase(partial, encryptionKey);
    try {
      const result = Object.values(copy.prepare('PRAGMA quick_check').get() ?? {})[0];
      if (result !== 'ok') throw new Error(`La copia no pasó la comprobación de integridad: ${result}`);
    } finally {
      copy.close();
    }
    rmSync(`${partial}-wal`, { force: true });
    rmSync(`${partial}-shm`, { force: true });
    renameSync(partial, target);
  } catch (error) {
    removeCopy(partial);
    throw error;
  }
  const backups = listBackups(dir);
  for (const old of backups.slice(0, Math.max(0, backups.length - keep))) removeCopy(join(dir, old));
  return target;
}

// Hace un respaldo al arrancar si el último tiene más de un día y vuelve a comprobarlo cada hora.
export function startBackups(store, { dir, keep = 7, encryptionKey, log = console } = {}) {
  const run = () => {
    try {
      const latest = listBackups(dir).at(-1);
      if (latest && store.now() - backupTime(latest) < BACKUP_EVERY_MS) return;
      const path = backupDatabase(store, dir, { keep, encryptionKey });
      log.log(`Respaldo de la base guardado en ${path}.`);
    } catch (error) {
      log.error('No pude respaldar la base:', error.message);
    }
  };
  run();
  const timer = setInterval(run, CHECK_EVERY_MS).unref();
  return () => clearInterval(timer);
}
