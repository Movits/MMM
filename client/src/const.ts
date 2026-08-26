export { COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";

// Auth próprio: redireciona para /login em vez do Manus OAuth
export const getLoginUrl = (_returnPath?: string) => {
  return "/login";
};
