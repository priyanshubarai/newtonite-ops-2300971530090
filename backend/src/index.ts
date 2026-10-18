import express from "express";
import { env } from "./config/env.js";
import { healthCheck } from "./health/health.js";

const app = express();

app.use(express.json());
app.get("/health", healthCheck);

app.listen(env.PORT, () => {
  console.log(`Server running on port ${env.PORT}`);
});

export { app };
