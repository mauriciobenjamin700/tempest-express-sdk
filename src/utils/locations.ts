/**
 * Brazilian states (UF), regions and municipalities, mirroring
 * `utils.locations`.
 *
 * Ships an offline, dependency-free dataset of every federative unit and its
 * municipalities (bundled at build time), plus query helpers and validators.
 * City lookups are accent- and case-insensitive.
 */

import { defineEnum } from "@/core/enums";
import { z } from "@/schemas/base";
import brLocations from "@/utils/data/brLocations.json";

/** The 27 Brazilian federative-unit acronyms. */
export const UF = defineEnum({
  AC: "AC",
  AL: "AL",
  AP: "AP",
  AM: "AM",
  BA: "BA",
  CE: "CE",
  DF: "DF",
  ES: "ES",
  GO: "GO",
  MA: "MA",
  MT: "MT",
  MS: "MS",
  MG: "MG",
  PA: "PA",
  PB: "PB",
  PR: "PR",
  PE: "PE",
  PI: "PI",
  RJ: "RJ",
  RN: "RN",
  RS: "RS",
  RO: "RO",
  RR: "RR",
  SC: "SC",
  SP: "SP",
  SE: "SE",
  TO: "TO",
});

/** A federative-unit acronym. */
export type UFValue = ReturnType<typeof UF.values>[number];

/** The five official IBGE macro-regions. */
export const Region = defineEnum({
  NORTH: "Norte",
  NORTHEAST: "Nordeste",
  CENTRAL_WEST: "Centro-Oeste",
  SOUTHEAST: "Sudeste",
  SOUTH: "Sul",
});

/** A macro-region value. */
export type RegionValue = ReturnType<typeof Region.values>[number];

/** Static mapping of every UF to its IBGE macro-region. */
const UF_TO_REGION: Record<string, RegionValue> = {
  AC: Region.NORTH,
  AP: Region.NORTH,
  AM: Region.NORTH,
  PA: Region.NORTH,
  RO: Region.NORTH,
  RR: Region.NORTH,
  TO: Region.NORTH,
  AL: Region.NORTHEAST,
  BA: Region.NORTHEAST,
  CE: Region.NORTHEAST,
  MA: Region.NORTHEAST,
  PB: Region.NORTHEAST,
  PE: Region.NORTHEAST,
  PI: Region.NORTHEAST,
  RN: Region.NORTHEAST,
  SE: Region.NORTHEAST,
  DF: Region.CENTRAL_WEST,
  GO: Region.CENTRAL_WEST,
  MS: Region.CENTRAL_WEST,
  MT: Region.CENTRAL_WEST,
  ES: Region.SOUTHEAST,
  MG: Region.SOUTHEAST,
  RJ: Region.SOUTHEAST,
  SP: Region.SOUTHEAST,
  PR: Region.SOUTH,
  RS: Region.SOUTH,
  SC: Region.SOUTH,
};

/** A Brazilian federative unit and its municipalities. */
export interface StateBR {
  /** Federative-unit acronym (e.g. `"SP"`). */
  uf: string;
  /** Full state name (e.g. `"São Paulo"`). */
  name: string;
  /** The IBGE macro-region the state belongs to. */
  region: RegionValue;
  /** Alphabetically sorted municipality names. */
  cities: string[];
}

const RAW = brLocations as Array<{ uf: string; name: string; cities: string[] }>;

const STATES: StateBR[] = RAW.map((entry) => ({
  uf: entry.uf,
  name: entry.name,
  region: UF_TO_REGION[entry.uf] ?? Region.SOUTHEAST,
  cities: entry.cities,
}));

const STATE_BY_UF = new Map(STATES.map((state) => [state.uf, state]));

/** Strip accents and lowercase a string for tolerant comparison. */
function fold(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .trim()
    .toLowerCase();
}

/** All states, ordered by acronym. */
export function listStates(): StateBR[] {
  return STATES.map((state) => ({ ...state, cities: [...state.cities] }));
}

/** The state for a UF acronym (case-insensitive), or `null`. */
export function getState(uf: string): StateBR | null {
  const state = STATE_BY_UF.get(uf.toUpperCase());
  return state ? { ...state, cities: [...state.cities] } : null;
}

/** The municipalities of a UF, or `[]` for an unknown UF. */
export function citiesByUf(uf: string): string[] {
  return getState(uf)?.cities ?? [];
}

/** All states in a macro-region. */
export function statesByRegion(region: RegionValue): StateBR[] {
  return listStates().filter((state) => state.region === region);
}

/** Whether `value` is a known UF acronym (case-insensitive). */
export function isValidUf(value: string): boolean {
  return STATE_BY_UF.has(value.toUpperCase());
}

/** Normalize a UF to its uppercase acronym, throwing when unknown. */
export function normalizeUf(value: string): string {
  const upper = value.toUpperCase();
  if (!STATE_BY_UF.has(upper)) throw new Error("invalid UF");
  return upper;
}

/** Whether `name` is a municipality of `uf` (accent/case-insensitive). */
export function isValidCity(name: string, uf: string): boolean {
  const folded = fold(name);
  return citiesByUf(uf).some((city) => fold(city) === folded);
}

/** Zod field: validates a UF and normalizes it to its uppercase acronym. */
export const ufField = z
  .string()
  .refine(isValidUf, { message: "invalid UF" })
  .transform((value) => value.toUpperCase());
