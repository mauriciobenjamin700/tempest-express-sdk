/** HTTP layer: app factory, error handlers, OpenAPI, Swagger/Redoc, health. */

export {
  type AppExceptionHandlerOptions,
  REQUEST_ID_HEADER,
  type RegisterExceptionHandlersOptions,
  type UnhandledExceptionHandlerOptions,
  makeAppExceptionHandler,
  makeUnhandledExceptionHandler,
  notFoundHandler,
  registerExceptionHandlers,
  requestIdMiddleware,
} from "@/api/handlers";
export {
  type GenerateOpenApiOptions,
  type OpenApiInfo,
  OpenAPIRegistry,
  createOpenApiRegistry,
  generateOpenApiDocument,
} from "@/api/openapi";
export {
  type OpenApiDocument,
  type RedocOptions,
  type SwaggerOptions,
  mountOpenApiJson,
  mountRedoc,
  mountSwaggerUi,
} from "@/api/docs";
export {
  type HealthCheck,
  type HealthRouterOptions,
  makeHealthRouter,
} from "@/api/health";
export {
  type MetricsRouterOptions,
  makeMetricsRouter,
} from "@/api/metrics";
export {
  type CreateAppOpenApi,
  type CreateAppOptions,
  type RunServerOptions,
  createApp,
  runServer,
} from "@/api/server";
