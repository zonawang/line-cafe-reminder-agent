import 'dotenv/config';

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function port(): number {
  const value = Number(process.env.PORT ?? 3000);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error('PORT must be a positive integer');
  }
  return value;
}

export const env = {
  PORT: port(),
  LINE_CHANNEL_SECRET: required('LINE_CHANNEL_SECRET'),
  LINE_CHANNEL_ACCESS_TOKEN: required('LINE_CHANNEL_ACCESS_TOKEN'),
  GOOGLE_CLOUD_PROJECT: required('GOOGLE_CLOUD_PROJECT'),
  GOOGLE_CLOUD_LOCATION: process.env.GOOGLE_CLOUD_LOCATION?.trim() || 'global',
  GEMINI_MAPS_MODEL: process.env.GEMINI_MAPS_MODEL?.trim() || 'gemini-2.5-flash',
  GEMINI_FUNCTION_MODEL:
    process.env.GEMINI_FUNCTION_MODEL?.trim() || 'gemini-2.5-flash',
  GEMINI_TRANSLATION_MODEL:
    process.env.GEMINI_TRANSLATION_MODEL?.trim() || 'gemini-2.5-flash',
  FIRESTORE_CONTEXT_COLLECTION:
    process.env.FIRESTORE_CONTEXT_COLLECTION?.trim() || 'cafe-action-contexts',
  FIRESTORE_FAVORITES_COLLECTION:
    process.env.FIRESTORE_FAVORITES_COLLECTION?.trim() || 'cafe-favorites',
  FIRESTORE_PENDING_COLLECTION:
    process.env.FIRESTORE_PENDING_COLLECTION?.trim() || 'cafe-pending-actions',
  FIRESTORE_REMINDERS_COLLECTION:
    process.env.FIRESTORE_REMINDERS_COLLECTION?.trim() || 'cafe-reminders',
  APP_TIME_ZONE: process.env.APP_TIME_ZONE?.trim() || 'Asia/Taipei',
  CLOUD_TASKS_LOCATION:
    process.env.CLOUD_TASKS_LOCATION?.trim() || 'asia-east1',
  CLOUD_TASKS_QUEUE:
    process.env.CLOUD_TASKS_QUEUE?.trim() || 'cafe-reminders',
  TASKS_SERVICE_ACCOUNT: process.env.TASKS_SERVICE_ACCOUNT?.trim() || '',
  SERVICE_URL: process.env.SERVICE_URL?.trim().replace(/\/$/u, '') || ''
};
