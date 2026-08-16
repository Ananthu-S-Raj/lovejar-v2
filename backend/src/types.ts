export type Bindings = {
  DB: D1Database;
  CHAT_ROOM: DurableObjectNamespace;
  USER_PIN_HASH: string;
  ADMIN_PASSWORD_HASH: string;
  ADMIN_EMAIL: string;
  GEMINI_API_KEY: string;
  WEATHER_API_KEY: string;
  USER_NAME: string;
  APP_TIMEZONE_OFFSET_MINUTES: string;
  ALLOWED_ORIGINS: string; // dev comma-separated frontend origins allowed by CORS (ignored in production)
  ENVIRONMENT: string; // "production" for the deployed cross-site setup; anything else = local dev (see lib/security.ts)
  // Web Push (admin-only background notifications). Set via `wrangler secret put`.
  VAPID_PUBLIC_KEY: string;
  VAPID_PRIVATE_KEY: string;
  VAPID_SUBJECT: string;
};

export type Variables = {
  role: "user" | "admin";
  token: string;
};

export type AppEnv = { Bindings: Bindings; Variables: Variables };
