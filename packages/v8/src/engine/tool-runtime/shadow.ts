/**
 * Public facade for shadow grant authorization (Cedar-ready audit layer).
 * Architecture boundary: do not import internal/shadow from package roots.
 */
export {
  StructuralShadowGrantAuthorizer,
  compileToolGrantToCedar,
} from "./internal/shadow/ShadowGrantAuthorizer";
export type {
  ShadowAuthorizeDecision,
  ShadowAuthorizeResult,
  ShadowGrantAuthorizer,
} from "./internal/shadow/ShadowGrantAuthorizer";
