const fs = require("fs");
const path = require("path");

const readRoot = (name) => {
    const root = path.join(__dirname, "..", "..");
    return fs.readFileSync(path.join(root, name), "utf8");
};

describe("LLM cost controls docs", () => {
    it("documents model/env knobs and auto-reprocessing notes", () => {
        const readme = readRoot("README.md");
        const agents = readRoot("AGENTS.md");

        // Env knobs (model selection)
        expect(readme).toMatch(/VOICEBOT_CATEGORIZATION_MODEL/);
        expect(readme).toMatch(/VOICEBOT_TASK_CREATION_MODEL/);
        expect(agents).toMatch(/VOICEBOT_CATEGORIZATION_MODEL/);
        expect(agents).toMatch(/VOICEBOT_TASK_CREATION_MODEL/);

        // Auto-reprocessing / retry notes
        expect(readme).toMatch(/automatic recovery|auto-queue|auto-requeue|auto-unblocked|auto-retry/i);
        expect(agents).toMatch(/processing_loop\.js/);
        expect(agents).toMatch(/insufficient_quota/i);
    });
});
