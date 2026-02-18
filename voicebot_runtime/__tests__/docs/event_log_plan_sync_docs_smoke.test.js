const fs = require("fs");
const path = require("path");

const readCopilotDoc = (name) => {
    const runtimeRoot = path.join(__dirname, "..", "..");
    const copilotRoot = path.join(runtimeRoot, "..");
    return fs.readFileSync(path.join(copilotRoot, "docs", "voicebot-plan-sync", name), "utf8");
};

describe("voicebot plan sync docs (event-log + diarization)", () => {
    it("keeps raw stakeholder requirements artifact for event-log baseline", () => {
        const req = readCopilotDoc("edit-event-log-req.md");

        expect(req).toMatch(/raw stakeholder|требован/i);
        expect(req).toMatch(/event[\-_ ]?log/i);
        expect(req).toMatch(/rollback|откат/i);
    });

    it("keeps event-log implementation draft with immutable/append-only/replay semantics", () => {
        const plan = readCopilotDoc("edit-event-log-plan.md");

        expect(plan).toMatch(/immutable|неизменяем/i);
        expect(plan).toMatch(/append[\-_ ]?only|append-only|добавлен/i);
        expect(plan).toMatch(/replay|projection|проекц/i);
    });

    it("keeps diarization contract transcription_raw -> transcription", () => {
        const diarize = readCopilotDoc("gpt-4o-transcribe-diarize-plan.md");

        expect(diarize).toMatch(/transcription_raw\s*[-=]>\s*transcription/i);
        expect(diarize).toMatch(/model-agnostic|канонич/i);
        expect(diarize).toMatch(/immutable|неизменяем/i);
    });
});
