import type { EventSource } from '@line/bot-sdk';

export function getActorId(source: EventSource): string | undefined {
  return source.userId;
}

export function getConversationId(source: EventSource): string | undefined {
  if (source.type === 'user') return source.userId;
  if (source.type === 'group') return source.groupId;
  if (source.type === 'room') return source.roomId;
  return undefined;
}
