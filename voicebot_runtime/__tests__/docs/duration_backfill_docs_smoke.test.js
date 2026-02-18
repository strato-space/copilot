const fs = require("fs");
const path = require("path");

const readRoot = (name) => {
    const root = path.join(__dirname, "..", "..");
    return fs.readFileSync(path.join(root, name), "utf8");
};

describe("Duration backfill docs", () => {
    it("documents where uploaded audio lives and how ffprobe fallback is used", () => {
        const agents = readRoot("AGENTS.md");

        expect(agents).toMatch(/uploads\/audio\/sessions\/<session_id>\//);
        expect(agents).toMatch(/ffprobe/i);
        expect(agents).toMatch(/recalc_session_duration\.js/);
        expect(agents).toMatch(/file_path/);
    });
});
