import { OAuth2Client } from 'google-auth-library';

import { env } from '../utils/env.js';

const authClient = new OAuth2Client();

export function bearerToken(authorization: string | undefined): string | undefined {
  const match = authorization?.match(/^Bearer\s+(.+)$/iu);
  return match?.[1]?.trim() || undefined;
}

export async function verifyReminderTaskToken(
  authorization: string | undefined
): Promise<void> {
  if (!env.SERVICE_URL || !env.TASKS_SERVICE_ACCOUNT) {
    throw new Error('Task authentication is not configured');
  }
  const idToken = bearerToken(authorization);
  if (!idToken) throw new Error('Missing task bearer token');
  const ticket = await authClient.verifyIdToken({
    idToken,
    audience: env.SERVICE_URL
  });
  const payload = ticket.getPayload();
  if (
    !payload ||
    payload.email !== env.TASKS_SERVICE_ACCOUNT ||
    payload.email_verified !== true
  ) {
    throw new Error('Task token identity is not allowed');
  }
}
