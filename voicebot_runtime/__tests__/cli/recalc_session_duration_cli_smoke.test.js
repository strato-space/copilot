const fs = require("fs");
const path = require("path");

describe("recalc_session_duration CLI", () => {
    it("exists and supports --apply backfill mode", () => {
        const root = path.join(__dirname, "..", "..");
        const scriptPath = path.join(root, "cli", "diagnostics", "recalc_session_duration.js");
        const source = fs.readFileSync(scriptPath, "utf8");

        expect(source).toContain('recalc_session_duration');
        expect(source).toMatch(/--apply/);
        expect(source).toMatch(/resolveMessageDurationSeconds/);
    });
});
