/**
 * Brazilian identity/contact helpers, mirroring `utils.regex`.
 *
 * Patterns, validators (format + check digits), normalizers, and ready-to-use
 * Zod field schemas for the fields that show up in almost every BR API: CPF,
 * CNPJ, CEP and phone. Validators accept masked or unmasked input; normalizers
 * strip masks to a canonical digits-only form (and throw on invalid input).
 */

import { z } from "@/schemas/base";

/** Match a CPF in masked (`000.000.000-00`) or raw form. */
export const CPF_PATTERN = /^\d{3}\.?\d{3}\.?\d{3}-?\d{2}$/;
/** Match a CNPJ in masked (`00.000.000/0000-00`) or raw form. */
export const CNPJ_PATTERN = /^\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}$/;
/** Match a BR phone with optional `+55`, DDD, mask or 9th digit. */
export const PHONE_BR_PATTERN = /^(?:\+?55\s?)?(?:\(?\d{2}\)?\s?)?9?\d{4}[-\s]?\d{4}$/;
/** Match a CEP in masked (`00000-000`) or raw form. */
export const CEP_PATTERN = /^\d{5}-?\d{3}$/;

/**
 * Strip every non-digit character from `value`.
 *
 * @param value - The raw input (masked CPF, phone, etc.).
 * @returns A string of only the digits in `value`.
 */
export function onlyDigits(value: string): string {
  return value.replace(/\D/g, "");
}

/** Validate the two CPF check digits over an 11-digit string. */
function cpfCheckDigits(digits: string): boolean {
  if (digits.length !== 11 || new Set(digits).size === 1) return false;
  for (const size of [9, 10]) {
    let total = 0;
    for (let i = 0; i < size; i++) total += Number(digits[i]) * (size + 1 - i);
    let check = (total * 10) % 11;
    if (check === 10) check = 0;
    if (check !== Number(digits[size])) return false;
  }
  return true;
}

/** Validate the two CNPJ check digits over a 14-digit string. */
function cnpjCheckDigits(digits: string): boolean {
  if (digits.length !== 14 || new Set(digits).size === 1) return false;
  const first = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  const second = [6, ...first];
  for (const [size, weights] of [
    [12, first],
    [13, second],
  ] as const) {
    let total = 0;
    for (let i = 0; i < size; i++) total += Number(digits[i]) * (weights[i] ?? 0);
    const rest = total % 11;
    const check = rest < 2 ? 0 : 11 - rest;
    if (check !== Number(digits[size])) return false;
  }
  return true;
}

/** Whether `value` is a syntactically valid CPF (format + check digits). */
export function isValidCpf(value: string): boolean {
  return CPF_PATTERN.test(value) && cpfCheckDigits(onlyDigits(value));
}

/** Whether `value` is a syntactically valid CNPJ (format + check digits). */
export function isValidCnpj(value: string): boolean {
  return CNPJ_PATTERN.test(value) && cnpjCheckDigits(onlyDigits(value));
}

/** Whether `value` is a valid CPF or CNPJ. */
export function isValidCpfCnpj(value: string): boolean {
  const digits = onlyDigits(value);
  if (digits.length === 11) return isValidCpf(value);
  if (digits.length === 14) return isValidCnpj(value);
  return false;
}

/** Whether `value` looks like a CEP (eight-digit shape; no check digits). */
export function isValidCep(value: string): boolean {
  return CEP_PATTERN.test(value);
}

/** Whether `value` looks like a BR phone (10 or 11 digits, optional `+55`). */
export function isValidPhoneBr(value: string): boolean {
  if (!PHONE_BR_PATTERN.test(value)) return false;
  let digits = onlyDigits(value);
  if (digits.startsWith("55") && (digits.length === 12 || digits.length === 13)) {
    digits = digits.slice(2);
  }
  return digits.length === 10 || digits.length === 11;
}

/** Normalize a CPF to 11 digits, throwing when invalid. */
export function normalizeCpf(value: string): string {
  if (!isValidCpf(value)) throw new Error("invalid CPF");
  return onlyDigits(value);
}

/** Normalize a CNPJ to 14 digits, throwing when invalid. */
export function normalizeCnpj(value: string): string {
  if (!isValidCnpj(value)) throw new Error("invalid CNPJ");
  return onlyDigits(value);
}

/** Normalize a CPF/CNPJ to digits only, throwing when invalid. */
export function normalizeCpfCnpj(value: string): string {
  if (!isValidCpfCnpj(value)) throw new Error("invalid CPF/CNPJ");
  return onlyDigits(value);
}

/** Normalize a CEP to 8 digits, throwing when invalid. */
export function normalizeCep(value: string): string {
  if (!isValidCep(value)) throw new Error("invalid CEP");
  return onlyDigits(value);
}

/** Normalize a BR phone to digits only, throwing when invalid. */
export function normalizePhoneBr(value: string): string {
  if (!isValidPhoneBr(value)) throw new Error("invalid BR phone");
  return onlyDigits(value);
}

/** Zod field: validates a CPF and normalizes it to 11 digits. */
export const cpfField = z
  .string()
  .refine(isValidCpf, { message: "invalid CPF" })
  .transform(onlyDigits);
/** Zod field: validates a CNPJ and normalizes it to 14 digits. */
export const cnpjField = z
  .string()
  .refine(isValidCnpj, { message: "invalid CNPJ" })
  .transform(onlyDigits);
/** Zod field: accepts either a CPF or a CNPJ, normalized to digits. */
export const cpfOrCnpjField = z
  .string()
  .refine(isValidCpfCnpj, { message: "invalid CPF/CNPJ" })
  .transform(onlyDigits);
/** Zod field: validates a CEP and normalizes it to 8 digits. */
export const cepField = z
  .string()
  .refine(isValidCep, { message: "invalid CEP" })
  .transform(onlyDigits);
/** Zod field: validates a BR phone and normalizes it to digits. */
export const phoneBrField = z
  .string()
  .refine(isValidPhoneBr, { message: "invalid BR phone" })
  .transform(onlyDigits);
