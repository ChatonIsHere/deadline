import type { Prisma } from '@prisma/client';

/** A jsonb list of strings (roles, ranks, objective parts, message IDs). Anything else is dropped. */
export const stringList = (value: Prisma.JsonValue): string[] => (Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : []);
