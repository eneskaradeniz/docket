// definitions/command-template.ts — R-141: a `command` capability is a prompt template Docket
// renders itself by placeholder substitution; it is never a provider-native slash command.
import type { Result } from '../shared';
import { err, ok } from '../shared';
import type { CapabilityDef } from './types';

type CommandDef = Extract<CapabilityDef, { readonly kind: 'command' }>;

const PLACEHOLDER = /\{\{\s*([A-Za-z0-9_-]+)\s*\}\}/g;

/** The distinct `{{name}}` placeholders of a template, in order of first appearance. */
export const commandPlaceholders = (template: string): readonly string[] => {
  const names: string[] = [];
  for (const match of template.matchAll(PLACEHOLDER)) {
    const name = match[1];
    if (name !== undefined && !names.includes(name)) names.push(name);
  }
  return names;
};

/** Substitutes the supplied values into the template. A required argument without a value fails
 *  with its name; an optional one without a value renders as the empty string. */
export const renderCommand = (
  command: CommandDef,
  values: Readonly<Record<string, string>>,
): Result<string, { readonly missing: readonly string[] }> => {
  const missing = command.arguments.filter((arg) => arg.required && values[arg.name] === undefined).map((arg) => arg.name);
  if (missing.length > 0) return err({ missing });
  return ok(command.template.replace(PLACEHOLDER, (_whole, name: string) => values[name] ?? ''));
};
