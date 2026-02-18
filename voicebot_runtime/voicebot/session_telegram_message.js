const { ObjectId } = require("mongodb");
const constants = require("../constants");

const FALLBACK_VALUE = "—";

const getPublicInterfaceBase = () => {
    const rawBase = (process.env.VOICE_WEB_INTERFACE_URL || "https://voice.stratospace.fun").replace(/\/+$/, "");
    return rawBase.includes("176.124.201.53") ? "https://voice.stratospace.fun" : rawBase;
};

const buildSessionLink = (sessionId) => {
    const sid = String(sessionId || "").trim();
    if (!sid) return `${getPublicInterfaceBase()}/session`;
    return `${getPublicInterfaceBase()}/session/${sid}`;
};

const normalizeSessionId = (session) => {
    const raw = session?._id || session?.session_id || session?.id || "";
    return String(raw || "").trim();
};

const normalizeSessionName = (session) => {
    const name = session?.session_name;
    if (typeof name === "string" && name.trim()) return name.trim();
    return FALLBACK_VALUE;
};

const resolveProjectName = async ({ db, session }) => {
    const projectIdRaw = session?.project_id;
    if (!projectIdRaw) return FALLBACK_VALUE;

    let projectObjectId = null;
    if (projectIdRaw instanceof ObjectId) {
        projectObjectId = projectIdRaw;
    } else if (typeof projectIdRaw === "string" && ObjectId.isValid(projectIdRaw)) {
        projectObjectId = new ObjectId(projectIdRaw);
    }
    if (!projectObjectId) return FALLBACK_VALUE;

    const project = await db.collection(constants.collections.PROJECTS).findOne(
        { _id: projectObjectId },
        { projection: { name: 1, title: 1 } }
    );
    if (project?.name && String(project.name).trim()) return String(project.name).trim();
    if (project?.title && String(project.title).trim()) return String(project.title).trim();
    return FALLBACK_VALUE;
};

const formatTelegramSessionEventMessage = async ({ db, session, eventName }) => {
    const sid = normalizeSessionId(session);
    const friendlyEvent = String(eventName || "").trim() || FALLBACK_VALUE;
    const sessionName = normalizeSessionName(session);
    const projectName = await resolveProjectName({ db, session });
    const url = buildSessionLink(sid);

    return [
        friendlyEvent,
        url,
        sessionName,
        projectName,
    ].join("\n");
};

module.exports = {
    buildSessionLink,
    formatTelegramSessionEventMessage,
};
