import { redact, redactUnknown } from './redact';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

function threshold(): number {
  const level = (process.env.LOG_LEVEL ?? 'info') as LogLevel;
  return ORDER[level] ?? ORDER.info;
}

export type LogContext = Record<string, unknown>;

function emit(level: LogLevel, message: string, context: LogContext = {}): void {
  if (ORDER[level] < threshold()) return;
  const line = {
    ts: new Date().toISOString(),
    level,
    msg: redact(message),
    ...(redactUnknown(context) as LogContext),
  };
  const serialized = JSON.stringify(line);
  if (level === 'error' || level === 'warn') {
    console.error(serialized);
  } else {
    console.log(serialized);
  }
}

export interface Logger {
  debug(message: string, context?: LogContext): void;
  info(message: string, context?: LogContext): void;
  warn(message: string, context?: LogContext): void;
  error(message: string, context?: LogContext): void;
  child(context: LogContext): Logger;
}

export function createLogger(base: LogContext = {}): Logger {
  return {
    debug: (message, context) => emit('debug', message, { ...base, ...context }),
    info: (message, context) => emit('info', message, { ...base, ...context }),
    warn: (message, context) => emit('warn', message, { ...base, ...context }),
    error: (message, context) => emit('error', message, { ...base, ...context }),
    child: (context) => createLogger({ ...base, ...context }),
  };
}

export const logger = createLogger({ service: 'devin-conductor' });
