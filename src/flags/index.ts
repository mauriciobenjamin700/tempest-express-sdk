/** Feature-flag primitives: backends, service, route guard. */

export {
  CompositeFeatureFlagBackend,
  EnvFeatureFlagBackend,
  type FeatureFlagBackend,
  type FlagContext,
  MemoryFeatureFlagBackend,
  coerceFlag,
} from "@/flags/backends";
export { FeatureFlags, makeFlagGuard } from "@/flags/service";
