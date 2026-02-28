#!/usr/bin/env tsx
import 'dotenv/config';
import { MongoClient } from 'mongodb';
import { RUNTIME_SCOPED_COLLECTIONS } from '../src/services/runtimeScope.js';

const argv = new Set(process.argv.slice(2));
const apply = argv.has('--apply');

const resolveMongoUri = (): string => {
    const value = process.env.MONGODB_CONNECTION_STRING;
    if (!value) throw new Error('MONGODB_CONNECTION_STRING is not set');
    return value;
};

const resolveDbName = (): string => {
    const value = process.env.DB_NAME;
    if (!value) throw new Error('DB_NAME is not set');
    return value;
};

async function main(): Promise<void> {
    const mongoUri = resolveMongoUri();
    const dbName = resolveDbName();
    const client = new MongoClient(mongoUri);
    await client.connect();
    const db = client.db(dbName);

    try {
        const filter = {
            $or: [
                { runtime_tag: { $exists: false } },
                { runtime_tag: null },
                { runtime_tag: '' },
            ],
        };

        console.log(`runtime-tag-backfill mode=${apply ? 'apply' : 'dry-run'}`);
        for (const collectionName of RUNTIME_SCOPED_COLLECTIONS) {
            const collection = db.collection(collectionName);
            const pending = await collection.countDocuments(filter);
            if (pending === 0) {
                console.log(`runtime-tag-backfill ${collectionName}: pending=0`);
                continue;
            }

            if (!apply) {
                console.log(`runtime-tag-backfill ${collectionName}: pending=${pending} (dry-run)`);
                continue;
            }

            const result = await collection.updateMany(
                filter,
                { $set: { runtime_tag: 'prod' } }
            );
            console.log(
                `runtime-tag-backfill ${collectionName}: pending=${pending}, modified=${result.modifiedCount}`
            );
        }
    } finally {
        await client.close();
    }
}

main().catch((error) => {
    console.error('runtime-tag-backfill failed:', error);
    process.exitCode = 1;
});
