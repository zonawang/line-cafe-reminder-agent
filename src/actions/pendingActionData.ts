export type PendingPostback = {
  action: 'confirm' | 'cancel';
  pendingId: string;
};

export function createPendingPostbackData(
  action: PendingPostback['action'],
  pendingId: string
): string {
  return new URLSearchParams({ feature: 'cafe_action', action, id: pendingId }).toString();
}

export function parsePendingPostbackData(data: string): PendingPostback | undefined {
  const params = new URLSearchParams(data);
  if (params.get('feature') !== 'cafe_action') return undefined;
  const action = params.get('action');
  const pendingId = params.get('id');
  if ((action !== 'confirm' && action !== 'cancel') || !pendingId) return undefined;
  return { action, pendingId };
}
