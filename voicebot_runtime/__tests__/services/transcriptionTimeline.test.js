const {
    buildSegmentsFromChunks,
    resolveMessageDurationSeconds,
} = require("../../services/transcriptionTimeline");

describe("transcriptionTimeline", () => {
    describe("resolveMessageDurationSeconds", () => {
        it("prefers message.duration when it is positive", () => {
            const duration = resolveMessageDurationSeconds({
                message: { duration: 42 },
                chunks: [],
            });

            expect(duration).toBe(42);
        });

        it("falls back to file metadata duration", () => {
            const duration = resolveMessageDurationSeconds({
                message: { duration: 0, file_metadata: { duration: 15.75 } },
                chunks: [],
            });

            expect(duration).toBe(15.75);
        });

        it("falls back to chunk durations when message duration is missing", () => {
            const duration = resolveMessageDurationSeconds({
                message: { duration: 0 },
                chunks: [
                    { segment_index: 0, duration_seconds: 12.5 },
                    { segment_index: 1, duration_seconds: 7.5 },
                ],
            });

            expect(duration).toBe(20);
        });
    });

    describe("buildSegmentsFromChunks", () => {
        it("builds timeline from first chunk timestamp", () => {
            const timeline = buildSegmentsFromChunks({
                chunks: [
                    {
                        id: "ch_a",
                        segment_index: 0,
                        timestamp: new Date("2026-02-13T10:00:00.000Z"),
                        duration_seconds: 120,
                        text: "first",
                    },
                    {
                        id: "ch_b",
                        segment_index: 1,
                        timestamp: new Date("2026-02-13T10:02:00.000Z"),
                        duration_seconds: 180,
                        text: "second",
                    },
                ],
                messageDurationSeconds: 300,
            });

            expect(timeline.segments).toHaveLength(2);
            expect(timeline.segments[0].start).toBe(0);
            expect(timeline.segments[0].end).toBe(120);
            expect(timeline.segments[1].start).toBe(120);
            expect(timeline.segments[1].end).toBe(300);
            expect(timeline.derivedDurationSeconds).toBe(300);
        });

        it("derives missing durations from neighboring timestamps and message duration", () => {
            const timeline = buildSegmentsFromChunks({
                chunks: [
                    {
                        id: "ch_a",
                        segment_index: 0,
                        timestamp: new Date("2026-02-13T10:00:00.000Z"),
                        duration_seconds: 0,
                        text: "first",
                    },
                    {
                        id: "ch_b",
                        segment_index: 1,
                        timestamp: new Date("2026-02-13T10:01:00.000Z"),
                        duration_seconds: 0,
                        text: "second",
                    },
                ],
                messageDurationSeconds: 120,
            });

            expect(timeline.segments).toHaveLength(2);
            expect(timeline.segments[0].start).toBe(0);
            expect(timeline.segments[0].end).toBe(60);
            expect(timeline.segments[1].start).toBe(60);
            expect(timeline.segments[1].end).toBe(120);
            expect(timeline.derivedDurationSeconds).toBe(120);
        });
    });
});
