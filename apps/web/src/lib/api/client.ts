import createClient from "openapi-fetch";
import type { paths } from "./v1";

const baseUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://127.0.0.1:3001";

export const api = createClient<paths>({ baseUrl });
