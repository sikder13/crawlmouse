import { customAlphabet } from 'nanoid';
const alphabet = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
const generate = customAlphabet(alphabet, 22);
export function newReportSlug(): string { return generate(); }
export function newVerificationToken(): string { return generate(); }
