import { hashPassword, makeToken } from './crypto';
import { db } from './db';

/** Log a user in: check the password and hand back a session token. */
export async function login(email: string, password: string): Promise<string> {
  const user = await db.findUser(email);
  if (!user) throw new Error('unknown user');
  if (hashPassword(password) !== user.hash) throw new Error('wrong password');
  return makeToken(user.id);
}

export function logout(token: string) {
  db.dropSession(token);
}

export function unusedHelper() {
  return orphanTwo();
}

function orphanTwo() {
  return 42;
}
