/* Family Exchange preview: input rules (PREVIEW CODE, sample only).
 * Copyright Leia. Licence for this file: not yet marked; it follows the repository licensing decision, which is still open.
 * These limits are sample values for the preview. They are not approved production rules. */
/* Server copy of exchange-preview/exchange-rules.js, ported to an ES module. The notice above is the source file's own notice, carried over unchanged.
 * Differences from the preview, on purpose:
 *  - Photos are not approved for the real backend, so any photo reference is rejected and photos play no part in change detection.
 *  - Pickup messaging is not decided, so the messages never point people to "Messages".
 * tests/exchange.test.js compares this file with the preview file so the two cannot drift apart silently. */
export const LIMITS = { title: 80, description: 1000, area: 60, note: 300 };
export const CATEGORIES = ['Furniture', 'Kids and baby', 'Books and media', 'Clothing', 'Kitchen and home', 'Garden and outdoor', 'Sports and toys', 'Other'];
export const CONDITIONS = ['Like new', 'Good', 'Worn but usable', 'For parts or repair'];
const STREET = /\b\d{1,6}\s+(?:[a-z0-9.'-]+\s+){0,3}(?:st|street|ave|avenue|rd|road|dr|drive|ln|lane|blvd|boulevard|ct|court|way|pl|place|cir|circle|hwy|highway)\b/i;
export function looksLikeAddress(s) { return STREET.test(String(s || '')); }
export function looksLikeContact(s) { s = String(s || ''); return /@/.test(s) || /(?:\d[\s().-]*){7,}/.test(s) || /https?:\/\/|www\./i.test(s); }
export function clean(s) { return String(s == null ? '' : s).replace(/\s+/g, ' ').trim(); }
/* draft: { kind: 'free'|'wanted', title, category, condition, description, area } */
export function validate(d) {
  const e = {}, title = clean(d.title), desc = String(d.description || '').trim(), area = clean(d.area);
  if (d.kind !== 'free' && d.kind !== 'wanted') e.kind = 'Choose free item or wanted.';
  if (!title) e.title = 'Add a short title.'; else if (title.length > LIMITS.title) e.title = 'Keep the title to ' + LIMITS.title + ' characters or fewer.';
  if (CATEGORIES.indexOf(d.category) < 0) e.category = 'Choose a category.';
  if (d.kind === 'free' && CONDITIONS.indexOf(d.condition) < 0) e.condition = 'Choose the condition.';
  if (!desc) e.description = 'Add a description so people know what this is.'; else if (desc.length > LIMITS.description) e.description = 'Keep the description to ' + LIMITS.description + ' characters or fewer.';
  if (area.length > LIMITS.area) e.area = 'Keep the area to ' + LIMITS.area + ' characters or fewer.';
  else if (looksLikeAddress(area) || looksLikeContact(area)) e.area = 'Use a broad area such as "near the library". Street addresses, phone numbers, emails and links are not allowed here.';
  if (looksLikeContact(title + ' ' + desc) && !e.description) e.description = 'Please leave phone numbers, emails and links out.';
  if (looksLikeAddress(desc) && !e.description) e.description = 'Please leave street addresses out.';
  if (Array.isArray(d.photos) ? d.photos.length : d.photos) e.photos = 'Photos are not available yet.';
  return { ok: !Object.keys(e).length, errors: e };
}
/* MATERIAL CHANGES: the "agreed item" is everything another member can see in the public listing.
 * A change is material if it alters the title (any letter, including capitals), the category, the condition, the description text or the pickup area.
 * The only changes that are NOT material are extra spaces, tabs and line-break differences.
 * While an item is reserved, material changes cannot be published; they can only be saved as private edits. */
export function normText(s) { return String(s == null ? '' : s).replace(/\s+/g, ' ').trim(); }
const MATERIAL = [['title', 'title'], ['category', 'category'], ['condition', 'condition'], ['description', 'description'], ['area', 'pickup area']];
export function materialChanges(before, after) {
  const out = [];
  for (const [k, label] of MATERIAL) if (normText(before[k]) !== normText(after[k])) out.push(label);
  return out;
}
/* Exact comparison, used to decide whether anything at all differs (spacing included). Saved text is never altered: the author's own spacing and line breaks are kept. */
export function anyChanges(before, after) {
  return !['title', 'category', 'condition', 'description', 'area'].every((k) => String(before[k] == null ? '' : before[k]) === String(after[k] == null ? '' : after[k]));
}
