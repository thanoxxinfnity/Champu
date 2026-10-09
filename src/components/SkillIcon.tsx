import { iconPaths } from '@/lib/skills/icons';

/** A skill's drawn icon. Accepts a name, or an emoji saved by an older version (drawn as its equivalent). */
export function SkillIcon({ name, size = 15, className }: { name?: string | null; size?: number; className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      dangerouslySetInnerHTML={{ __html: iconPaths(name) }}
    />
  );
}
