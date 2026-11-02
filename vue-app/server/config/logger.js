export function log(level, message, context = {}) {
  const entry = { level, message, timestamp: new Date().toISOString(), ...context };
  const output = JSON.stringify(entry);
  if (level === "error") console.error(output);
  else console.log(output);
}

export const logger = {
  info: (message, context) => log("info", message, context),
  warn: (message, context) => log("warn", message, context),
  error: (message, context) => log("error", message, context),
};
