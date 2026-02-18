const fs = require("fs");
const path = require("path");

const readFile = (relativePath) => {
    const root = path.join(__dirname, "..", "..");
    return fs.readFileSync(path.join(root, relativePath), "utf8");
};

describe("Redis username support", () => {
    it("Bull board / queue monitor reads REDIS_USERNAME", () => {
        const content = readFile("voicebot-queue-monitor.js");
        expect(content).toMatch(/REDIS_USERNAME/);
    });

    it("Redis diagnostics scripts read REDIS_USERNAME", () => {
        const scripts = [
            "cli/diagnostics/scan_redis_keys.js",
            "cli/diagnostics/check_queue_counts.js",
            "cli/diagnostics/check_postprocessors.js",
        ];

        for (const script of scripts) {
            const content = readFile(script);
            expect(content).toMatch(/REDIS_USERNAME/);
        }
    });
});
