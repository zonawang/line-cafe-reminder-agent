type Metadata = Record<string, unknown>;

function write(level: 'INFO' | 'ERROR', message: string, metadata: Metadata = {}) {
  const output = JSON.stringify({
    severity: level,
    message,
    ...metadata,
    timestamp: new Date().toISOString()
  });
  if (level === 'ERROR') console.error(output);
  else console.log(output);
}

export const logger = {
  info: (message: string, metadata?: Metadata) => write('INFO', message, metadata),
  error: (message: string, metadata?: Metadata) => write('ERROR', message, metadata)
};
