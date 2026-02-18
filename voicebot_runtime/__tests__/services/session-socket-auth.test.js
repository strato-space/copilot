const constants = require("../../constants");
const { PERMISSIONS } = require("../../permissions/permissions-config");
const { computeSessionAccess } = require("../../services/session-socket-auth");

describe("computeSessionAccess", () => {
  it("grants access with READ_ALL", () => {
    const result = computeSessionAccess({
      session: { chat_id: 111 },
      performer: { telegram_id: "999" },
      userPermissions: [PERMISSIONS.VOICEBOT_SESSIONS.READ_ALL],
    });

    expect(result.hasAccess).toBe(true);
    expect(result.canReadAll).toBe(true);
  });

  it("grants own access by chat_id match", () => {
    const result = computeSessionAccess({
      session: { chat_id: 111 },
      performer: { telegram_id: "111", _id: "u1" },
      userPermissions: [PERMISSIONS.VOICEBOT_SESSIONS.READ_OWN],
    });

    expect(result.hasAccess).toBe(true);
  });

  it("grants access to PUBLIC session when project is in performer.projects_access", () => {
    const result = computeSessionAccess({
      session: {
        project_id: "proj_1",
        access_level: constants.voice_bot_session_access.PUBLIC,
      },
      performer: {
        _id: "u1",
        projects_access: ["proj_1", "proj_2"],
      },
      userPermissions: [PERMISSIONS.VOICEBOT_SESSIONS.READ_OWN],
    });

    expect(result.hasAccess).toBe(true);
  });

  it("grants access to RESTRICTED session when performer is in allowed_users", () => {
    const result = computeSessionAccess({
      session: {
        access_level: constants.voice_bot_session_access.RESTRICTED,
        allowed_users: ["u1", "u2"],
      },
      performer: { _id: "u2" },
      userPermissions: [PERMISSIONS.VOICEBOT_SESSIONS.READ_OWN],
    });

    expect(result.hasAccess).toBe(true);
  });

  it("denies access without read permissions", () => {
    const result = computeSessionAccess({
      session: {
        chat_id: 111,
        access_level: constants.voice_bot_session_access.PUBLIC,
        project_id: "proj_1",
      },
      performer: { telegram_id: "111", projects_access: ["proj_1"] },
      userPermissions: [],
    });

    expect(result.hasAccess).toBe(false);
    expect(result.canReadOwn).toBe(false);
    expect(result.canReadAll).toBe(false);
  });

  it("tracks UPDATE permission separately", () => {
    const result = computeSessionAccess({
      session: { chat_id: 111 },
      performer: { telegram_id: "111" },
      userPermissions: [
        PERMISSIONS.VOICEBOT_SESSIONS.READ_OWN,
        PERMISSIONS.VOICEBOT_SESSIONS.UPDATE,
      ],
    });

    expect(result.hasAccess).toBe(true);
    expect(result.canUpdateSession).toBe(true);
  });
});
