/**
 * Builds Playwright locators from the JSON files in tests/locators/.
 *
 * Page objects and specs never write selectors themselves: every locator lives in a
 * tests/locators/<page>.locators.json file and is read here. An entry looks like
 *
 *   "saveButton":  { "role": "button", "name": "Save" }
 *   "nameInput":   { "placeholder": "Your name" }
 *   "notesInput":  { "placeholder": { "regex": "add a note", "flags": "i" } }
 *   "orderRow":    { "testId": "order-{{id}}" }
 *   "menuItem":    { "within": "menu", "role": "menuitem", "name": "Settings" }
 *
 * (Examples here are made up on purpose: scripts/ci/heal-locators.cjs patches a drifted
 * value only when it occurs once across tests/, so real values must not be repeated.)
 *
 * Exactly one target: role (+ name, exact) | text | placeholder | label | testId | css.
 * Optional, applied in this order:
 *   within  parent locator — another key in the same file, or an inline entry
 *   filter  { hasText, hasNotText, has }   (has: a key or an inline entry)
 *   or      alternative locator — a key or an inline entry
 *   nth | first | last
 * Text values are a string or { "regex", "flags" }. "{{param}}" in any string is
 * replaced by the value passed to get(); inside a regex the value is escaped.
 */

import type { Locator, Page } from '@playwright/test';

type AriaRole = Parameters<Page['getByRole']>[0];
type Text = string | { regex: string; flags?: string };
type Ref = string | LocatorSpec;

export interface LocatorSpec {
  role?: AriaRole;
  name?: Text;
  exact?: boolean;
  text?: Text;
  placeholder?: Text;
  label?: Text;
  testId?: Text;
  css?: string;
  within?: Ref;
  filter?: { hasText?: Text; hasNotText?: Text; has?: Ref };
  or?: Ref;
  nth?: number | string;
  first?: boolean;
  last?: boolean;
}

export type Params = Record<string, string | number>;

const TARGETS = ['role', 'text', 'placeholder', 'label', 'testId', 'css'] as const;
const ALLOWED = new Set<string>([...TARGETS, 'name', 'exact', 'within', 'filter', 'or', 'nth', 'first', 'last']);
const FILTER_KEYS = new Set(['hasText', 'hasNotText', 'has']);

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function fill(template: string, params: Params, where: string, escape = false): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => {
    if (!(key in params)) throw new Error(`Locator ${where} needs a "${key}" parameter`);
    const value = String(params[key]);
    return escape ? escapeRegex(value) : value;
  });
}

function text(value: Text, params: Params, where: string): string | RegExp {
  if (typeof value === 'string') return fill(value, params, where);
  return new RegExp(fill(value.regex, params, where, true), value.flags);
}

function validate(spec: LocatorSpec, where: string): void {
  for (const key of Object.keys(spec)) {
    if (!ALLOWED.has(key)) throw new Error(`Locator ${where}: unknown property "${key}"`);
  }
  const targets = TARGETS.filter((t) => spec[t] !== undefined);
  if (targets.length !== 1) throw new Error(`Locator ${where}: needs exactly one of ${TARGETS.join(', ')} (has ${targets.join(', ') || 'none'})`);
  if ((spec.name !== undefined || spec.exact !== undefined) && !spec.role && !spec.text && !spec.placeholder && !spec.label) {
    throw new Error(`Locator ${where}: "name"/"exact" only apply to role, text, placeholder or label`);
  }
  for (const key of Object.keys(spec.filter ?? {})) {
    if (!FILTER_KEYS.has(key)) throw new Error(`Locator ${where}: unknown filter "${key}"`);
  }
  for (const ref of [spec.within, spec.filter?.has, spec.or]) {
    if (ref && typeof ref === 'object') validate(ref, `${where} (inline)`);
  }
}

/** The locators of one JSON file, bound to a page. */
export class Locators<K extends string> {
  private readonly specs: Record<K, LocatorSpec>;

  constructor(private readonly page: Page, specs: Record<K, unknown>, private readonly file: string) {
    this.specs = specs as Record<K, LocatorSpec>;
    for (const [key, spec] of Object.entries(this.specs) as [string, LocatorSpec][]) validate(spec, `${file}#${key}`);
    for (const key of Object.keys(this.specs)) this.checkRefs(this.specs[key as K], `${file}#${key}`);
  }

  get(key: K, params: Params = {}): Locator {
    return this.build(this.spec(key), params, `${this.file}#${key}`);
  }

  private spec(key: string): LocatorSpec {
    const spec = (this.specs as Record<string, LocatorSpec>)[key];
    if (!spec) throw new Error(`No locator "${key}" in ${this.file}`);
    return spec;
  }

  private checkRefs(spec: LocatorSpec, where: string): void {
    for (const ref of [spec.within, spec.filter?.has, spec.or]) {
      if (typeof ref === 'string') this.spec(ref);
      else if (ref) this.checkRefs(ref, where);
    }
  }

  private ref(ref: Ref, params: Params, where: string): Locator {
    return typeof ref === 'string' ? this.build(this.spec(ref), params, `${this.file}#${ref}`) : this.build(ref, params, where);
  }

  private build(spec: LocatorSpec, params: Params, where: string): Locator {
    const root: Page | Locator = spec.within ? this.ref(spec.within, params, where) : this.page;
    const exact = spec.exact === undefined ? {} : { exact: spec.exact };
    let loc: Locator;
    if (spec.role) loc = root.getByRole(spec.role, { ...(spec.name !== undefined && { name: text(spec.name, params, where) }), ...exact });
    else if (spec.text !== undefined) loc = root.getByText(text(spec.text, params, where), exact);
    else if (spec.placeholder !== undefined) loc = root.getByPlaceholder(text(spec.placeholder, params, where), exact);
    else if (spec.label !== undefined) loc = root.getByLabel(text(spec.label, params, where), exact);
    else if (spec.testId !== undefined) loc = root.getByTestId(text(spec.testId, params, where));
    else loc = root.locator(fill(spec.css!, params, where));

    const f = spec.filter;
    if (f) {
      loc = loc.filter({
        ...(f.hasText !== undefined && { hasText: text(f.hasText, params, where) }),
        ...(f.hasNotText !== undefined && { hasNotText: text(f.hasNotText, params, where) }),
        ...(f.has !== undefined && { has: this.ref(f.has, params, where) }),
      });
    }
    if (spec.or) loc = loc.or(this.ref(spec.or, params, where));
    if (spec.nth !== undefined) loc = loc.nth(Number(typeof spec.nth === 'string' ? fill(spec.nth, params, where) : spec.nth));
    if (spec.first) loc = loc.first();
    if (spec.last) loc = loc.last();
    return loc;
  }
}
