const prompts = require("../../voicebot/prompts/manifest");

describe("LLM prompt length cost controls", () => {
    it("categorization and task creation prompts stay bounded (token spend guardrail)", () => {
        expect(typeof prompts.CATEGORIZATION).toBe("string");
        expect(typeof prompts.TASK_CREATION).toBe("string");

        // Guardrail: these prompts are expected to be concise.
        expect(prompts.CATEGORIZATION.length).toBeGreaterThan(50);
        expect(prompts.CATEGORIZATION.length).toBeLessThanOrEqual(2000);

        expect(prompts.TASK_CREATION.length).toBeGreaterThan(50);
        expect(prompts.TASK_CREATION.length).toBeLessThanOrEqual(2000);
    });
});
