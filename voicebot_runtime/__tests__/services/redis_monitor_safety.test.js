const { RedisMonitor } = require("../../voicebot/redis_monitor");

describe("RedisMonitor safety rails", () => {
    it("cleanQueue only cleans completed/failed history and trims events", async () => {
        const redis = {
            info: jest.fn(async () => "used_memory:10\r\nmaxmemory:100\r\nused_memory_human:10B\r\nmaxmemory_human:100B\r\nmaxmemory_policy:noeviction\r\n"),
        };
        const logger = {
            info: jest.fn(),
            warn: jest.fn(),
            error: jest.fn(),
        };

        const queue = {
            clean: jest.fn(async (_graceMs, _limit, state) => {
                if (state === "completed") return [{ id: 1 }, { id: 2 }];
                if (state === "failed") return [{ id: 3 }];
                return [];
            }),
            trimEvents: jest.fn(async () => undefined),
        };

        const monitor = new RedisMonitor(redis, logger, 80);
        const cleaned = await monitor.cleanQueue(queue, "voicebot--processors");

        expect(cleaned).toBe(3);
        expect(queue.clean).toHaveBeenCalledWith(3600000, 1000, "completed");
        expect(queue.clean).toHaveBeenCalledWith(86400000, 500, "failed");
        expect(queue.clean).not.toHaveBeenCalledWith(expect.anything(), expect.anything(), "wait");
        expect(queue.trimEvents).toHaveBeenCalledWith(10000);
    });

    it("emergencyCleanup never deletes waiting/active work (history-only), trims events streams", async () => {
        const redis = {
            info: jest.fn(async () => "used_memory:90\r\nmaxmemory:100\r\nused_memory_human:90B\r\nmaxmemory_human:100B\r\nmaxmemory_policy:noeviction\r\n"),
        };
        const logger = {
            info: jest.fn(),
            warn: jest.fn(),
            error: jest.fn(),
        };

        const makeQueue = () => ({
            clean: jest.fn(async (_graceMs, _limit, state) => {
                if (state === "completed") return [{ id: "c" }];
                if (state === "failed") return [{ id: "f" }, { id: "f2" }];
                return [];
            }),
            trimEvents: jest.fn(async () => undefined),
        });

        const queues = {
            "voicebot--voice": makeQueue(),
            "voicebot--processors": makeQueue(),
        };

        const monitor = new RedisMonitor(redis, logger, 80);
        const removed = await monitor.emergencyCleanup(queues);

        expect(removed).toBe(6); // (1 completed + 2 failed) * 2 queues

        for (const q of Object.values(queues)) {
            expect(q.clean).toHaveBeenCalledWith(0, 10000, "completed");
            expect(q.clean).toHaveBeenCalledWith(0, 5000, "failed");
            expect(q.clean).not.toHaveBeenCalledWith(expect.anything(), expect.anything(), "wait");
            expect(q.trimEvents).toHaveBeenCalledWith(2000);
        }
    });
});
