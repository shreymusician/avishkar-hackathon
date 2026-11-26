import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

/**
 * User accounts kept in a JSON file. Used when MongoDB is not configured or unreachable, so signing in works on a
 * bare laptop too. Same shape as the MongoDB repository: findByPhone, findById, count, create.
 */
export function createFileUsers(path) {
  let users = null;
  let writing = Promise.resolve();

  const load = () => {
    if (users) return users;
    try {
      users = JSON.parse(readFileSync(path, 'utf8'));
      if (!Array.isArray(users)) users = [];
    } catch {
      users = [];
    }
    return users;
  };

  const save = () => {
    // One write at a time, and write-then-rename so a crash never leaves half a file.
    writing = writing.then(() => {
      mkdirSync(dirname(path), { recursive: true });
      const tmp = `${path}.tmp`;
      writeFileSync(tmp, JSON.stringify(users, null, 2), { mode: 0o600 });
      renameSync(tmp, path);
    });
    return writing;
  };

  return {
    async findByPhone(phone) {
      return load().find((u) => u.phone === phone) ?? null;
    },
    async findById(id) {
      return load().find((u) => u.id === id) ?? null;
    },
    async count() {
      return load().length;
    },
    async countAdmins() {
      return load().filter((u) => u.role === 'admin').length;
    },
    async updatePassword(id, passwordHash, passwordChangedAt) {
      const user = load().find((u) => u.id === id);
      if (!user) return;
      user.passwordHash = passwordHash;
      user.passwordChangedAt = passwordChangedAt;
      await save();
    },
    async create(user) {
      const all = load();
      if (all.some((u) => u.phone === user.phone)) throw Object.assign(new Error('duplicate phone'), { code: 11000 });
      all.push(user);
      await save();
    },
  };
}

/** The same four operations on a MongoDB collection. */
export function createMongoUsers(collection) {
  return {
    findByPhone: (phone) => collection.findOne({ phone }, { projection: { _id: 0 } }),
    findById: (id) => collection.findOne({ id }, { projection: { _id: 0 } }),
    count: () => collection.countDocuments(),
    countAdmins: () => collection.countDocuments({ role: 'admin' }),
    async updatePassword(id, passwordHash, passwordChangedAt) {
      await collection.updateOne({ id }, { $set: { passwordHash, passwordChangedAt } });
    },
    async create(user) {
      await collection.insertOne({ ...user });
    },
  };
}
