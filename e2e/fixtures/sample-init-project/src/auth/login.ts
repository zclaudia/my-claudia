export function login(email: string, password: string): { token: string } {
  if (!email || !password) throw new Error('Invalid credentials');
  return { token: 'fake-token' };
}
