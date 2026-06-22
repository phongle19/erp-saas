import { getRequestConfig } from "next-intl/server";
import { routing } from "./routing";
import { messages } from "@erp/i18n";

export default getRequestConfig(async ({ requestLocale }) => {
  let locale = await requestLocale;
  if (!locale || !routing.locales.includes(locale as "vi" | "en")) {
    locale = routing.defaultLocale;
  }
  return {
    locale,
    messages: messages[locale as "vi" | "en"],
  };
});
