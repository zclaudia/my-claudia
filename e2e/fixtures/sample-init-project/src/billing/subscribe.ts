export function subscribe(userId: string, plan: 'free' | 'pro'): { active: boolean } {
  if (plan !== 'free' && plan !== 'pro') throw new Error('Unknown plan');
  return { active: true };
}
