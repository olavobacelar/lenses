/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";
import type * as citationResolver from "../citationResolver.js";
import type * as http from "../http.js";
import type * as legacy_settings_compat from "../legacy-settings-compat.js";
import type * as runHelpers from "../runHelpers.js";
import type * as runs from "../runs.js";

/**
 * A utility for referencing Convex functions in your app's API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
declare const fullApi: ApiFromModules<{
  citationResolver: typeof citationResolver;
  http: typeof http;
  "legacy-settings-compat": typeof legacy_settings_compat;
  runHelpers: typeof runHelpers;
  runs: typeof runs;
}>;
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;
