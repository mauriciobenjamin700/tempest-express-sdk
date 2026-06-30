# Utilidades BR

Helpers prontos para os campos de identidade e contato mais comuns em APIs
brasileiras: CPF, CNPJ, CEP, telefone e UF/cidades.

## Validação e normalização

```ts
import {
  isValidCpf,
  isValidCnpj,
  normalizeCpf,
  onlyDigits,
} from "tempest-express-sdk";

isValidCpf("529.982.247-25"); // true (formato + dígitos verificadores)
isValidCpf("111.111.111-11"); // false (sequência repetida)
normalizeCpf("529.982.247-25"); // "52998224725"
onlyDigits("(11) 99999-8888"); // "11999998888"
```

Disponíveis: `isValidCpf`, `isValidCnpj`, `isValidCpfCnpj`, `isValidCep`,
`isValidPhoneBr`, mais os `normalize*` correspondentes (que lançam em entrada
inválida).

## Campos Zod

Cada documento tem um campo Zod que valida **e** normaliza para dígitos:

```ts
import { cpfField, phoneBrField, ufField, z } from "tempest-express-sdk";

const customerSchema = z.object({
  cpf: cpfField, // "529.982.247-25" → "52998224725"
  phone: phoneBrField,
  uf: ufField, // "sp" → "SP"
});

customerSchema.parse({ cpf: "529.982.247-25", phone: "(11) 99999-8888", uf: "sp" });
```

Um valor inválido lança `ZodError`, que o handler de erro transforma em **422**.

## Estados e cidades

```ts
import { listStates, getState, isValidCity, statesByRegion, Region } from "tempest-express-sdk";

listStates().length; // 27
getState("SP")?.name; // "São Paulo"
isValidCity("são paulo", "SP"); // true (ignora acento e caixa)
statesByRegion(Region.SOUTH).map((s) => s.uf); // ["PR", "RS", "SC"]
```

!!! note "Dataset offline"
    O pacote embute todos os 27 estados e ~5,6 mil municípios — sem chamadas de
    rede. As comparações de cidade ignoram acento e caixa.

## Recapitulando

Validadores + campos Zod cobrem CPF/CNPJ/CEP/telefone; o dataset de UF/cidades é
offline. Tudo se integra ao envelope de erro padrão via `ZodError` → 422.
