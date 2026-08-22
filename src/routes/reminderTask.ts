import { Router, type Request, type Response } from 'express';

import {
  claimReminderDelivery,
  markReminderSent,
  releaseReminderDelivery
} from '../services/cafeStore.js';
import { lineClient } from '../services/lineClient.js';
import { verifyReminderTaskToken } from '../services/taskAuth.js';
import { env } from '../utils/env.js';
import { logger } from '../utils/logger.js';
import { retryKeyForReminder } from '../utils/retryKey.js';

const router = Router();

router.post('/:reminderId', async (req: Request, res: Response) => {
  const reminderParam = req.params.reminderId;
  const reminderId = Array.isArray(reminderParam)
    ? reminderParam[0] || ''
    : reminderParam || '';
  try {
    await verifyReminderTaskToken(req.header('authorization'));
    const queueName = req.header('x-cloudtasks-queuename');
    if (queueName && queueName !== env.CLOUD_TASKS_QUEUE) {
      res.status(403).json({ error: 'Unexpected task queue' });
      return;
    }
  } catch (error) {
    logger.error('Reminder task authentication failed', {
      error: error instanceof Error ? error.message : String(error)
    });
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  if (!reminderId) {
    res.status(400).json({ error: 'Missing reminder id' });
    return;
  }

  try {
    const reminder = await claimReminderDelivery(reminderId);
    if (!reminder) {
      res.sendStatus(204);
      return;
    }
    const visitText = new Date(reminder.visitAt).toLocaleString('zh-TW', {
      timeZone: env.APP_TIME_ZONE,
      hour12: false,
      month: 'numeric',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
    await lineClient.pushMessage(
      {
        to: reminder.conversationId,
        messages: [{
          type: 'text',
          text: `☕ 咖啡行程提醒\n\n你安排在 ${visitText} 前往「${reminder.cafe.title}」。`,
          quickReply: {
            items: [{
              type: 'action',
              action: { type: 'uri', label: '開啟 Google Maps', uri: reminder.cafe.uri }
            }]
          }
        }]
      },
      retryKeyForReminder(reminder.id)
    );
    await markReminderSent(reminder.id);
    logger.info('Cafe reminder sent', { reminderId: reminder.id });
    res.sendStatus(204);
  } catch (error) {
    try {
      await releaseReminderDelivery(
        reminderId,
        error instanceof Error ? error.message : String(error)
      );
    } catch (releaseError) {
      logger.error('Failed to release reminder delivery lock', {
        reminderId,
        error: releaseError instanceof Error ? releaseError.message : String(releaseError)
      });
    }
    logger.error('Cafe reminder delivery failed', {
      reminderId,
      error: error instanceof Error ? error.message : String(error)
    });
    res.status(500).json({ error: 'Reminder delivery failed' });
  }
});

export default router;
