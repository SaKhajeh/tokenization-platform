import { Api } from "@tp/client";

/** One client per browser tab; tokens persist under "tp-web". */
export const api = new Api("tp-web");
