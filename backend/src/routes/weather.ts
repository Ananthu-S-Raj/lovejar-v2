import { Hono } from "hono";
import type { AppEnv } from "../types";
import { requireAuth } from "../lib/middleware";

const weather = new Hono<AppEnv>();
weather.use("*", requireAuth());

function messageFor(condition: string, name: string): string {
  const c = condition.toLowerCase();
  if (c.includes("rain")) return `Looks like it's raining today. Stay cozy, ${name} ❤️`;
  if (c.includes("cloud")) return `A bit cloudy out there today, ${name}. Perfect for a slow day.`;
  if (c.includes("clear") || c.includes("sun")) return `Sunshine today, ${name}! Hope it warms your heart too ☀️`;
  if (c.includes("storm") || c.includes("thunder")) return `Storms rolling in, ${name} — stay safe and warm.`;
  if (c.includes("snow")) return `Snowy today, ${name}! Bundle up ❄️`;
  return `Here's today's weather, ${name}. Hope you have a lovely day.`;
}

// GET /weather?lat=..&lon=..  (user supplies device location; admin passes none and gets last cached reading)
weather.get("/", async (c) => {
  const lat = c.req.query("lat");
  const lon = c.req.query("lon");

  if (c.get("role") === "user" && lat && lon) {
    if (!c.env.WEATHER_API_KEY) {
      return c.json({ error: "Weather API key not configured" }, 501);
    }
    const latNum = Number(lat);
    const lonNum = Number(lon);
    if (
      !Number.isFinite(latNum) ||
      latNum < -90 ||
      latNum > 90 ||
      !Number.isFinite(lonNum) ||
      lonNum < -180 ||
      lonNum > 180
    ) {
      return c.json({ error: "Invalid coordinates" }, 400);
    }
    const res = await fetch(
      `https://api.openweathermap.org/data/2.5/weather?lat=${latNum}&lon=${lonNum}&units=metric&appid=${c.env.WEATHER_API_KEY}`
    );
    if (!res.ok) return c.json({ error: "Failed to fetch weather" }, 502);
    const data: any = await res.json();
    const condition = data?.weather?.[0]?.main ?? "Clear";
    const payload = {
      condition,
      description: data?.weather?.[0]?.description ?? "",
      tempC: data?.main?.temp ?? null,
      feelsLikeC: data?.main?.feels_like ?? null,
      humidity: data?.main?.humidity ?? null,
      city: data?.name ?? "",
      message: messageFor(condition, c.env.USER_NAME),
      fetchedAt: Math.floor(Date.now() / 1000),
    };
    await c.env.DB.prepare(
      "INSERT INTO app_settings (key, value, updated_at) VALUES ('last_weather', ?, unixepoch()) " +
        "ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at"
    )
      .bind(JSON.stringify(payload))
      .run();
    return c.json(payload);
  }

  // Admin (or user without geolocation permission yet): return last cached reading
  const cached = await c.env.DB.prepare("SELECT value FROM app_settings WHERE key = 'last_weather'").first<{
    value: string;
  }>();
  if (!cached) return c.json({ error: "No weather data available yet" }, 404);
  return c.json(JSON.parse(cached.value));
});

export default weather;
