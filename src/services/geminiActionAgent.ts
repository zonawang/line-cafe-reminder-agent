import {
  FunctionCallingConfigMode,
  GoogleGenAI,
  type FunctionDeclaration
} from '@google/genai';

import { env } from '../utils/env.js';
import type { CafeReminder, FavoriteCafe } from './cafeStore.js';
import type { Cafe } from './geminiMaps.js';

export type CafeAgentDecision =
  | { name: 'save_cafe'; cafeNumber: number }
  | { name: 'list_saved_cafes' }
  | { name: 'remove_saved_cafe'; favoriteNumber: number }
  | {
      name: 'plan_cafe_visit';
      cafeNumber: number;
      startTime: string;
      durationMinutes: number;
    }
  | {
      name: 'schedule_cafe_reminder';
      cafeNumber: number;
      visitTime: string;
      durationMinutes: number;
      remindMinutesBefore: number;
    }
  | { name: 'list_cafe_reminders' }
  | { name: 'cancel_cafe_reminder'; reminderNumber: number }
  | { name: 'none'; reply: string };

const declarations: FunctionDeclaration[] = [
  {
    name: 'save_cafe',
    description: 'Save one cafe from the latest recommendation list. Do not use when the user also specifies a visit time or calendar request.',
    parametersJsonSchema: {
      type: 'object',
      properties: { cafe_number: { type: 'integer', minimum: 1 } },
      required: ['cafe_number']
    }
  },
  {
    name: 'list_saved_cafes',
    description: 'List the cafes this user previously saved.',
    parametersJsonSchema: { type: 'object', properties: {} }
  },
  {
    name: 'remove_saved_cafe',
    description: 'Remove one cafe from the numbered saved-cafe list.',
    parametersJsonSchema: {
      type: 'object',
      properties: { favorite_number: { type: 'integer', minimum: 1 } },
      required: ['favorite_number']
    }
  },
  {
    name: 'plan_cafe_visit',
    description: 'Save a cafe and prepare a Google Calendar event when the user mentions a visit date/time or calendar, but does not ask for a LINE reminder.',
    parametersJsonSchema: {
      type: 'object',
      properties: {
        cafe_number: { type: 'integer', minimum: 1 },
        start_time: {
          type: 'string',
          description: 'An RFC 3339 timestamp with numeric UTC offset.'
        },
        duration_minutes: { type: 'integer', minimum: 30, maximum: 480 }
      },
      required: ['cafe_number', 'start_time']
    }
  },
  {
    name: 'schedule_cafe_reminder',
    description: 'Schedule a proactive LINE reminder for a cafe visit. Use this whenever the user asks to remind or notify them at a future time.',
    parametersJsonSchema: {
      type: 'object',
      properties: {
        cafe_number: { type: 'integer', minimum: 1 },
        visit_time: {
          type: 'string',
          description: 'Cafe visit time as an RFC 3339 timestamp with numeric UTC offset.'
        },
        remind_minutes_before: {
          type: 'integer',
          minimum: 0,
          maximum: 10080,
          description: 'How many minutes before the visit to send the LINE reminder. Use 0 when the user says remind me in N minutes without a separate visit time.'
        },
        duration_minutes: { type: 'integer', minimum: 30, maximum: 480 }
      },
      required: ['cafe_number', 'visit_time', 'remind_minutes_before']
    }
  },
  {
    name: 'list_cafe_reminders',
    description: 'List this user’s active scheduled cafe reminders.',
    parametersJsonSchema: { type: 'object', properties: {} }
  },
  {
    name: 'cancel_cafe_reminder',
    description: 'Cancel one reminder from the numbered active reminder list.',
    parametersJsonSchema: {
      type: 'object',
      properties: { reminder_number: { type: 'integer', minimum: 1 } },
      required: ['reminder_number']
    }
  }
];

const ai = new GoogleGenAI({
  enterprise: true,
  project: env.GOOGLE_CLOUD_PROJECT,
  location: env.GOOGLE_CLOUD_LOCATION,
  apiVersion: 'v1'
});

function integer(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) ? value : undefined;
}

