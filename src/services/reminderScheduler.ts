import { CloudTasksClient, protos } from '@google-cloud/tasks';

import { env } from '../utils/env.js';
import type { CafeReminder } from './cafeStore.js';

const tasksClient = new CloudTasksClient();

function requireSchedulerConfig(): void {
  if (!env.SERVICE_URL) throw new Error('SERVICE_URL is required to schedule reminders');
  if (!env.TASKS_SERVICE_ACCOUNT) {
    throw new Error('TASKS_SERVICE_ACCOUNT is required to schedule reminders');
  }
}

export function reminderTaskName(reminderId: string): string {
  return tasksClient.taskPath(
    env.GOOGLE_CLOUD_PROJECT,
    env.CLOUD_TASKS_LOCATION,
    env.CLOUD_TASKS_QUEUE,
    `reminder-${reminderId}`
  );
}

export async function scheduleReminderTask(reminder: CafeReminder): Promise<string> {
  requireSchedulerConfig();
  const remindAtMs = Date.parse(reminder.remindAt);
  const maxScheduleMs = Date.now() + 30 * 24 * 60 * 60 * 1000;
  if (!Number.isFinite(remindAtMs) || remindAtMs <= Date.now()) {
    throw new Error('Reminder time must be in the future');
  }
  if (remindAtMs > maxScheduleMs) {
    throw new Error('Cloud Tasks reminders must be scheduled within 30 days');
  }

  const parent = tasksClient.queuePath(
    env.GOOGLE_CLOUD_PROJECT,
    env.CLOUD_TASKS_LOCATION,
    env.CLOUD_TASKS_QUEUE
  );
  const name = reminderTaskName(reminder.id);
  const task: protos.google.cloud.tasks.v2.ITask = {
    name,
    scheduleTime: { seconds: Math.floor(remindAtMs / 1000) },
    httpRequest: {
      httpMethod: protos.google.cloud.tasks.v2.HttpMethod.POST,
      url: `${env.SERVICE_URL}/tasks/reminders/${encodeURIComponent(reminder.id)}`,
      headers: { 'Content-Type': 'application/json' },
      body: Buffer.from(JSON.stringify({ reminderId: reminder.id })),
      oidcToken: {
        serviceAccountEmail: env.TASKS_SERVICE_ACCOUNT,
        audience: env.SERVICE_URL
      }
    }
  };

  try {
    await tasksClient.createTask({ parent, task });
  } catch (error) {
    const code = typeof error === 'object' && error !== null && 'code' in error
      ? Number(error.code)
      : undefined;
    if (code !== 6) throw error;
  }
  return name;
}

export async function deleteReminderTask(taskName: string | undefined): Promise<void> {
  if (!taskName) return;
  try {
    await tasksClient.deleteTask({ name: taskName });
  } catch (error) {
    const code = typeof error === 'object' && error !== null && 'code' in error
      ? Number(error.code)
      : undefined;
    if (code !== 5) throw error;
  }
}
