import { Router } from "express";
import { requireAuth } from "../auth/middleware.js";
import { asyncHandler, badRequest, notFound } from "../common/errors.js";
import { listItems, getItem, createItem, updateItem } from "./service.js";
import {
  createItemSchema,
  itemIdSchema,
  listItemsQuerySchema,
  updateItemSchema,
} from "./validation.js";

export const itemsRouter = Router();

/**
 * Work-item routes. All require authentication; every handler is team-scoped
 * through the service layer, which resolves the caller's role from the database
 * for the resource's real team. Handlers stay thin and rely on `asyncHandler`
 * plus the central error handler to turn a thrown `ApiError` into a JSON
 * response and any other failure into a generic 500.
 */

// Validate `:id` as a UUID before touching the database. A malformed id fails
// closed as 404 (consistent with the authorization convention) so it cannot be
// distinguished from a non-existent item. Express may type a param as
// `string | string[]`; anything but a single string is treated as not found.
function requireItemId(raw: string | string[] | undefined): string {
  if (typeof raw !== "string") {
    throw notFound();
  }
  const parsed = itemIdSchema.safeParse(raw);
  if (!parsed.success) {
    throw notFound();
  }
  return parsed.data;
}

// GET /items - filtered, paginated, team-scoped listing.
itemsRouter.get(
  "/",
  requireAuth,
  asyncHandler(async (req, res) => {
    const parsed = listItemsQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      throw badRequest("Invalid query parameters", parsed.error.flatten().fieldErrors);
    }

    const page = await listItems(req.user!.id, parsed.data);
    res.status(200).json(page);
  }),
);

// POST /items - create a work item.
itemsRouter.post(
  "/",
  requireAuth,
  asyncHandler(async (req, res) => {
    const parsed = createItemSchema.safeParse(req.body);
    if (!parsed.success) {
      throw badRequest("Invalid request body", parsed.error.flatten().fieldErrors);
    }

    const item = await createItem(req.user!.id, parsed.data);
    res.status(201).json(item);
  }),
);

// GET /items/:id - work-item detail.
itemsRouter.get(
  "/:id",
  requireAuth,
  asyncHandler(async (req, res) => {
    const id = requireItemId(req.params.id);
    const item = await getItem(req.user!.id, id);
    res.status(200).json(item);
  }),
);

// PATCH /items/:id - update permitted fields.
itemsRouter.patch(
  "/:id",
  requireAuth,
  asyncHandler(async (req, res) => {
    const id = requireItemId(req.params.id);

    const parsed = updateItemSchema.safeParse(req.body);
    if (!parsed.success) {
      throw badRequest("Invalid request body", parsed.error.flatten().fieldErrors);
    }

    const item = await updateItem(req.user!.id, id, parsed.data);
    res.status(200).json(item);
  }),
);
