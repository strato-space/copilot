const fs = require("fs");
const path = require("path");

const readPlan = (name) => {
    const root = path.join(__dirname, "..", "..");
    return fs.readFileSync(path.join(root, "plan", name), "utf8");
};

describe("session-managment.md spec smoke", () => {
    it("documents active-session model, commands, and WYSIWYG button semantics", () => {
        const spec = readPlan("session-managment.md");

        expect(spec).toMatch(/`active-session`\s+is\s+a\s+per-user\s+attribute/i);
        expect(spec).toMatch(/pageSessionId/i);

        // Telegram commands
        expect(spec).toMatch(/###\s+`\/start`/);
        expect(spec).toMatch(/###\s+`\/session`/);
        expect(spec).toMatch(/###\s+`\/done`/);
        expect(spec).toMatch(/###\s+`\/login`/);

        // Link normalization
        expect(spec).toMatch(/https:\/\/voice\.stratospace\.fun\/session\/<id>/);

        // UI/FAB contract
        expect(spec).toMatch(/Buttons order is fixed and matches FAB: `New \/ Rec \/ Cut \/ Pause \/ Done`\./);
        expect(spec).toMatch(/WebRTC FAB behavior/i);
    });
});
