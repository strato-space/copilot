require("dotenv-expand").expand(require("dotenv").config());

const fs = require("fs");
const { MongoClient, ObjectId } = require("mongodb");
const constants = require("../../constants");
const { resolveMessageDurationSeconds } = require("../../services/transcriptionTimeline");
const { getAudioDuration } = require("../../utils/audio_utils");

const sessionId = process.argv[2];
const apply = process.argv.includes("--apply");

if (!sessionId) {
    console.error("Usage: node cli/diagnostics/recalc_session_duration.js <sessionId> [--apply]");
    process.exit(1);
}

const buildMongoUri = () => {
    const dbName = process.env.DB_NAME || process.env.MONGODB_DB || process.env.MONGO_DB;
    if (!dbName) {
        throw new Error("Missing DB_NAME (or MONGODB_DB/MONGO_DB) in .env");
    }

    let uri = process.env.DB_CONNECTION_STRING;
    if (!uri) {
        const user = process.env.MONGO_USER || "";
        const pass = process.env.MONGO_PASSWORD || "";
        const host = process.env.MONGODB_HOST || "localhost";
        const port = process.env.MONGODB_PORT || "27017";
        uri = `mongodb://${encodeURIComponent(user)}:${encodeURIComponent(pass)}@${host}:${port}/${dbName}?authSource=admin`;
    }

    if (process.env.MONGO_DIRECT === "true") {
        uri += uri.includes("?") ? "&directConnection=true" : "?directConnection=true";
    }

    return { uri, dbName };
};

const roundSeconds = (value) => {
    if (!Number.isFinite(value)) return 0;
    return Math.round(value * 1000) / 1000;
};

const resolveMessageDuration = async (message) => {
    let duration = resolveMessageDurationSeconds({ message, chunks: message?.transcription_chunks });
    let source = "message/chunks";
    let resolved = duration != null && duration > 0;

    if (!resolved && typeof message?.file_path === "string" && message.file_path.trim()) {
        const filePath = message.file_path.trim();
        if (fs.existsSync(filePath)) {
            try {
                const probed = await getAudioDuration(filePath);
                if (Number.isFinite(probed) && probed > 0) {
                    duration = probed;
                    source = "ffprobe:file_path";
                    resolved = true;
                }
            } catch (error) {
                source = `unresolved:${error?.message || error}`;
            }
        } else {
            source = "unresolved:file_missing";
        }
    }

    return {
        duration: duration != null && duration > 0 ? duration : null,
        source,
        resolved,
    };
};

const main = async () => {
    if (!ObjectId.isValid(sessionId)) {
        throw new Error(`Invalid ObjectId: ${sessionId}`);
    }

    const { uri, dbName } = buildMongoUri();
    const client = new MongoClient(uri, { connectTimeoutMS: 10000 });
    await client.connect();

    try {
        const db = client.db(dbName);
        const sessionObjectId = new ObjectId(sessionId);

        const session = await db.collection(constants.collections.VOICE_BOT_SESSIONS).findOne({ _id: sessionObjectId });
        if (!session) {
            throw new Error(`Session not found: ${sessionId}`);
        }

        const messages = await db.collection(constants.collections.VOICE_BOT_MESSAGES)
            .find({ session_id: sessionObjectId })
            .sort({ message_timestamp: 1, message_id: 1 })
            .toArray();

        let totalDuration = 0;
        const updates = [];
        const details = [];
        let unresolvedMessages = 0;

        for (const message of messages) {
            const { duration, source, resolved } = await resolveMessageDuration(message);
            const rounded = resolved ? roundSeconds(duration) : null;
            if (resolved && rounded != null) {
                totalDuration += rounded;
            } else {
                unresolvedMessages += 1;
            }

            const currentDuration = Number(message?.duration);
            const needsMessageUpdate = resolved &&
                (
                    !Number.isFinite(currentDuration) ||
                    Math.abs(currentDuration - rounded) > 1e-6
                );

            details.push({
                message_id: message?.message_id ?? null,
                message_oid: message?._id?.toString?.() || String(message?._id),
                duration_before: Number.isFinite(currentDuration) ? currentDuration : null,
                duration_after: rounded,
                source,
                resolved,
                updated: needsMessageUpdate,
            });

            if (needsMessageUpdate) {
                updates.push({
                    updateOne: {
                        filter: { _id: message._id },
                        update: {
                            $set: {
                                duration: rounded,
                                "file_metadata.duration": rounded,
                                updated_at: new Date(),
                            }
                        }
                    }
                });
            }
        }

        const totalRounded = roundSeconds(totalDuration);
        const sessionUpdate = {
            duration: totalRounded,
            duration_seconds: totalRounded,
            updated_at: new Date(),
        };

        if (apply) {
            if (updates.length > 0) {
                await db.collection(constants.collections.VOICE_BOT_MESSAGES).bulkWrite(updates, { ordered: false });
            }
            await db.collection(constants.collections.VOICE_BOT_SESSIONS).updateOne(
                { _id: sessionObjectId },
                { $set: sessionUpdate }
            );
        }

        const payload = {
            session_id: sessionId,
            apply,
            message_count: messages.length,
            changed_messages: updates.length,
            unresolved_messages: unresolvedMessages,
            session_duration_before: Number.isFinite(Number(session?.duration)) ? Number(session.duration) : null,
            session_duration_after: totalRounded,
            session_update: sessionUpdate,
            details,
        };

        console.log(JSON.stringify(payload, null, 2));
    } finally {
        await client.close();
    }
};

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