function parseDecision(
  functionCalls: Array<{ name?: string; args?: Record<string, unknown> }> | undefined,
  fallbackText: string
): CafeAgentDecision {
  const call = functionCalls?.[0];
  const args = call?.args ?? {};
  if (call?.name === 'save_cafe') {
    const cafeNumber = integer(args.cafe_number);
    if (cafeNumber) return { name: 'save_cafe', cafeNumber };
  }
  if (call?.name === 'list_saved_cafes') return { name: 'list_saved_cafes' };
  if (call?.name === 'remove_saved_cafe') {
    const favoriteNumber = integer(args.favorite_number);
    if (favoriteNumber) return { name: 'remove_saved_cafe', favoriteNumber };
  }
  if (call?.name === 'plan_cafe_visit') {
    const cafeNumber = integer(args.cafe_number);
    const startTime = typeof args.start_time === 'string' ? args.start_time : '';
    const durationMinutes = integer(args.duration_minutes) ?? 90;
    if (cafeNumber && startTime && !Number.isNaN(Date.parse(startTime))) {
      return { name: 'plan_cafe_visit', cafeNumber, startTime, durationMinutes };
    }
  }
  if (call?.name === 'schedule_cafe_reminder') {
    const cafeNumber = integer(args.cafe_number);
    const visitTime = typeof args.visit_time === 'string' ? args.visit_time : '';
    const durationMinutes = integer(args.duration_minutes) ?? 90;
    const remindMinutesBefore = integer(args.remind_minutes_before);
    if (
      cafeNumber &&
      visitTime &&
      !Number.isNaN(Date.parse(visitTime)) &&
      remindMinutesBefore !== undefined
    ) {
      return {
        name: 'schedule_cafe_reminder',
        cafeNumber,
        visitTime,
        durationMinutes,
        remindMinutesBefore
      };
    }
  }
  if (call?.name === 'list_cafe_reminders') return { name: 'list_cafe_reminders' };
  if (call?.name === 'cancel_cafe_reminder') {
    const reminderNumber = integer(args.reminder_number);
    if (reminderNumber) return { name: 'cancel_cafe_reminder', reminderNumber };
  }
  return {
    name: 'none',
    reply: fallbackText.trim() || '我可以幫你收藏、安排咖啡行程，或設定 LINE 提醒。'
  };
}

export async function decideCafeAction(input: {
  text: string;
  cafes: Cafe[];
  favorites: FavoriteCafe[];
  reminders: CafeReminder[];
  now?: Date;
}): Promise<CafeAgentDecision> {
  const now = input.now ?? new Date();
  const cafeList = input.cafes.map((cafe, index) => `${index + 1}. ${cafe.title}`).join('\n') || '(none)';
  const favoriteList = input.favorites.map((cafe, index) => `${index + 1}. ${cafe.title}`).join('\n') || '(none)';
  const reminderList = input.reminders
    .map((reminder, index) => `${index + 1}. ${reminder.cafe.title} at ${reminder.visitAt}`)
    .join('\n') || '(none)';
  const response = await ai.models.generateContent({
    model: env.GEMINI_FUNCTION_MODEL,
    contents: [
      `You are the action router for a Traditional Chinese LINE cafe bot. Current time: ${now.toISOString()}. User time zone: ${env.APP_TIME_ZONE}.`,
      'Choose a function only when the user clearly asks to save, list, remove, schedule, remind, cancel a reminder, or add a cafe visit to a calendar.',
      'Resolve relative dates using the current time. For vague periods: morning 10:00, afternoon 14:00, evening 19:00. Never choose a cafe that is absent from the relevant numbered list.',
      'For “remind me in N minutes”, set visit_time to N minutes from now and remind_minutes_before to 0. For “visit at X and remind me Y before”, set visit_time to X and remind_minutes_before to Y.',
      'If no function applies, answer briefly in Traditional Chinese and tell the user supported examples.',
      '',
      'Latest recommendations:',
      cafeList,
      '',
      'Saved cafes:',
      favoriteList,
      '',
      'Active reminders:',
      reminderList,
      '',
      `User message: ${input.text}`
    ].join('\n'),
    config: {
      tools: [{ functionDeclarations: declarations }],
      toolConfig: {
        functionCallingConfig: { mode: FunctionCallingConfigMode.AUTO }
      },
      temperature: 0
    }
  });
  return parseDecision(response.functionCalls, response.text || '');
}

export const geminiActionAgentInternals = { parseDecision };
