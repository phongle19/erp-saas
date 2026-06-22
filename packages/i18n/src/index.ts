import vi from './vi.js';
import en from './en.js';
export const messages = { vi, en } as const;
export const defaultLocale = 'vi' as const;
export type Locale = keyof typeof messages;
export type Messages = typeof vi;
