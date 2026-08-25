import Redis from "ioredis";

let client: Redis | undefined;

export const getRedis = () => {
  client ??= new Redis(process.env.REDIS_URL ?? "redis://localhost:6379", {
    connectTimeout: 3_000,
    maxRetriesPerRequest: 10,
    enableOfflineQueue: true,
    enableAutoPipelining: true,
  });
  return client;
};
