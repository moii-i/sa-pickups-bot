import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { balancedTeams } from './matchmaking.js';
import { DEFAULT_TEAM_SIZE, DEFAULT_VOTE_MINUTES, DRAFT_QUEUE_FORMAT, DRAFT_QUEUE_LIMIT, DRAFT_SLOTS, OUTCOMES, POSITIONS, PickupCreationRequired, PickupError, QUEUE_IDLE_MINUTES, ROOM_RETENTION_HOURS, TEAM_NAMES, TEAM_QUEUE_FORMAT } from './rules.js';

export function openDatabase(path, encryptionKey) {
  if (!encryptionKey) return new DatabaseSync(path, { timeout: 500 });
  if (!/^[a-f0-9]{64}$/i.test(encryptionKey)) throw new Error('DB_ENCRYPTION_KEY debe tener 64 caracteres hexadecimales.');

  const require = createRequire(import.meta.url);
  const EncryptedDatabase = require('better-sqlite3-multiple-ciphers');
  const db = new EncryptedDatabase(path, { timeout: 500, fileMustExist: true });
  try {
    db.pragma("cipher = 'chacha20'");
    db.key(Buffer.from(encryptionKey, 'hex'));
    db.pragma('temp_store = MEMORY');
    db.prepare('SELECT name FROM sqlite_schema LIMIT 1').get();
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}

export class PickupStore {
  constructor(path, now = Date.now, encryptionKey) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.path = path;
    this.db = openDatabase(path, encryptionKey);
    this.now = now;
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS pickups (
        id INTEGER PRIMARY KEY,
        request_id TEXT NOT NULL UNIQUE,
        guild_id TEXT NOT NULL,
        channel_id TEXT NOT NULL,
        team_size INTEGER NOT NULL CHECK (team_size BETWEEN 1 AND 10),
        status TEXT NOT NULL CHECK (status IN ('open','playing','voting','closed','canceled')),
        outcome TEXT CHECK (outcome IN ('A','B','draw')),
        vote_until INTEGER,
        format TEXT NOT NULL DEFAULT 'manual',
        score_a INTEGER,
        score_b INTEGER,
        result_by TEXT,
        created_by TEXT,
        friendly INTEGER NOT NULL DEFAULT 0 CHECK (friendly IN (0,1))
      );
      CREATE UNIQUE INDEX IF NOT EXISTS one_active_pickup
        ON pickups (guild_id, channel_id) WHERE status IN ('open','playing');
      CREATE TABLE IF NOT EXISTS players (
        pickup_id INTEGER NOT NULL REFERENCES pickups(id),
        user_id TEXT NOT NULL,
        name TEXT NOT NULL,
        team TEXT NOT NULL CHECK (team IN ('A','B')),
        grade INTEGER CHECK (grade BETWEEN 0 AND 100),
        graded_by TEXT,
        position TEXT,
        PRIMARY KEY (pickup_id, user_id)
      );
      CREATE TABLE IF NOT EXISTS finished_votes (
        pickup_id INTEGER NOT NULL,
        voter TEXT NOT NULL,
        PRIMARY KEY (pickup_id, voter),
        FOREIGN KEY (pickup_id, voter) REFERENCES players (pickup_id, user_id)
      );
      CREATE TABLE IF NOT EXISTS votes (
        pickup_id INTEGER NOT NULL,
        voter TEXT NOT NULL,
        candidate TEXT NOT NULL CHECK (voter <> candidate),
        PRIMARY KEY (pickup_id, voter),
        FOREIGN KEY (pickup_id, voter) REFERENCES players (pickup_id, user_id),
        FOREIGN KEY (pickup_id, candidate) REFERENCES players (pickup_id, user_id)
      );
      CREATE TABLE IF NOT EXISTS parties (
        id INTEGER PRIMARY KEY AUTOINCREMENT, guild_id TEXT NOT NULL, leader_id TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS party_members (
        party_id INTEGER NOT NULL REFERENCES parties(id) ON DELETE CASCADE,
        guild_id TEXT NOT NULL, user_id TEXT NOT NULL, name TEXT NOT NULL, position TEXT NOT NULL,
        PRIMARY KEY (guild_id, user_id)
      );
      CREATE TABLE IF NOT EXISTS party_invites (
        id INTEGER PRIMARY KEY AUTOINCREMENT, party_id INTEGER NOT NULL REFERENCES parties(id) ON DELETE CASCADE,
        user_id TEXT NOT NULL, expires_at INTEGER NOT NULL, UNIQUE (party_id, user_id)
      );
      CREATE TABLE IF NOT EXISTS queue_panels (
        pickup_id INTEGER NOT NULL REFERENCES pickups(id), message_id TEXT PRIMARY KEY,
        channel_id TEXT, synced_status TEXT
      );
      CREATE TABLE IF NOT EXISTS party_searches (
        request_id TEXT PRIMARY KEY, pickup_id INTEGER NOT NULL REFERENCES pickups(id)
      );
      CREATE TABLE IF NOT EXISTS pickup_rooms (
        pickup_id INTEGER PRIMARY KEY REFERENCES pickups(id),
        channel_id TEXT UNIQUE,
        announced INTEGER NOT NULL DEFAULT 0,
        lineup_posted INTEGER NOT NULL DEFAULT 0,
        lineup_message_id TEXT,
        roster_version INTEGER NOT NULL DEFAULT 0,
        room_version INTEGER NOT NULL DEFAULT 0,
        delete_after INTEGER
      );
      CREATE TABLE IF NOT EXISTS pickup_kicks (
        pickup_id INTEGER NOT NULL REFERENCES pickups(id),
        user_id TEXT NOT NULL,
        PRIMARY KEY (pickup_id, user_id)
      );
      CREATE TABLE IF NOT EXISTS profile_styles (
        guild_id TEXT NOT NULL, user_id TEXT NOT NULL,
        frame TEXT, title TEXT, position TEXT,
        PRIMARY KEY (guild_id, user_id)
      );
      CREATE TABLE IF NOT EXISTS draft_queue (
        pickup_id INTEGER NOT NULL REFERENCES pickups(id), user_id TEXT NOT NULL, name TEXT NOT NULL,
        party_id INTEGER, party_name TEXT, party_badge TEXT, slot TEXT,
        PRIMARY KEY (pickup_id, user_id), UNIQUE (pickup_id, slot)
      );
      CREATE INDEX IF NOT EXISTS draft_queue_user ON draft_queue(user_id, pickup_id);
    `);
    const pickupColumns = new Set(this.db.prepare('PRAGMA table_info(pickups)').all().map((c) => c.name));
    if (!pickupColumns.has('format')) this.db.exec("ALTER TABLE pickups ADD COLUMN format TEXT NOT NULL DEFAULT 'manual'");
    if (!pickupColumns.has('score_a')) this.db.exec('ALTER TABLE pickups ADD COLUMN score_a INTEGER');
    if (!pickupColumns.has('score_b')) this.db.exec('ALTER TABLE pickups ADD COLUMN score_b INTEGER');
    if (!pickupColumns.has('result_by')) this.db.exec('ALTER TABLE pickups ADD COLUMN result_by TEXT');
    if (!pickupColumns.has('activity_at')) this.db.exec('ALTER TABLE pickups ADD COLUMN activity_at INTEGER');
    if (!pickupColumns.has('expired')) this.db.exec('ALTER TABLE pickups ADD COLUMN expired INTEGER NOT NULL DEFAULT 0');
    if (!pickupColumns.has('created_by')) this.db.exec('ALTER TABLE pickups ADD COLUMN created_by TEXT');
    if (!pickupColumns.has('friendly')) this.db.exec('ALTER TABLE pickups ADD COLUMN friendly INTEGER NOT NULL DEFAULT 0 CHECK (friendly IN (0,1))');
    const panelColumns = new Set(this.db.prepare('PRAGMA table_info(queue_panels)').all().map((c) => c.name));
    if (!panelColumns.has('channel_id')) this.db.exec('ALTER TABLE queue_panels ADD COLUMN channel_id TEXT');
    if (!panelColumns.has('synced_status')) this.db.exec('ALTER TABLE queue_panels ADD COLUMN synced_status TEXT');
    const roomColumns = new Set(this.db.prepare('PRAGMA table_info(pickup_rooms)').all().map((c) => c.name));
    if (!roomColumns.has('lineup_posted')) this.db.exec('ALTER TABLE pickup_rooms ADD COLUMN lineup_posted INTEGER NOT NULL DEFAULT 0');
    if (!roomColumns.has('lineup_message_id')) this.db.exec('ALTER TABLE pickup_rooms ADD COLUMN lineup_message_id TEXT');
    if (!roomColumns.has('roster_version')) this.db.exec('ALTER TABLE pickup_rooms ADD COLUMN roster_version INTEGER NOT NULL DEFAULT 0');
    if (!roomColumns.has('room_version')) this.db.exec('ALTER TABLE pickup_rooms ADD COLUMN room_version INTEGER NOT NULL DEFAULT 0');
    const migrationTime = this.now();
    this.db.prepare(`UPDATE pickup_rooms SET delete_after = ?
      WHERE (delete_after IS NULL OR delete_after > ?)
      AND pickup_id IN (SELECT id FROM pickups WHERE friendly = 1 AND status = 'closed')`).run(migrationTime, migrationTime);
    const playerColumns = new Set(this.db.prepare('PRAGMA table_info(players)').all().map((c) => c.name));
    if (!playerColumns.has('position')) this.db.exec('ALTER TABLE players ADD COLUMN position TEXT');
    if (!playerColumns.has('party_id')) this.db.exec('ALTER TABLE players ADD COLUMN party_id INTEGER');
    if (!playerColumns.has('party_name')) this.db.exec('ALTER TABLE players ADD COLUMN party_name TEXT');
    if (!playerColumns.has('party_badge')) this.db.exec('ALTER TABLE players ADD COLUMN party_badge TEXT');
    const partyColumns = new Set(this.db.prepare('PRAGMA table_info(parties)').all().map((c) => c.name));
    if (!partyColumns.has('name')) this.db.exec('ALTER TABLE parties ADD COLUMN name TEXT');
    if (!partyColumns.has('badge')) this.db.exec('ALTER TABLE parties ADD COLUMN badge TEXT');
    const legacyQueues = this.db.prepare(`SELECT id, request_id, EXISTS(SELECT 1 FROM players WHERE pickup_id = pickups.id) AS has_players
      FROM pickups WHERE status = 'open' AND activity_at IS NULL`).all();
    const setActivity = this.db.prepare('UPDATE pickups SET activity_at = ? WHERE id = ?');
    for (const queue of legacyQueues) {
      const now = this.now();
      const created = !queue.has_players && /^\d{17,20}$/.test(queue.request_id)
        ? Number((BigInt(queue.request_id) >> 22n) + 1_420_070_400_000n) : now;
      setActivity.run(Math.min(created, now), queue.id);
    }
  }

  transaction(write) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = write();
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  create(context, teamSize, requestId, format = teamSize === DEFAULT_TEAM_SIZE ? 'positional' : 'manual', friendly = false) {
    const duplicate = this.db.prepare('SELECT * FROM pickups WHERE request_id = ?').get(requestId);
    if (duplicate) return duplicate;
    if (['positional', TEAM_QUEUE_FORMAT, DRAFT_QUEUE_FORMAT].includes(format) && teamSize !== DEFAULT_TEAM_SIZE) {
      throw new PickupError('El formato por posiciones es 5v5. Para otro tamaño, elige equipos manuales.');
    }

    const active = this.db.prepare(`
      SELECT id FROM pickups WHERE guild_id = ? AND channel_id = ? AND status IN ('open','playing')
    `).get(context.guild, context.channel);
    if (active) throw new PickupError(`Ya hay una pickup activa en este canal (#${active.id}).`);

    return this.db.prepare(`
      INSERT INTO pickups (request_id, guild_id, channel_id, team_size, status, format, activity_at, created_by, friendly)
      VALUES (?, ?, ?, ?, 'open', ?, ?, ?, ?) RETURNING *
    `).get(requestId, context.guild, context.channel, teamSize, format, this.now(), context.user ?? null, Number(friendly));
  }

  rememberCreator(id, user) {
    this.db.prepare('UPDATE pickups SET created_by = ? WHERE id = ? AND created_by IS NULL').run(user, id);
  }

  pickup(context, id) {
    const pickup = this.db.prepare(`
      SELECT p.* FROM pickups p LEFT JOIN pickup_rooms r ON r.pickup_id = p.id
      WHERE p.guild_id = ? AND (p.channel_id = ? OR r.channel_id = ?) AND p.id = ?
    `).get(context.guild, context.channel, context.channel, id);
    if (!pickup) throw new PickupError('No encontré esa pickup en este canal.');
    return pickup;
  }

  roster(id) {
    return this.db.prepare(`SELECT p.* FROM players p LEFT JOIN draft_queue q
      ON q.pickup_id = p.pickup_id AND q.user_id = p.user_id
      WHERE p.pickup_id = ? ORDER BY p.team, q.slot, p.user_id`).all(id);
  }

  draftQueue(id) {
    return this.db.prepare('SELECT * FROM draft_queue WHERE pickup_id = ? ORDER BY rowid').all(id);
  }

  addDraftEntries(pickup, entries) {
    const current = this.draftQueue(pickup.id);
    const additions = entries.filter(({ user_id }) => !current.some((entry) => entry.user_id === user_id));
    if (current.length + additions.length > DRAFT_QUEUE_LIMIT) throw new PickupError(`La cola admite hasta ${DRAFT_QUEUE_LIMIT} jugadores.`);
    const insert = this.db.prepare(`INSERT INTO draft_queue (pickup_id, user_id, name, party_id, party_name, party_badge)
      VALUES (?, ?, ?, ?, ?, ?)`);
    for (const entry of entries) {
      if (this.isKicked(pickup.id, entry.user_id)) throw new PickupError('Fuiste vetado para esta pickup o alguien de tu grupo está vetado.');
      const active = this.activePickup(pickup.guild_id, entry.user_id);
      if (active && active.id !== pickup.id) throw new PickupError(`Un jugador ya está inscrito en la pickup #${active.id}.`);
    }
    for (const { user_id, name, party_id = null, party_name = null, party_badge = null } of additions) {
      insert.run(pickup.id, user_id, name, party_id, party_name, party_badge);
    }
    if (additions.length) this.dirtyDraftQueue(pickup.id);
  }

  dirtyDraftQueue(id) {
    this.touchQueue(id);
    this.db.prepare("UPDATE queue_panels SET synced_status = 'reopen' WHERE pickup_id = ?").run(id);
  }

  removeDraftEntry(id, user) {
    const result = this.db.prepare('DELETE FROM draft_queue WHERE pickup_id = ? AND user_id = ?').run(id, user);
    if (result.changes) {
      this.db.prepare('DELETE FROM players WHERE pickup_id = ? AND user_id = ?').run(id, user);
      this.dirtyDraftQueue(id);
    }
    return Boolean(result.changes);
  }

  joinDraft(context, id, join) {
    return this.transaction(() => {
      const pickup = this.pickup(context, id);
      if (pickup.format !== DRAFT_QUEUE_FORMAT || pickup.status !== 'open') throw new PickupError('La cola ya no está abierta.');
      if (join) this.addDraftEntries(pickup, [{ user_id: context.user, name: context.name }]);
      else this.removeDraftEntry(id, context.user);
      return pickup;
    });
  }

  assignDraftSlot(context, id, slot, user) {
    return this.transaction(() => {
      const pickup = this.pickup(context, id);
      if (pickup.format !== DRAFT_QUEUE_FORMAT || pickup.status !== 'open') throw new PickupError('La cola ya no está abierta.');
      if (!DRAFT_SLOTS.some(({ key }) => key === slot)) throw new PickupError('Elige un puesto válido.');
      const entry = user && this.draftQueue(id).find((p) => p.user_id === user);
      if (user && (!entry || (entry.slot && entry.slot !== slot))) throw new PickupError('Ese jugador salió de la cola o ya tiene un puesto.');
      this.db.prepare('UPDATE draft_queue SET slot = NULL WHERE pickup_id = ? AND slot = ?').run(id, slot);
      if (entry) this.db.prepare('UPDATE draft_queue SET slot = ? WHERE pickup_id = ? AND user_id = ?').run(slot, id, user);
      this.touchQueue(id);
      return pickup;
    });
  }

  startDraft(context, id, privateRooms) {
    return this.transaction(() => {
      const pickup = this.pickup(context, id);
      if (pickup.format !== DRAFT_QUEUE_FORMAT || pickup.status !== 'open') throw new PickupError('La cola ya no está abierta.');
      const bySlot = new Map(this.draftQueue(id).map((entry) => [entry.slot, entry]));
      if (!DRAFT_SLOTS.every(({ key }) => bySlot.has(key))) throw new PickupError('Completa los 10 puestos antes de iniciar.');
      this.db.prepare('DELETE FROM players WHERE pickup_id = ?').run(id);
      const insert = this.db.prepare(`INSERT INTO players (pickup_id, user_id, name, team, position, party_id, party_name, party_badge)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
      for (const { key, team, position } of DRAFT_SLOTS) {
        const { user_id, name, party_id, party_name, party_badge } = bySlot.get(key);
        insert.run(id, user_id, name, team, position, party_id, party_name, party_badge);
      }
      this.db.prepare('DELETE FROM draft_queue WHERE pickup_id = ? AND slot IS NULL').run(id);
      return this.beginPlaying(pickup, privateRooms);
    });
  }

  expireQueues() {
    this.db.prepare(`UPDATE pickups SET status = 'canceled', expired = 1
      WHERE status = 'open' AND activity_at <= ?
      AND (format = ? OR (SELECT COUNT(*) FROM players WHERE pickup_id = pickups.id) < team_size * 2)
    `).run(this.now() - QUEUE_IDLE_MINUTES * 60_000, DRAFT_QUEUE_FORMAT);
  }

  touchQueue(id) {
    this.db.prepare('UPDATE pickups SET activity_at = ? WHERE id = ?').run(this.now(), id);
    this.db.prepare('UPDATE pickup_rooms SET roster_version = roster_version + 1 WHERE pickup_id = ?').run(id);
  }

  rememberQueuePanel(id, message, channel = null, syncedStatus = null) {
    this.db.prepare('INSERT OR IGNORE INTO queue_panels (pickup_id, message_id, channel_id, synced_status) VALUES (?, ?, ?, ?)')
      .run(id, message, channel, syncedStatus);
  }

  queuePanelsToSync() {
    return this.db.prepare(`SELECT p.*, q.message_id, COALESCE(q.channel_id, p.channel_id) AS panel_channel_id,
        r.pickup_id IS NOT NULL AS tracked_room FROM queue_panels q JOIN pickups p ON p.id = q.pickup_id
      LEFT JOIN pickup_rooms r ON r.pickup_id = p.id
      WHERE (p.status <> 'open' OR q.synced_status = 'reopen' OR r.pickup_id IS NOT NULL AND q.synced_status IS NOT NULL)
      AND (p.status IN ('open','closed','canceled') OR r.pickup_id IS NULL OR
        (r.channel_id IS NOT NULL AND r.room_version = r.roster_version))
      AND q.synced_status IS NOT p.status
      ORDER BY p.id LIMIT 10`).all();
  }

  markQueuePanelSynced(message, status) {
    this.db.prepare('UPDATE queue_panels SET synced_status = ? WHERE message_id = ?').run(status, message);
  }

  forgetQueuePanel(message) {
    this.db.prepare('DELETE FROM queue_panels WHERE message_id = ?').run(message);
  }

  activePickup(guild, user) {
    return this.db.prepare(`SELECT m.id FROM pickups m JOIN players p ON p.pickup_id = m.id
      WHERE m.guild_id = ? AND p.user_id = ? AND m.status IN ('open','playing')
      UNION ALL SELECT m.id FROM pickups m JOIN draft_queue q ON q.pickup_id = m.id
      WHERE m.guild_id = ? AND q.user_id = ? AND m.status = 'open' LIMIT 1
    `).get(guild, user, guild, user);
  }

  partyFor({ guild, user }) {
    return this.db.prepare(`SELECT p.* FROM parties p JOIN party_members m ON p.id = m.party_id
      WHERE m.guild_id = ? AND m.user_id = ?`).get(guild, user);
  }

  isKicked(pickupId, user) {
    return Boolean(this.db.prepare('SELECT 1 FROM pickup_kicks WHERE pickup_id = ? AND user_id = ?').get(pickupId, user));
  }

  kick(context, id, user) {
    return this.transaction(() => {
      const pickup = this.pickup(context, id);
      if (!['open','playing'].includes(pickup.status)) {
        throw new PickupError('Solo puedes retirar jugadores antes de que empiece la evaluación.');
      }
      const draft = pickup.format === DRAFT_QUEUE_FORMAT;
      const player = (draft ? this.draftQueue(id) : this.roster(id)).find((p) => p.user_id === user);
      if (!player) throw new PickupError('Ese jugador no está en la alineación de esta pickup.');
      this.db.prepare('INSERT INTO pickup_kicks (pickup_id, user_id) VALUES (?, ?)').run(id, user);
      this.db.prepare('DELETE FROM finished_votes WHERE pickup_id = ?').run(id);
      if (draft) this.removeDraftEntry(id, user);
      else this.db.prepare('DELETE FROM players WHERE pickup_id = ? AND user_id = ?').run(id, user);
      if (player.party_id && !draft) {
        this.db.prepare('UPDATE players SET party_id = NULL, party_name = NULL, party_badge = NULL WHERE pickup_id = ? AND party_id = ?')
          .run(id, player.party_id);
      }
      this.db.prepare("UPDATE pickups SET status = 'open' WHERE id = ?").run(id);
      this.db.prepare('UPDATE pickup_rooms SET announced = 0, lineup_posted = 0 WHERE pickup_id = ?').run(id);
      this.db.prepare("UPDATE queue_panels SET synced_status = 'reopen' WHERE pickup_id = ?").run(id);
      this.touchQueue(id);
    });
  }

  partyMembers(id) {
    return this.db.prepare('SELECT * FROM party_members WHERE party_id = ? ORDER BY user_id').all(id);
  }

  setPartyIdentity(context, name, badge) {
    return this.transaction(() => {
      const party = this.partyFor(context);
      if (party?.leader_id !== context.user) throw new PickupError('Solo el líder puede cambiar el nombre y el escudo.');
      this.assertPartyIdle(party);
      return this.db.prepare('UPDATE parties SET name = ?, badge = ? WHERE id = ? RETURNING *').get(name, badge, party.id);
    });
  }

  assertPartyIdle(party) {
    if (this.partyMembers(party.id).some((p) => this.activePickup(party.guild_id, p.user_id))) {
      throw new PickupError('El grupo está en una cola o partida. Retíralo de la cola o termina la partida primero.');
    }
  }

  availablePartyPositions(partyId, exceptUser) {
    const members = this.partyMembers(partyId).filter((p) => p.user_id !== exceptUser);
    return Object.keys(POSITIONS).filter((position) => members.filter((p) => p.position === position).length < POSITIONS[position] / 2);
  }

  addPartyMember(partyId, context, position) {
    if (!this.availablePartyPositions(partyId).includes(position)) throw new PickupError('Esa posición no tiene cupo en el grupo.');
    if (this.partyFor(context) || this.activePickup(context.guild, context.user)) {
      throw new PickupError('Ya estás en un grupo o una partida activa.');
    }
    this.db.prepare(`INSERT INTO party_members (party_id, guild_id, user_id, name, position) VALUES (?, ?, ?, ?, ?)`)
      .run(partyId, context.guild, context.user, context.name, position);
  }

  createParty(context, position) {
    return this.transaction(() => {
      const party = this.db.prepare('INSERT INTO parties (guild_id, leader_id) VALUES (?, ?) RETURNING *').get(context.guild, context.user);
      this.addPartyMember(party.id, context, position);
      return party;
    });
  }

  inviteToParty(context, party, target) {
    if (party.leader_id !== context.user) throw new PickupError('Solo el líder puede invitar.');
    return this.transaction(() => {
      this.assertPartyIdle(party);
      if (!this.availablePartyPositions(party.id).length) throw new PickupError('El grupo ya está completo.');
      if (this.partyFor({ guild: context.guild, user: target }) || this.activePickup(context.guild, target)) {
        throw new PickupError('Ese jugador ya está en un grupo o una partida activa.');
      }
      const now = this.now();
      this.db.prepare('DELETE FROM party_invites WHERE expires_at <= ?').run(now);
      const previous = this.db.prepare('SELECT id FROM party_invites WHERE party_id = ? AND user_id = ?').get(party.id, target);
      if (previous) throw new PickupError('Ya hay una invitación vigente para ese jugador.');
      return this.db.prepare('INSERT INTO party_invites (party_id, user_id, expires_at) VALUES (?, ?, ?) RETURNING *')
        .get(party.id, target, now + 10 * 60_000);
    });
  }

  partyInvite(context, id = null) {
    const invite = this.db.prepare(`SELECT i.*, p.guild_id, p.leader_id FROM party_invites i JOIN parties p ON p.id = i.party_id
      WHERE (p.guild_id = ? OR (? IS NULL AND ? IS NOT NULL)) AND i.user_id = ? AND i.expires_at > ?
      AND (? IS NULL OR i.id = ?) ORDER BY i.id DESC LIMIT 1
    `).get(context.guild ?? null, context.guild ?? null, id, context.user, this.now(), id, id);
    if (!invite) throw new PickupError('No tienes esa invitación vigente.');
    return invite;
  }

  answerPartyInvite(context, id, position) {
    return this.transaction(() => {
      const invite = this.partyInvite(context, id);
      if (position !== undefined) {
        this.assertPartyIdle({ id: invite.party_id, guild_id: context.guild });
        this.addPartyMember(invite.party_id, context, position);
        this.db.prepare('DELETE FROM party_invites WHERE user_id = ? AND party_id IN (SELECT id FROM parties WHERE guild_id = ?)')
          .run(context.user, context.guild);
      } else {
        this.db.prepare('DELETE FROM party_invites WHERE id = ?').run(invite.id);
      }
    });
  }

  changePartyPosition(context, party, position) {
    this.assertPartyIdle(party);
    if (!this.availablePartyPositions(party.id, context.user).includes(position)) throw new PickupError('Esa posición no tiene cupo en el grupo.');
    this.db.prepare('UPDATE party_members SET position = ? WHERE party_id = ? AND user_id = ?').run(position, party.id, context.user);
  }

  leaveParty(context, party) {
    this.assertPartyIdle(party);
    if (party.leader_id === context.user) {
      this.db.prepare('DELETE FROM parties WHERE id = ?').run(party.id);
    } else {
      this.db.prepare('DELETE FROM party_members WHERE party_id = ? AND user_id = ?').run(party.id, context.user);
    }
  }

  queueParty(context, requestId, requestedTeam, canCreate = true, privateRooms = false, newFormat = TEAM_QUEUE_FORMAT) {
    return this.transaction(() => {
      const duplicate = this.db.prepare(`SELECT p.* FROM party_searches s JOIN pickups p ON p.id = s.pickup_id WHERE s.request_id = ?`).get(requestId);
      if (duplicate) return duplicate;
      const party = this.partyFor(context);
      if (party?.leader_id !== context.user) throw new PickupError('Solo el líder de un grupo puede buscar una partida.');
      if (requestedTeam !== undefined && !Object.hasOwn(TEAM_NAMES, requestedTeam)) throw new PickupError('Elige Azul o Rojo.');
      const current = this.db.prepare(`SELECT * FROM pickups WHERE guild_id = ? AND channel_id = ? AND status IN ('open','playing')`)
        .get(context.guild, context.channel);
      if (!current && !canCreate) throw new PickupCreationRequired('No hay una convocatoria abierta en este canal.');
      if ((current?.format ?? newFormat) === DRAFT_QUEUE_FORMAT) {
        if (current && current.status !== 'open') throw new PickupError('Este canal ya tiene una partida en juego.');
        const pickup = current ?? this.create(context, DEFAULT_TEAM_SIZE, requestId, DRAFT_QUEUE_FORMAT);
        const entries = this.partyMembers(party.id).map((member) => ({ ...member,
          party_id: party.id, party_name: party.name, party_badge: party.badge }));
        this.addDraftEntries(pickup, entries);
        this.db.prepare('INSERT INTO party_searches (request_id, pickup_id) VALUES (?, ?)').run(requestId, pickup.id);
        return pickup;
      }
      const roster = current ? this.roster(current.id) : [];
      const recordSearch = this.db.prepare('INSERT INTO party_searches (request_id, pickup_id) VALUES (?, ?)');
      const existing = current?.status === 'open' && roster.find((p) => p.party_id === party.id);
      if (existing && (requestedTeam === undefined || requestedTeam === existing.team)) {
        recordSearch.run(requestId, current.id);
        return current;
      }
      if (!existing) this.assertPartyIdle(party);
      if (current && (current.status !== 'open' || !['positional', TEAM_QUEUE_FORMAT].includes(current.format))) {
        throw new PickupError('Este canal ya tiene una partida activa que no admite grupos.');
      }
      const members = this.partyMembers(party.id);
      if (current && members.some((member) => this.isKicked(current.id, member.user_id))) {
        throw new PickupError('Alguien de tu grupo fue vetado para esta pickup.');
      }
      const others = roster.filter((p) => p.party_id !== party.id);
      const fits = (players, capacity) => Object.entries(POSITIONS).every(([position, slots]) =>
        players.filter((p) => p.position === position).length <= slots / capacity);
      if (!fits([...others, ...members], 1)) throw new PickupError('No hay cupo para todo el grupo en esta partida.');
      const sides = Object.keys(TEAM_NAMES).map((team) => ({
        team, players: others.filter((p) => p.team === team && (current?.format !== 'positional' || p.party_id)),
      }));
      sides.sort((a, b) => a.players.length - b.players.length);
      const team = sides.find(({ team, players }) => (!requestedTeam || team === requestedTeam) && fits([...members, ...players], 2))?.team;
      if (!team) throw new PickupError(requestedTeam ? `No hay cupo para todo el grupo en ${TEAM_NAMES[requestedTeam]}.` : 'El grupo no cabe junto en esta partida.');
      const pickup = current ?? this.create(context, DEFAULT_TEAM_SIZE, requestId, TEAM_QUEUE_FORMAT);
      if (existing) {
        this.db.prepare('UPDATE players SET team = ? WHERE pickup_id = ? AND party_id = ?').run(team, pickup.id, party.id);
      } else {
        const insert = this.db.prepare(`INSERT INTO players (pickup_id, user_id, name, team, position, party_id, party_name, party_badge)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
        for (const member of members) {
          insert.run(pickup.id, member.user_id, member.name, team, member.position, party.id, party.name, party.badge);
        }
      }
      this.touchQueue(pickup.id);
      recordSearch.run(requestId, pickup.id);
      const updated = this.pickup(context, pickup.id);
      return privateRooms ? this.startFilledRoom(updated) : updated;
    });
  }

  enroll(context, pickup, choice, requestedTeam) {
    if (pickup.status !== 'open') throw new PickupError('Las inscripciones ya cerraron.');
    if (pickup.format === DRAFT_QUEUE_FORMAT) throw new PickupError('Pulsa Entrar a la cola en la ficha actual.');
    const roster = this.roster(pickup.id);
    const current = roster.find((p) => p.user_id === context.user);
    if (!choice) {
      if (!current) return;
      if (current.party_id) {
        if (this.partyFor(context)?.leader_id !== context.user) throw new PickupError('El líder retira a todo el grupo de la cola.');
        this.db.prepare('DELETE FROM players WHERE pickup_id = ? AND party_id = ?').run(pickup.id, current.party_id);
      } else {
        this.db.prepare('DELETE FROM players WHERE pickup_id = ? AND user_id = ?').run(pickup.id, context.user);
      }
      this.touchQueue(pickup.id);
      return;
    }

    if (this.isKicked(pickup.id, context.user)) throw new PickupError('Fuiste vetado para esta pickup.');
    if (this.partyFor(context)) throw new PickupError('Tu líder puede inscribir al grupo con /pickup buscar.');
    if (requestedTeam !== undefined && pickup.format !== TEAM_QUEUE_FORMAT) {
      throw new PickupError('Usa los controles de la ficha actual para inscribirte.');
    }
    const active = this.activePickup(context.guild, context.user);
    if (active && active.id !== pickup.id) throw new PickupError(`Ya estás inscrito en la pickup #${active.id}.`);
    const others = roster.filter((p) => p.user_id !== context.user);
    let team = choice;
    let position = null;
    if (pickup.format === TEAM_QUEUE_FORMAT) {
      if (!Object.hasOwn(TEAM_NAMES, requestedTeam) || !Object.hasOwn(POSITIONS, choice)) {
        throw new PickupError('Elige tu posición en el menú de Azul o Rojo de la ficha actual.');
      }
      team = requestedTeam;
      position = choice;
      if (others.filter((p) => p.team === team && p.position === position).length >= POSITIONS[position] / 2) {
        throw new PickupError(`Ya se llenaron los cupos de ${position} en ${TEAM_NAMES[team]}.`);
      }
    } else if (pickup.format === 'positional') {
      if (!Object.hasOwn(POSITIONS, choice)) throw new PickupError('Elige una posición de la lista.');
      if (others.filter((p) => p.position === choice).length >= POSITIONS[choice]) {
        throw new PickupError(`Ya se llenaron los cupos de ${choice}.`);
      }
      position = choice;
      team = 'A'; // Al iniciar se asignan los equipos. Antes se muestra la cola por posición.
    } else {
      if (!Object.hasOwn(TEAM_NAMES, choice)) throw new PickupError('Elige un equipo válido.');
      if (others.filter((p) => p.team === choice).length >= pickup.team_size) {
        throw new PickupError(`El equipo ${TEAM_NAMES[choice]} ya está lleno.`);
      }
    }
    this.db.prepare(`
      INSERT INTO players (pickup_id, user_id, name, team, position) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT (pickup_id, user_id) DO UPDATE
      SET team = excluded.team, name = excluded.name, position = excluded.position
    `).run(pickup.id, context.user, context.name, team, position);
    if (!current || current.team !== team || current.position !== position) this.touchQueue(pickup.id);
  }

  start(pickup) {
    if (pickup.status !== 'open') throw new PickupError('La pickup debe estar en inscripciones.');
    if (pickup.format === DRAFT_QUEUE_FORMAT) throw new PickupError('Abre Organizar equipos para asignar los puestos.');
    const roster = this.roster(pickup.id);
    if (roster.length !== pickup.team_size * 2) {
      throw new PickupError('Llena todos los cupos antes de iniciar la pickup.');
    }
    return this.transaction(() => {
      if (pickup.format === 'positional') {
        const blue = balancedTeams(roster.map((p) => {
          const { total, matches } = this.profile(pickup.guild_id, p.user_id);
          return { ...p, rating: matches ? total / matches : 70 };
        }));
        const assign = this.db.prepare('UPDATE players SET team = ? WHERE pickup_id = ? AND user_id = ?');
        for (const p of roster) assign.run(blue.has(p.user_id) ? 'A' : 'B', pickup.id, p.user_id);
      }
      return this.db.prepare("UPDATE pickups SET status = 'playing' WHERE id = ? RETURNING *").get(pickup.id);
    });
  }

  // The caller holds the enrollment transaction so the roster and room request commit together.
  startFilledRoom(pickup) {
    if (pickup.format !== TEAM_QUEUE_FORMAT || pickup.team_size !== DEFAULT_TEAM_SIZE ||
        this.roster(pickup.id).length !== DEFAULT_TEAM_SIZE * 2) return pickup;
    return this.beginPlaying(pickup, true);
  }

  beginPlaying(pickup, privateRooms) {
    const started = this.db.prepare("UPDATE pickups SET status = 'playing' WHERE id = ? AND status = 'open' RETURNING *")
      .get(pickup.id);
    if (!started) return pickup;
    if (privateRooms) this.db.prepare(`INSERT INTO pickup_rooms (pickup_id) VALUES (?)
      ON CONFLICT(pickup_id) DO UPDATE SET roster_version = roster_version + 1`).run(pickup.id);
    return started;
  }

  room(pickupId) {
    return this.db.prepare('SELECT * FROM pickup_rooms WHERE pickup_id = ?').get(pickupId);
  }

  isRoom(guild, channel) {
    return Boolean(this.db.prepare(`SELECT 1 FROM pickup_rooms r JOIN pickups p ON p.id = r.pickup_id
      WHERE p.guild_id = ? AND r.channel_id = ?`).get(guild, channel));
  }

  pendingRooms(guild = null) {
    return this.db.prepare(`SELECT p.*, r.channel_id AS room_channel_id, r.roster_version, r.room_version,
        r.lineup_message_id, r.announced FROM pickup_rooms r
      JOIN pickups p ON p.id = r.pickup_id
      WHERE p.guild_id = COALESCE(?, p.guild_id) AND ((p.status IN ('open','playing','voting') AND r.roster_version <> r.room_version)
        OR (r.announced = 0 AND p.status IN ('playing','voting')))
      ORDER BY p.id LIMIT 5`).all(guild);
  }

  saveRoomChannel(pickupId, channel) {
    this.db.prepare('UPDATE pickup_rooms SET channel_id = ? WHERE pickup_id = ?').run(channel, pickupId);
  }

  markRoomSynced(id, version) {
    this.db.prepare('UPDATE pickup_rooms SET room_version = ? WHERE pickup_id = ?').run(version, id);
  }

  markRoomAnnounced(pickupId, version = 0) {
    this.db.prepare('UPDATE pickup_rooms SET announced = 1 WHERE pickup_id = ? AND roster_version = ?').run(pickupId, version);
  }

  activeLineup(guild, id) {
    return this.db.prepare(`SELECT p.id, r.channel_id AS room_channel_id, r.roster_version FROM pickup_rooms r
      JOIN pickups p ON p.id = r.pickup_id WHERE p.guild_id = ? AND p.id = ?
      AND r.announced = 1 AND r.room_version = r.roster_version AND r.channel_id IS NOT NULL
      AND p.status IN ('playing','voting')`).get(guild, id);
  }

  lineupWaiting(guild, id) {
    return Boolean(this.db.prepare(`SELECT 1 FROM pickups p JOIN pickup_rooms r ON r.pickup_id = p.id
      WHERE p.guild_id = ? AND p.id = ? AND p.status IN ('open','playing') AND r.announced = 0`).get(guild, id));
  }

  lineupsToPublish(guild = null) {
    return this.db.prepare(`SELECT p.id, p.guild_id, r.channel_id, r.roster_version, r.lineup_message_id FROM pickup_rooms r
      JOIN pickups p ON p.id = r.pickup_id WHERE r.announced = 1 AND r.lineup_posted = 0
      AND r.room_version = r.roster_version AND r.channel_id IS NOT NULL AND p.status IN ('playing','voting')
      AND p.guild_id = COALESCE(?, p.guild_id) ORDER BY p.id LIMIT 5`).all(guild);
  }

  rememberLineupMessage(id, message) {
    this.db.prepare('UPDATE pickup_rooms SET lineup_message_id = ? WHERE pickup_id = ?').run(message, id);
  }

  markLineupPosted(id, version) {
    this.db.prepare('UPDATE pickup_rooms SET lineup_posted = 1 WHERE pickup_id = ? AND roster_version = ?').run(id, version);
  }

  expiredRooms(guild = null) {
    return this.db.prepare(`SELECT r.*, p.guild_id FROM pickup_rooms r JOIN pickups p ON p.id = r.pickup_id
      WHERE p.guild_id = COALESCE(?, p.guild_id) AND (delete_after <= ? OR p.expired = 1) ORDER BY delete_after LIMIT 5`).all(guild, this.now());
  }

  forgetRoom(pickupId) {
    this.db.prepare('DELETE FROM pickup_rooms WHERE pickup_id = ?').run(pickupId);
  }

  finishedProgress(pickup) {
    const count = this.db.prepare('SELECT COUNT(*) AS count FROM finished_votes WHERE pickup_id = ?').get(pickup.id).count;
    return { count, required: pickup.team_size };
  }

  voteFinished(pickup, user) {
    if (pickup.status !== 'playing') throw new PickupError('La partida ya salió de la etapa de juego.');
    if (!this.roster(pickup.id).some((p) => p.user_id === user)) throw new PickupError('Solo votan quienes jugaron esta pickup.');
    return this.transaction(() => {
      this.db.prepare('INSERT OR IGNORE INTO finished_votes (pickup_id, voter) VALUES (?, ?)').run(pickup.id, user);
      const { count, required } = this.finishedProgress(pickup);
      if (count < required) return pickup;
      if (pickup.friendly) return this.setPickupEnd(pickup, 'closed');
      return this.db.prepare(`
        UPDATE pickups SET status = 'voting', vote_until = ? WHERE id = ? RETURNING *
      `).get(this.now() + DEFAULT_VOTE_MINUTES * 60_000, pickup.id);
    });
  }

  finish(pickup, actor, { outcome, minutes, score }) {
    if (pickup.friendly) throw new PickupError('Para terminar una amistosa, pulsa Confirmar fin o usa /pickup cerrar.');
    if (pickup.status !== 'playing' && pickup.status !== 'voting') {
      throw new PickupError('La pickup debe estar en juego o evaluación para registrar el resultado.');
    }
    if (pickup.status === 'playing' && this.roster(pickup.id).some((p) => p.user_id === actor)) {
      throw new PickupError('Si jugaste esta partida, usa Confirmar fin y espera las confirmaciones o pide el resultado a un organizador que no jugó.');
    }
    if (pickup.status === 'voting' && minutes !== undefined) {
      throw new PickupError('La votación ya está abierta. Registra el resultado sin indicar minutos.');
    }
    if (score === undefined && !Object.hasOwn(OUTCOMES, outcome)) {
      throw new PickupError('Indica el marcador o el resultado.');
    }
    const savedScore = pickup.score_a !== null ? `${pickup.score_a}-${pickup.score_b}` : undefined;
    score ??= savedScore;
    let blue = null;
    let red = null;
    if (score !== undefined) {
      const parsed = /^([0-9]{1,2})\s*-\s*([0-9]{1,2})$/.exec(score.trim());
      if (!parsed) throw new PickupError('Escribe los goles en orden Azul-Rojo. Ejemplo 3-1.');
      [blue, red] = parsed.slice(1).map(Number);
      const inferred = blue === red ? 'draw' : blue > red ? 'A' : 'B';
      if (outcome && outcome !== inferred) throw new PickupError('El ganador indicado contradice el marcador.');
      outcome = inferred;
    }
    const deadline = pickup.vote_until ?? this.now() + (minutes ?? DEFAULT_VOTE_MINUTES) * 60_000;
    return this.db.prepare(`
      UPDATE pickups SET status = 'voting', outcome = ?, vote_until = ?, score_a = ?, score_b = ?, result_by = ?
      WHERE id = ? RETURNING *
    `).get(outcome, deadline, blue, red, actor, pickup.id);
  }

  voteCandidates(pickup, user) {
    if (pickup.friendly) throw new PickupError('Las amistosas se juegan sin votación MVP.');
    if (pickup.status !== 'voting' || this.now() >= pickup.vote_until) {
      throw new PickupError('La votación MVP está cerrada.');
    }
    const players = this.roster(pickup.id);
    if (!players.some((p) => p.user_id === user)) throw new PickupError('Solo votan quienes jugaron esta pickup.');
    return players.filter((p) => p.user_id !== user);
  }

  vote(pickup, voter, candidate) {
    if (!this.voteCandidates(pickup, voter).some((p) => p.user_id === candidate)) {
      throw new PickupError('Elige a otro jugador de esta pickup.');
    }
    this.db.prepare(`
      INSERT INTO votes (pickup_id, voter, candidate) VALUES (?, ?, ?)
      ON CONFLICT (pickup_id, voter) DO UPDATE SET candidate = excluded.candidate
    `).run(pickup.id, voter, candidate);
  }

  voteCount(id) {
    return this.db.prepare('SELECT COUNT(*) AS count FROM votes WHERE pickup_id = ?').get(id).count;
  }

  mvps(id) {
    return this.db.prepare(`
      SELECT candidate AS user_id, COUNT(*) AS votes FROM votes WHERE pickup_id = ?
      GROUP BY candidate ORDER BY votes DESC, user_id
    `).all(id).filter((row, _, tally) => row.votes === tally[0].votes);
  }

  reviewRoster(pickup) {
    if (pickup.friendly) throw new PickupError('Las amistosas se juegan sin notas.');
    if (pickup.status !== 'voting') throw new PickupError('La pickup debe estar en evaluación para calificar. Las notas cerradas quedan en el historial.');
    return this.roster(pickup.id);
  }

  grade(pickup, staff, entries) {
    const roster = this.reviewRoster(pickup);
    if (entries.some(({ user }) => !roster.some((p) => p.user_id === user))) {
      throw new PickupError('Ese usuario no jugó en esta pickup.');
    }
    const update = this.db.prepare('UPDATE players SET grade = ?, graded_by = ? WHERE pickup_id = ? AND user_id = ?');
    this.transaction(() => {
      for (const { user, grade } of entries) update.run(grade, staff, pickup.id, user);
    });
  }

  close(pickup) {
    if (pickup.status === 'closed') return pickup;
    if (pickup.friendly && pickup.status === 'playing') return this.endPickup(pickup, 'closed');
    const roster = this.reviewRoster(pickup);
    if (!pickup.outcome) throw new PickupError('Registra el marcador o resultado con /pickup terminar antes de cerrar.');
    const missing = roster.filter((p) => p.grade === null).length;
    if (missing) throw new PickupError(`Faltan ${missing} notas. Usa /pickup calificar.`);
    if (this.now() < pickup.vote_until && this.voteCount(pickup.id) < roster.length) {
      throw new PickupError(`La votación sigue abierta hasta <t:${Math.ceil(pickup.vote_until / 1000)}:t> o hasta que todos voten.`);
    }
    return this.endPickup(pickup, 'closed');
  }

  cancel(pickup) {
    if (pickup.status === 'closed') throw new PickupError('Esa pickup ya está cerrada.');
    return this.endPickup(pickup, 'canceled');
  }

  endPickup(pickup, status) {
    return this.transaction(() => this.setPickupEnd(pickup, status));
  }

  setPickupEnd(pickup, status) {
    const retention = pickup.friendly && status === 'closed' ? 0 : ROOM_RETENTION_HOURS * 3_600_000;
    this.db.prepare('UPDATE pickup_rooms SET delete_after = COALESCE(delete_after, ?) WHERE pickup_id = ?')
      .run(this.now() + retention, pickup.id);
    return this.db.prepare('UPDATE pickups SET status = ? WHERE id = ? RETURNING *').get(status, pickup.id);
  }

  profile(guild, user) {
    return this.db.prepare(`
      SELECT COUNT(*) AS matches, COALESCE(SUM(p.grade), 0) AS total, COALESCE(SUM(m.outcome = p.team), 0) AS wins
      FROM players p JOIN pickups m ON m.id = p.pickup_id
      WHERE m.guild_id = ? AND m.status = 'closed' AND m.friendly = 0 AND p.user_id = ?
    `).get(guild, user);
  }

  profileAchievements(guild, user) {
    const results = this.db.prepare(`
      WITH played AS (
        SELECT m.id, m.outcome = p.team AS won
        FROM players p JOIN pickups m ON m.id = p.pickup_id
        WHERE m.guild_id = ? AND m.status = 'closed' AND m.friendly = 0 AND p.user_id = ?
      ), vote_ranks AS (
        SELECT pickup_id, candidate, RANK() OVER (PARTITION BY pickup_id ORDER BY COUNT(*) DESC) AS place
        FROM votes WHERE pickup_id IN (SELECT id FROM played) GROUP BY pickup_id, candidate
      )
      SELECT p.won, v.place = 1 AS mvp FROM played p
      LEFT JOIN vote_ranks v ON v.pickup_id = p.id AND v.candidate = ? ORDER BY p.id
    `).all(guild, user, user);
    let wins = 0, mvps = 0, streak = 0, current = 0;
    for (const { won, mvp } of results) {
      if (mvp) mvps++;
      if (won) {
        wins++;
        streak = Math.max(streak, ++current);
      } else current = 0;
    }
    return { wins, mvps, streak };
  }

  profileStyle({ guild, user }) {
    return this.db.prepare('SELECT frame, title, position FROM profile_styles WHERE guild_id = ? AND user_id = ?').get(guild, user) ?? {};
  }

  setProfileStyle(context, changes) {
    const { frame = null, title = null, position = null } = { ...this.profileStyle(context), ...changes };
    this.db.prepare(`INSERT INTO profile_styles (guild_id, user_id, frame, title, position) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT (guild_id, user_id) DO UPDATE SET frame = excluded.frame, title = excluded.title, position = excluded.position`)
      .run(context.guild, context.user, frame, title, position);
  }

  history(guild, user) {
    return this.db.prepare(`
      SELECT m.id, p.grade, m.outcome, p.team FROM players p JOIN pickups m ON m.id = p.pickup_id
      WHERE m.guild_id = ? AND m.status = 'closed' AND m.friendly = 0 AND p.user_id = ?
      ORDER BY m.id DESC LIMIT 5
    `).all(guild, user);
  }

  ranking(guild, minimum) {
    return this.db.prepare(`
      SELECT p.user_id, COUNT(*) AS matches, SUM(p.grade) AS total, COALESCE(SUM(m.outcome = p.team), 0) AS wins
      FROM players p JOIN pickups m ON m.id = p.pickup_id
      WHERE m.guild_id = ? AND m.status = 'closed' AND m.friendly = 0
      GROUP BY p.user_id HAVING COUNT(*) >= ?
      ORDER BY AVG(p.grade) DESC, matches DESC, p.user_id LIMIT 15
    `).all(guild, minimum);
  }
}
