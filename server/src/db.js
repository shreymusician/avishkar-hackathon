import { MongoClient } from 'mongodb';
import { createMongoUsers } from './users.js';

/**
 * Connects to MongoDB Atlas. Resolves to a small store, or to null when no URI
 * is configured or the connection fails: the app then runs without history.
 *
 * @param {{uri: string, dbName: string, log?: {info: Function, warn: Function}}} options
 */
export async function connectStore({ uri, dbName, log = console }) {
  if (!uri) {
    log.info('[db] MONGODB_URI not set, running without history');
    return null;
  }
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 5000 });
  try {
    await client.connect();
    const sessions = client.db(dbName).collection('sessions');
    await sessions.createIndex({ startedAt: -1 });
    const accounts = client.db(dbName).collection('users');
    await accounts.createIndex({ phone: 1 }, { unique: true });
    await accounts.createIndex({ id: 1 }, { unique: true });
    log.info('[db] connected to MongoDB');

    return {
      users: createMongoUsers(accounts),
      async saveSession(summary) {
        await sessions.insertOne(summary);
      },
      async recentSessions(limit = 20) {
        const rows = await sessions.find({}, { projection: { _id: 0 } }).sort({ startedAt: -1 }).limit(limit).toArray();
        return rows;
      },
      async totals() {
        const [row] = await sessions
          .aggregate([
            {
              $group: {
                _id: null,
                sessions: { $sum: 1 },
                commands: { $sum: '$commands' },
                driveMs: { $sum: '$totalDriveMs' },
              },
            },
          ])
          .toArray();
        return { sessions: row?.sessions ?? 0, commands: row?.commands ?? 0, driveMs: row?.driveMs ?? 0 };
      },
      close: () => client.close(),
    };
  } catch (err) {
    // The message can echo the connection string host; never log the URI itself.
    log.warn(`[db] could not connect, running without history: ${err.name}`);
    await client.close().catch(() => {});
    return null;
  }
}
