import { login } from './auth';

export async function main() {
  const token = await login('a@b.c', 'secret');
  console.log(token);
}
