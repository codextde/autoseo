import { customAlphabet } from "nanoid";
import { timestamp, text } from "drizzle-orm/pg-core";

const alphabet = "0123456789abcdefghijklmnopqrstuvwxyz";
const nano = customAlphabet(alphabet, 16);

/** Generates prefixed ids like `prj_4f9k2m...` */
export function newId(prefix: string): string {
  return `${prefix}_${nano()}`;
}

export const id = (prefix: string) =>
  text()
    .primaryKey()
    .$defaultFn(() => newId(prefix));

export const createdAt = () => timestamp({ withTimezone: true }).notNull().defaultNow();
export const updatedAt = () =>
  timestamp({ withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());
export const ts = () => timestamp({ withTimezone: true });
