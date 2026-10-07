// Explicit dependency boundary for the remaining assembled feature sources.
// Add independent modules here instead of introducing new application globals.
export * as scheduleRules from './domain/schedule.js';
export { createDraftStorage } from './services/draft-storage.js';
export * as formatters from './shared/formatting.js';
export * as displayMarkup from './ui/display-markup.js';
export { sanitizeValue } from './shared/input-values.js';
