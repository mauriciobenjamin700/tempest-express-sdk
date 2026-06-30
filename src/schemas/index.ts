/** Zod schema primitives: base config, response shape, pagination. */

export {
  type BaseResponse,
  type ToDictOptions,
  baseResponseSchema,
  toDict,
  z,
} from "@/schemas/base";
export {
  type CursorPaginationFilter,
  type PaginationFilter,
  cursorPaginationFilterSchema,
  cursorPaginationSchema,
  decodeCursor,
  encodeCursor,
  getConditions,
  getPaginationConditions,
  paginationFilterSchema,
  paginationSchema,
} from "@/schemas/pagination";
