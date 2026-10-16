import pino from "pino";

/** Logger JSON ke stdout (ditangkap journald). Level via LOG_LEVEL. */
export function createLogger(service: string) {
  return pino({
    level: process.env.LOG_LEVEL ?? "info",
    base: { service },
    timestamp: pino.stdTimeFunctions.isoTime,
    redact: {
      paths: [
        "*.privateKey",
        "*.secret",
        "*.apiKey",
        "*.password",
        "headers.authorization",
        "headers['x-api-key']",
      ],
      censor: "[redacted]",
    },
  });
}

export type Logger = ReturnType<typeof createLogger>;
