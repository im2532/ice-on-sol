import pino from "pino";

const isTTY = process.stdout.isTTY;

export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  transport: isTTY
    ? {
        target: "pino-pretty",
        options: { colorize: true, translateTime: "SYS:HH:MM:ss", ignore: "pid,hostname" },
      }
    : undefined,
});

export function childLogger(name: string) {
  return logger.child({ cycle: name });
}
