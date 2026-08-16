import { useEffect, useState } from "react";
import { api, ApiError } from "../lib/api";
import { useAuth } from "../lib/AuthContext";

type WeatherData = {
  condition: string;
  description: string;
  tempC: number;
  feelsLikeC: number;
  humidity: number;
  city: string;
  message: string;
};

export default function Weather() {
  const { role } = useAuth();
  const [weather, setWeather] = useState<WeatherData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (role === "admin") {
      api
        .get<WeatherData>("/weather")
        .then(setWeather)
        .catch((e) => setError(e instanceof ApiError ? e.message : "No weather data yet."));
      return;
    }
    if (!navigator.geolocation) {
      setError("Location access isn't available on this device.");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        api
          .get<WeatherData>(`/weather?lat=${pos.coords.latitude}&lon=${pos.coords.longitude}`)
          .then(setWeather)
          .catch((e) => setError(e instanceof ApiError ? e.message : "Couldn't fetch weather."));
      },
      () => setError("Location permission denied — enable it to see today's weather.")
    );
  }, [role]);

  return (
    <div className="page">
      <h2>Weather</h2>
      {error && <p className="error-text">{error}</p>}
      {weather && (
        <div className="weather-card">
          <p className="weather-city">{weather.city}</p>
          <p className="weather-temp">{Math.round(weather.tempC)}°C</p>
          <p className="subtle">
            {weather.description} · feels like {Math.round(weather.feelsLikeC)}°C · {weather.humidity}% humidity
          </p>
          <p className="jar-message-text">{weather.message}</p>
        </div>
      )}
    </div>
  );
}
