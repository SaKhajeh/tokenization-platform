import { z } from "zod";

/** Parse a request body/query with a zod schema; ZodError is mapped to 400 by the exception filter. */
export const parse = <T extends z.ZodTypeAny>(schema: T, data: unknown): z.infer<T> => schema.parse(data ?? {});

export const zUuid = z.string().uuid();
export const zIsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
