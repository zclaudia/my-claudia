export function signup(email: string, password: string): { userId: string } {
  if (!/^[^@]+@[^@]+$/.test(email)) throw new Error('Invalid email');
  if (password.length < 8) throw new Error('Password too short');
  return { userId: 'u-1' };
}
