/** Wildcard scope an admin/all-access tenant can hold instead of enumerating every tool scope. */
export const ADMIN_SCOPE = 'tools:*';

export function hasScope(scopes: string[] | undefined, required: string): boolean {
  if (!scopes) return false;
  return scopes.includes(required) || scopes.includes(ADMIN_SCOPE);
}
