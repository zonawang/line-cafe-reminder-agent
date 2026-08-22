import type { messagingApi } from '@line/bot-sdk';

import { createPendingPostbackData } from '../actions/pendingActionData.js';
import type {
  CafeReminder,
  FavoriteCafe,
  PendingCafeAction
} from '../services/cafeStore.js';
import type { Cafe, CafeSearchResult } from '../services/geminiMaps.js';

const locationQuickReply: messagingApi.QuickReply = {
  items: [{ type: 'action', action: { type: 'location', label: '傳送目前位置' } }]
};

export function createWelcomeMessage(): messagingApi.TextMessage {
  return {
    type: 'text',
    text: [
      '⏰ 我是 Cafe Reminder Agent。',
      '',
      '先傳送位置取得推薦，之後可以直接對我說：',
      '・收藏第二間',
      '・查看我的收藏',
      '・刪除收藏第一間',
      '・五分鐘後提醒我去第二間',
      '・查看我的提醒'
    ].join('\n'),
    quickReply: locationQuickReply
  };
}

export function createRemindersMessage(reminders: CafeReminder[]): messagingApi.TextMessage {
  if (reminders.length === 0) {
    return {
      type: 'text',
      text: '你目前沒有等待中的咖啡提醒。先傳送位置，再告訴我何時提醒你吧！',
      quickReply: locationQuickReply
    };
  }
  const rows = reminders.map((reminder, index) => {
    const visit = new Date(reminder.visitAt).toLocaleString('zh-TW', {
      timeZone: 'Asia/Taipei',
      hour12: false
    });
    const remind = new Date(reminder.remindAt).toLocaleString('zh-TW', {
      timeZone: 'Asia/Taipei',
      hour12: false
    });
    return `${index + 1}. ${reminder.cafe.title}\n行程：${visit}\n提醒：${remind}`;
  });
  return {
    type: 'text',
    text: `⏰ 我的咖啡提醒\n\n${rows.join('\n\n')}\n\n要取消時可以說「取消提醒第一個」。`
  };
}

function sourceBubble(cafe: Cafe, index: number): messagingApi.FlexBubble {
  return {
    type: 'bubble',
    size: 'kilo',
    body: {
      type: 'box',
      layout: 'vertical',
      spacing: 'md',
      contents: [
        { type: 'text', text: `推薦 ${index + 1}`, size: 'xs', color: '#8A6D3B', weight: 'bold' },
        { type: 'text', text: cafe.title, wrap: true, weight: 'bold', size: 'lg' },
        { type: 'text', text: '資料來源：Google Maps', size: 'xs', color: '#777777' }
      ]
    },
    footer: {
      type: 'box',
      layout: 'vertical',
      spacing: 'sm',
      contents: [
        {
          type: 'button',
          style: 'primary',
          color: '#6F4E37',
          action: { type: 'uri', label: '在地圖查看', uri: cafe.uri }
        },
        {
          type: 'button',
          action: { type: 'message', label: '收藏這間', text: `收藏第 ${index + 1} 間` }
        }
      ]
    }
  };
}

export function createCafeResultMessages(result: CafeSearchResult): messagingApi.Message[] {
  return [
    {
      type: 'text',
      text: `☕ 附近咖啡廳推薦\n\n${result.summary}\n\n你可以點卡片收藏，或直接用自然語言安排。`
    },
    {
      type: 'flex',
      altText: '附近咖啡廳推薦',
      contents: { type: 'carousel', contents: result.cafes.map(sourceBubble) },
      quickReply: {
        items: [
          { type: 'action', action: { type: 'message', label: '查看收藏', text: '查看我的收藏' } },
          { type: 'action', action: { type: 'location', label: '重新選位置' } }
        ]
      }
    }
  ];
}

export function createFavoritesMessage(favorites: FavoriteCafe[]): messagingApi.TextMessage {
  if (favorites.length === 0) {
    return { type: 'text', text: '你目前還沒有收藏咖啡廳。先傳送位置找幾間吧！', quickReply: locationQuickReply };
  }
  const rows = favorites.map((cafe, index) => `${index + 1}. ${cafe.title}\n${cafe.uri}`);
  return {
    type: 'text',
    text: `⭐ 我的咖啡收藏\n\n${rows.join('\n\n')}\n\n要移除時可以說「刪除收藏第一間」。`
  };
}

export function createPendingConfirmation(action: PendingCafeAction): messagingApi.TextMessage {
  const description = action.kind === 'remove'
    ? `從收藏移除「${action.cafe.title}」`
    : action.kind === 'cancel_reminder'
      ? `取消「${action.cafe.title}」的提醒`
      : action.kind === 'reminder'
        ? `收藏「${action.cafe.title}」，並在 ${new Date(action.remindAt!).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei', hour12: false })} 傳送 LINE 提醒`
    : action.kind === 'visit'
      ? `收藏「${action.cafe.title}」，並建立 ${new Date(action.startTime!).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei', hour12: false })} 的行事曆活動`
      : `收藏「${action.cafe.title}」`;
  return {
    type: 'text',
    text: `請確認是否要${description}？`,
    quickReply: {
      items: [
        {
          type: 'action',
          action: {
            type: 'postback',
            label: '確認執行',
            data: createPendingPostbackData('confirm', action.id),
            displayText: '確認執行'
          }
        },
        {
          type: 'action',
          action: {
            type: 'postback',
            label: '取消',
            data: createPendingPostbackData('cancel', action.id),
            displayText: '取消操作'
          }
        }
      ]
    }
  };
}

export function createCompletedMessage(
  action: PendingCafeAction,
  calendarUrl?: string
): messagingApi.TextMessage {
  if (action.kind === 'remove') return { type: 'text', text: `已從收藏移除「${action.cafe.title}」。` };
  if (action.kind === 'cancel_reminder') {
    return { type: 'text', text: `已取消「${action.cafe.title}」的提醒。` };
  }
  if (action.kind === 'reminder') {
    return {
      type: 'text',
      text: `⏰ 已排定提醒！我會在 ${new Date(action.remindAt!).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei', hour12: false })} 主動提醒你前往「${action.cafe.title}」。`,
      ...(calendarUrl
        ? {
            quickReply: {
              items: [
                { type: 'action' as const, action: { type: 'uri' as const, label: '加入行事曆', uri: calendarUrl } },
                { type: 'action' as const, action: { type: 'message' as const, label: '查看提醒', text: '查看我的提醒' } }
              ]
            }
          }
        : {})
    };
  }
  if (action.kind === 'visit' && calendarUrl) {
    return {
      type: 'text',
      text: `已收藏「${action.cafe.title}」。點下方按鈕即可加入 Google Calendar。`,
      quickReply: {
        items: [
          { type: 'action', action: { type: 'uri', label: '加入行事曆', uri: calendarUrl } },
          { type: 'action', action: { type: 'uri', label: '開啟地圖', uri: action.cafe.uri } }
        ]
      }
    };
  }
  return { type: 'text', text: `已收藏「${action.cafe.title}」⭐` };
}
