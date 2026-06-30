# BR utilities

Ready-made helpers for the identity/contact fields most common in Brazilian
APIs: CPF, CNPJ, CEP, phone and UF/cities.

## Validation and normalization

```ts
import {
  isValidCpf,
  isValidCnpj,
  normalizeCpf,
  onlyDigits,
} from "tempest-express-sdk";

isValidCpf("529.982.247-25"); // true (format + check digits)
isValidCpf("111.111.111-11"); // false (repeated sequence)
normalizeCpf("529.982.247-25"); // "52998224725"
onlyDigits("(11) 99999-8888"); // "11999998888"
```

Available: `isValidCpf`, `isValidCnpj`, `isValidCpfCnpj`, `isValidCep`,
`isValidPhoneBr`, plus the matching `normalize*` (which throw on invalid input).

## Zod fields

Each document has a Zod field that validates **and** normalizes to digits:

```ts
import { cpfField, phoneBrField, ufField, z } from "tempest-express-sdk";

const customerSchema = z.object({
  cpf: cpfField, // "529.982.247-25" → "52998224725"
  phone: phoneBrField,
  uf: ufField, // "sp" → "SP"
});

customerSchema.parse({ cpf: "529.982.247-25", phone: "(11) 99999-8888", uf: "sp" });
```

An invalid value throws `ZodError`, which the error handler turns into **422**.

## States and cities

```ts
import { listStates, getState, isValidCity, statesByRegion, Region } from "tempest-express-sdk";

listStates().length; // 27
getState("SP")?.name; // "São Paulo"
isValidCity("sao paulo", "SP"); // true (accent/case-insensitive)
statesByRegion(Region.SOUTH).map((s) => s.uf); // ["PR", "RS", "SC"]
```

!!! note "Offline dataset"
    The package bundles all 27 states and ~5.6k municipalities — no network
    calls. City comparisons ignore accents and case.

## Recap

Validators + Zod fields cover CPF/CNPJ/CEP/phone; the UF/cities dataset is
offline. Everything integrates with the canonical error envelope via
`ZodError` → 422.
