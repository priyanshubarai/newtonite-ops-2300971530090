import type { Request, Response } from "express";
import { pool } from "../db/index.js";

export async function healthCheck(_req: Request, res: Response) {
  try {
    const result = await pool.query("SELECT 1 as ok");
    const dbOk = result.rows[0]?.ok === 1;
    if (!dbOk) {
      return res.status(503).json({
        status: "degraded",
        database: "unhealthy",
      });
    }
    return res.status(200).json({
      status: "ok",
      database: "healthy",
    });
  } catch (error) {
    return res.status(503).json({
      status: "unhealthy",
      database: "unhealthy",
      error: "Database connection failed",
    });
  }
}
