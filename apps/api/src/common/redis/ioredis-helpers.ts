import type { Logger } from '@nestjs/common';
import type { Redis, RedisOptions } from 'ioredis';

/** BullMQ requires `null`; also tune reconnect so brief Redis restarts do not kill the API process. */
export function redisConnectionOptions(): RedisOptions {
  return {
    maxRetriesPerRequest: null,
    retryStrategy(times: number) {
      if (times > 40) return null;
      return Math.min(times * 150, 3000);
    },
  };
}

/**
 * ioredis emits connection errors on the socket; without a listener they can become uncaught
 * exceptions and terminate Node (see JobEvents publish during a translation when Redis stops).
 */
export function attachRedisSocketGuards(
  redis: Redis,
  logger: Logger,
  label: string,
): void {
  redis.on('error', (err: Error) => {
    logger.warn(`[${label}] ${err.message}`);
  });
  redis.on('close', () => {
    logger.warn(`[${label}] connection closed`);
  });
}
