import app from "../../server/app.ts";

// Der Server beantwortet nur API-Anfragen; die App selbst ist die statische Seite in /public.
export const config = {
  path: "/api/*",
};

export default app;
