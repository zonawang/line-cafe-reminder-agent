import type { WebhookEvent } from '@line/bot-sdk';

import { parsePendingPostbackData } from '../actions/pendingActionData.js';
import { createCompletedMessage } from '../messages/cafeMessages.js';
import {
  cancelPendingAction,
  executePendingAction,
  getReminder,
  markReminderScheduled,
  markReminderScheduleFailed,
  PendingActionError
} from '../services/cafeStore.js';
import { createGoogleCalendarLink } from '../services/calendarLink.js';
import { lineClient } from '../services/lineClient.js';
import {
  deleteReminderTask,
  scheduleReminderTask
} from '../services/reminderScheduler.js';
import { getActorId, getConversationId } from '../utils/lineEvent.js';
import { logger } from '../utils/logger.js';

function errorMessage(error: unknown): string {
  if (error instanceof PendingActionError) {
    if (error.code === 'completed') return '這個操作已經執行過了。';
    if (error.code === 'forbidden') return '這個操作不屬於你，無法執行。';
    return '這個確認操作已過期，請重新下指令。';
  }
  return '目前無法執行操作，請稍後再試。';
}

export async function handlePostbackEvent(
  event: Extract<WebhookEvent, { type: 'postback' }>
): Promise<void> {
  const parsed = parsePendingPostbackData(event.postback.data);
  const ownerId = getActorId(event.source);
  const conversationId = getConversationId(event.source);
  if (!parsed || !ownerId || !conversationId) return;

  try {
    if (parsed.action === 'cancel') {
      await cancelPendingAction(parsed.pendingId, ownerId, conversationId);
      await lineClient.replyMessage({
        replyToken: event.replyToken,
        messages: [{ type: 'text', text: '已取消這次操作。' }]
      });
      return;
    }

    const action = await executePendingAction(parsed.pendingId, ownerId, conversationId);
    let calendarUrl = action.kind === 'visit' || action.kind === 'reminder'
      ? createGoogleCalendarLink({
          cafe: action.cafe,
          startTime: action.startTime!,
          durationMinutes: action.durationMinutes ?? 90
        })
      : undefined;

    if (action.kind === 'reminder') {
      const reminder = await getReminder(action.id);
      if (!reminder) throw new Error('Confirmed reminder was not found');
      try {
        const taskName = await scheduleReminderTask(reminder);
        await markReminderScheduled(reminder.id, taskName);
      } catch (error) {
        await markReminderScheduleFailed(
          reminder.id,
          error instanceof Error ? error.message : String(error)
        );
        throw error;
      }
    }

    if (action.kind === 'cancel_reminder' && action.reminderId) {
      const reminder = await getReminder(action.reminderId);
      try {
        await deleteReminderTask(reminder?.taskName);
      } catch (error) {
        logger.error('Failed to delete cancelled Cloud Task', {
          reminderId: action.reminderId,
          error: error instanceof Error ? error.message : String(error)
        });
      }
      calendarUrl = undefined;
    }
    await lineClient.replyMessage({
      replyToken: event.replyToken,
      messages: [createCompletedMessage(action, calendarUrl)]
    });
  } catch (error) {
    await lineClient.replyMessage({
      replyToken: event.replyToken,
      messages: [{ type: 'text', text: errorMessage(error) }]
    });
  }
}
