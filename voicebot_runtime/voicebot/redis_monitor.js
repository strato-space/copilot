/**
 * Redis Memory Monitor
 * Monitors Redis memory usage and provides cleanup utilities
 */

class RedisMonitor {
    constructor(redisConnection, logger, thresholdPercent = 80) {
        this.redis = redisConnection;
        this.logger = logger;
        this.thresholdPercent = thresholdPercent;
        this.lastCheck = null;
        this.maxMemory = null;
        this.currentMemory = null;
    }

    /**
     * Get Redis memory information
     */
    async getMemoryInfo() {
        try {
            const info = await this.redis.info('memory');
            const lines = info.split('\r\n');
            const memInfo = {};

            lines.forEach(line => {
                const parts = line.split(':');
                if (parts.length === 2) {
                    memInfo[parts[0]] = parts[1];
                }
            });

            this.currentMemory = parseInt(memInfo.used_memory || 0);
            this.maxMemory = parseInt(memInfo.maxmemory || 0);

            return {
                used: this.currentMemory,
                max: this.maxMemory,
                usedHuman: memInfo.used_memory_human,
                maxHuman: memInfo.maxmemory_human,
                percentage: this.maxMemory > 0 ? (this.currentMemory / this.maxMemory * 100).toFixed(2) : 0,
                policy: memInfo.maxmemory_policy
            };
        } catch (error) {
            this.logger.error('Error getting Redis memory info:', error);
            return null;
        }
    }

    /**
     * Check if memory usage is above threshold
     */
    async isMemoryHigh() {
        const memInfo = await this.getMemoryInfo();
        if (!memInfo || memInfo.max === 0) {
            return false;
        }

        return parseFloat(memInfo.percentage) >= this.thresholdPercent;
    }

    /**
     * Log current memory status
     */
    async logMemoryStatus() {
        const memInfo = await this.getMemoryInfo();
        if (memInfo) {
            this.logger.info(`Redis Memory: ${memInfo.usedHuman} / ${memInfo.maxHuman} (${memInfo.percentage}%) - Policy: ${memInfo.policy}`);

            if (parseFloat(memInfo.percentage) >= this.thresholdPercent) {
                this.logger.warn(`Redis memory usage is high: ${memInfo.percentage}%`);
            }
        }
    }

    /**
     * Clean old jobs from a queue
     */
    async cleanQueue(queue, queueName) {
        try {
            // BullMQ doesn't use EXPIRE for job keys; history is managed via removeOnComplete/removeOnFail
            // or via explicit clean/trim passes like this.
            const cleaned = await Promise.all([
                queue.clean(3600000, 1000, 'completed'), // 1 hour old, max 1000
                queue.clean(86400000, 500, 'failed'), // 24 hours old, max 500
            ]);

            try {
                // Keep a bounded tail of the events stream for troubleshooting.
                await queue.trimEvents(10000);
            } catch (e) {
                this.logger.warn(`Failed to trim events stream for queue ${queueName}:`, e);
            }

            const totalCleaned = cleaned.reduce((sum, count) => sum + count.length, 0);

            if (totalCleaned > 0) {
                this.logger.info(`Cleaned ${totalCleaned} old jobs from queue ${queueName}`);
            }

            return totalCleaned;
        } catch (error) {
            this.logger.error(`Error cleaning queue ${queueName}:`, error);
            return 0;
        }
    }

    /**
     * Emergency cleanup - more aggressive
     */
    async emergencyCleanup(queues) {
        this.logger.warn('Starting emergency cleanup due to high memory usage');

        let totalCleaned = 0;

        for (const [queueName, queue] of Object.entries(queues)) {
            try {
                // Only clean history states (completed/failed). Never delete wait/active/delayed automatically,
                // otherwise we'd drop real work from the pipeline.
                const cleaned = await Promise.all([
                    queue.clean(0, 10000, 'completed'),
                    queue.clean(0, 5000, 'failed'),
                ]);

                try {
                    await queue.trimEvents(2000);
                } catch (e) {
                    this.logger.warn(`Failed to trim events stream for queue ${queueName}:`, e);
                }

                const count = cleaned.reduce((sum, arr) => sum + arr.length, 0);
                totalCleaned += count;

                if (count > 0) {
                    this.logger.info(`Emergency cleaned ${count} jobs from ${queueName}`);
                }
            } catch (error) {
                this.logger.error(`Error in emergency cleanup for ${queueName}:`, error);
            }
        }

        this.logger.info(`Emergency cleanup completed. Total jobs removed: ${totalCleaned}`);

        // Log memory status after cleanup
        await this.logMemoryStatus();

        return totalCleaned;
    }

    /**
     * Start periodic memory monitoring
     */
    startMonitoring(queues, intervalMs = 300000) { // Default: 5 minutes
        this.logger.info(`Starting Redis memory monitoring (interval: ${intervalMs}ms, threshold: ${this.thresholdPercent}%)`);

        this.monitoringInterval = setInterval(async () => {
            try {
                const memInfo = await this.getMemoryInfo();

                if (!memInfo) {
                    return;
                }

                const percentage = parseFloat(memInfo.percentage);

                // Log every 30 minutes (6 checks at 5 min intervals)
                if (!this.lastCheck || Date.now() - this.lastCheck > 1800000) {
                    await this.logMemoryStatus();
                    this.lastCheck = Date.now();
                }

                // If memory is high, perform cleanup
                if (percentage >= this.thresholdPercent) {
                    this.logger.warn(`Memory threshold exceeded (${percentage}% >= ${this.thresholdPercent}%)`);

                    // Try regular cleanup first
                    let cleaned = 0;
                    for (const [queueName, queue] of Object.entries(queues)) {
                        cleaned += await this.cleanQueue(queue, queueName);
                    }

                    const after = await this.getMemoryInfo();
                    const afterPct = after ? parseFloat(after.percentage) : percentage;

                    // If still high after cleanup and above 90%, do emergency cleanup
                    if (afterPct >= 90) {
                        await this.emergencyCleanup(queues);
                    }
                }
            } catch (error) {
                this.logger.error('Error in memory monitoring:', error);
            }
        }, intervalMs);

        return this.monitoringInterval;
    }

    /**
     * Stop monitoring
     */
    stopMonitoring() {
        if (this.monitoringInterval) {
            clearInterval(this.monitoringInterval);
            this.logger.info('Stopped Redis memory monitoring');
        }
    }
}

module.exports = { RedisMonitor };
