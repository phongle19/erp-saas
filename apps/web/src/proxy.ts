import createMiddleware from "next-intl/middleware";
import { routing } from "./i18n/routing";

export default createMiddleware(routing);

export const config = {
  // Match all request paths EXCEPT:
  // - `/api`  (must reach the next.config `rewrites` -> API_URL, never get locale-prefixed)
  // - `/_next`, `/_vercel` (Next internals / framework assets)
  // - any path containing a dot (static files: favicon.ico, *.png, etc.)
  //
  // A single negative-lookahead matcher is used instead of separate `/`,
  // `/(vi|en)/:path*` entries so that `/api/*` cannot be swallowed by the
  // locale redirect. The lookahead still matches `/` and locale-prefixed
  // app routes, which is what next-intl needs to add/redirect locales.
  matcher: ["/((?!api|_next|_vercel|.*\\..*).*)"],
};
