import { Hono } from "hono";
import type { AppEnv } from "../types";
import { requireAuth } from "../lib/middleware";
import { notify } from "../lib/notifications";

const pet = new Hono<AppEnv>();
pet.use("*", requireAuth());

type PetRow = {
  name: string;
  hunger: number;
  happiness: number;
  energy: number;
  stage: string;
  last_fed_at: number | null;
  last_played_at: number | null;
  updated_at: number;
};

function clamp(n: number) {
  return Math.max(0, Math.min(100, n));
}

// Apply passive stat changes based on time elapsed since last update
// (~1 point / 20 min). Hunger and happiness decay over time; energy is the
// pet's rest gauge — it has no other way to gain energy, so it recovers while
// the pet is left alone. Play costs energy, and resting builds it back up, so
// the pet is only ever "sleepy" for a while after a lot of play without rest.
function applyDecay(row: PetRow): PetRow {
  const now = Math.floor(Date.now() / 1000);
  const elapsedMin = (now - row.updated_at) / 60;
  const decay = Math.floor(elapsedMin / 20);
  if (decay <= 0) return row;
  return {
    ...row,
    hunger: clamp(row.hunger - decay),
    happiness: clamp(row.happiness - decay),
    energy: clamp(row.energy + decay * 2),
    updated_at: now,
  };
}

function computeStage(hunger: number, happiness: number, energy: number): string {
  const avg = (hunger + happiness + energy) / 3;
  if (avg > 70) return "adult";
  if (avg > 40) return "teen";
  return "baby";
}

async function loadPet(db: D1Database): Promise<PetRow> {
  const row = await db
    .prepare(
      "SELECT name, hunger, happiness, energy, stage, last_fed_at, last_played_at, updated_at FROM pet_state WHERE id = 1"
    )
    .first<PetRow>();
  const decayed = applyDecay(row!);
  if (decayed.updated_at !== row!.updated_at) {
    await db
      .prepare("UPDATE pet_state SET hunger = ?, happiness = ?, energy = ?, updated_at = ? WHERE id = 1")
      .bind(decayed.hunger, decayed.happiness, decayed.energy, decayed.updated_at)
      .run();
  }
  return decayed;
}

pet.get("/", async (c) => {
  const row = await loadPet(c.env.DB);
  return c.json(row);
});

pet.post("/feed", async (c) => {
  const row = await loadPet(c.env.DB);
  const now = Math.floor(Date.now() / 1000);
  const hunger = clamp(row.hunger + 20);
  const stage = computeStage(hunger, row.happiness, row.energy);
  await c.env.DB.prepare(
    "UPDATE pet_state SET hunger = ?, stage = ?, last_fed_at = ?, updated_at = ? WHERE id = 1"
  )
    .bind(hunger, stage, now, now)
    .run();
  if (c.get("role") === "user") {
    await notify(c.env, "admin", "pet", `${row.name} got a snack`, `${c.env.USER_NAME} fed ${row.name} 🐾`);
  }
  return c.json({ ok: true, hunger, stage });
});

pet.post("/play", async (c) => {
  const row = await loadPet(c.env.DB);
  const now = Math.floor(Date.now() / 1000);
  const happiness = clamp(row.happiness + 15);
  const energy = clamp(row.energy - 5);
  const stage = computeStage(row.hunger, happiness, energy);
  await c.env.DB.prepare(
    "UPDATE pet_state SET happiness = ?, energy = ?, stage = ?, last_played_at = ?, updated_at = ? WHERE id = 1"
  )
    .bind(happiness, energy, stage, now, now)
    .run();
  if (c.get("role") === "user") {
    await notify(c.env, "admin", "pet", `${row.name} got some love`, `${c.env.USER_NAME} played with ${row.name} 🎾`);
  }
  return c.json({ ok: true, happiness, energy, stage });
});

export default pet;
