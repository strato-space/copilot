const fs = require("fs");
const path = require("path");

const readRootFile = (name) => {
    const root = path.join(__dirname, "..");
    return fs.readFileSync(path.join(root, name), "utf8");
};

describe("BullMQ defaultJobOptions retention", () => {
    it("voicebot-backend.js sets bounded defaultJobOptions retention", () => {
        const content = readRootFile("voicebot-backend.js");

        expect(content).toMatch(/defaultJobOptions\s*:\s*\{/);
        expect(content).toMatch(/removeOnComplete\s*:\s*\{[\s\S]*age\s*:\s*3600[\s\S]*count\s*:\s*100/);
        expect(content).toMatch(/removeOnFail\s*:\s*\{[\s\S]*age\s*:\s*86400[\s\S]*count\s*:\s*500/);
        expect(content).not.toMatch(/removeOnComplete\s*:\s*false/);
        expect(content).not.toMatch(/removeOnFail\s*:\s*false/);
    });

    it("voicebot-tgbot.js sets bounded defaultJobOptions retention", () => {
        const content = readRootFile("voicebot-tgbot.js");

        expect(content).toMatch(/defaultJobOptions\s*:\s*\{/);
        expect(content).toMatch(/removeOnComplete\s*:\s*\{[\s\S]*age\s*:\s*3600[\s\S]*count\s*:\s*100/);
        expect(content).toMatch(/removeOnFail\s*:\s*\{[\s\S]*age\s*:\s*86400[\s\S]*count\s*:\s*500/);
        expect(content).not.toMatch(/removeOnComplete\s*:\s*false/);
        expect(content).not.toMatch(/removeOnFail\s*:\s*false/);
    });
});
