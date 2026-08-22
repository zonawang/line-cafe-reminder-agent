import type { messagingApi } from '@line/bot-sdk';

import {
  createFavoritesMessage,
  createPendingConfirmation,
  createRemindersMessage,
  createWelcomeMessage
} from '../messages/cafeMessages.js';
import {
  createPendingAction,
  getRecommendationContext,
  listFavorites,
  listUpcomingReminders
} from '../services/cafeStore.js';
import { decideCafeAction } from '../services/geminiActionAgent.js';
import {
  buildReminderSchedule,
  ReminderTimeError
} from '../services/reminderTime.js';

function text(message: string): messagingApi.TextMessage {
  return { type: 'text', text: message };
}

export async function handleCafeText(input: {
  ownerId: string;
  conversationId: string;
  text: string;
}): Promise<messagingApi.Message[]> {
  if (/^(開始|start|help|幫助)$/iu.test(input.text.trim())) return [createWelcomeMessage()];

  const [cafes, favorites, reminders] = await Promise.all([
    getRecommendationContext(input.ownerId, input.conversationId),
    listFavorites(input.ownerId),
    listUpcomingReminders(input.ownerId)
  ]);
  const decision = await decideCafeAction({
    text: input.text,
    cafes,
    favorites,
    reminders
  });

  if (decision.name === 'none') return [text(decision.reply)];
  if (decision.name === 'list_saved_cafes') return [createFavoritesMessage(favorites)];
  if (decision.name === 'list_cafe_reminders') return [createRemindersMessage(reminders)];

  if (decision.name === 'cancel_cafe_reminder') {
    const reminder = reminders[decision.reminderNumber - 1];
    if (!reminder) return [text('找不到這個提醒，請先說「查看我的提醒」確認編號。')];
    const pending = await createPendingAction({
      ownerId: input.ownerId,
      conversationId: input.conversationId,
      kind: 'cancel_reminder',
      cafe: reminder.cafe,
      reminderId: reminder.id
    });
    return [createPendingConfirmation(pending)];
  }

  if (decision.name === 'remove_saved_cafe') {
    const favorite = favorites[decision.favoriteNumber - 1];
    if (!favorite) return [text('找不到這筆收藏，請先說「查看我的收藏」確認編號。')];
    const pending = await createPendingAction({
      ownerId: input.ownerId,
      conversationId: input.conversationId,
      kind: 'remove',
      cafe: { title: favorite.title, uri: favorite.uri },
      favoriteId: favorite.id
    });
    return [createPendingConfirmation(pending)];
  }

  const cafe = cafes[decision.cafeNumber - 1];
  if (!cafe) return [text('找不到這間推薦，請重新傳送位置後再試一次。')];

  if (decision.name === 'plan_cafe_visit') {
    const start = new Date(decision.startTime);
    if (start.getTime() <= Date.now()) return [text('行程時間必須在未來，請告訴我新的日期和時間。')];
    const pending = await createPendingAction({
      ownerId: input.ownerId,
      conversationId: input.conversationId,
      kind: 'visit',
      cafe,
      startTime: start.toISOString(),
      durationMinutes: Math.min(Math.max(decision.durationMinutes, 30), 480)
    });
    return [createPendingConfirmation(pending)];
  }

  if (decision.name === 'schedule_cafe_reminder') {
    let schedule: ReturnType<typeof buildReminderSchedule>;
    try {
      schedule = buildReminderSchedule({
        visitTime: decision.visitTime,
        remindMinutesBefore: decision.remindMinutesBefore
      });
    } catch (error) {
      if (error instanceof ReminderTimeError && error.code === 'too_far') {
        return [text('目前最多可以設定 30 天內的提醒。')];
      }
      return [text('提醒時間必須至少在 30 秒後，請告訴我一個更晚的時間。')];
    }
    const pending = await createPendingAction({
      ownerId: input.ownerId,
      conversationId: input.conversationId,
      kind: 'reminder',
      cafe,
      startTime: schedule.visitAt,
      remindAt: schedule.remindAt,
      durationMinutes: Math.min(Math.max(decision.durationMinutes, 30), 480)
    });
    return [createPendingConfirmation(pending)];
  }

  const pending = await createPendingAction({
    ownerId: input.ownerId,
    conversationId: input.conversationId,
    kind: 'save',
    cafe
  });
  return [createPendingConfirmation(pending)];
}
