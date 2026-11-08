/** Pure helper (no app imports, so it is tested in plain node). */

/** How long to wait before retrying, when an error is Pollinations' free limit; null for any other error. */
export function freeLimitWait(message?: string): number | null {
  if (!message || !/free limit|FREE_LIMIT|reply every \d+ seconds/i.test(message)) return null;
  const m = /retry after\s*(\d+)\s*s/i.exec(message);
  return (Math.min(90, m ? Number(m[1]) : 45) + 1) * 1000;
}
