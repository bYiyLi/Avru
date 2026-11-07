import type { en } from './locales/en.js';
export type MessageKey = keyof typeof en;
export type Catalog = { [Key in MessageKey]: string };
type Placeholders<Text extends string> =
  Text extends `${string}{${infer Name}}${infer Rest}`
    ? Name | Placeholders<Rest>
    : never;
export type MessageArguments<Key extends MessageKey> = [
  Placeholders<(typeof en)[Key]>,
] extends [never]
  ? []
  : [values: Record<Placeholders<(typeof en)[Key]>, string | number>];
