import type { WebhookEvent } from '@line/bot-sdk';

import { createCafeResultMessages, createWelcomeMessage } from '../messages/cafeMessages.js';
import { saveRecommendationContext } from '../services/cafeStore.js';
import { findNearbyCafes } from '../services/geminiMaps.js';
import { lineClient } from '../services/lineClient.js';
import { getActorId, getConversationId } from '../utils/lineEvent.js';
import { logger } from '../utils/logger.js';
import { handlePostbackEvent } from './postbackHandler.js';
import { handleCafeText } from './textMessageHandler.js';

export async function handleWebhookEvent(event: WebhookEvent): Promise<void> {
  logger.info('Webhook event received', { eventType: event.type, webhookEventId: event.webhookEventId });
  if (event.type === 'postback') return handlePostbackEvent(event);
  if (event.type !== 'message') return;

  const ownerId = getActorId(event.source);
  const conversationId = getConversationId(event.source);
  if (!ownerId || !conversationId) return;

  if (event.message.type === 'text') {
    const messages = await handleCafeText({ ownerId, conversationId, text: event.message.text });
    await lineClient.replyMessage({ replyToken: event.replyToken, messages });
    return;
  }
  if (event.message.type !== 'location') {
    await lineClient.replyMessage({ replyToken: event.replyToken, messages: [createWelcomeMessage()] });
    return;
  }

  try {
    try {
      await lineClient.showLoadingAnimation({ chatId: conversationId, loadingSeconds: 60 });
    } catch (error) {
      logger.error('Loading animation failed', { error: error instanceof Error ? error.message : String(error) });
    }
    const result = await findNearbyCafes(event.message.latitude, event.message.longitude);
    await saveRecommendationContext({ ownerId, conversationId, cafes: result.cafes });
    await lineClient.pushMessage({ to: conversationId, messages: createCafeResultMessages(result) });
  } catch (error) {
    logger.error('Cafe search failed', { error: error instanceof Error ? error.message : String(error) });
    await lineClient.pushMessage({
      to: conversationId,
      messages: [{
        type: 'text',
        text: '目前無法取得附近咖啡廳，請稍後再傳一次位置。',
        quickReply: { items: [{ type: 'action', action: { type: 'location', label: '重新傳送位置' } }] }
      }]
    });
  }
}
