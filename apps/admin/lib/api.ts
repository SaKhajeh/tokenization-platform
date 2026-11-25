import { Api } from "@tp/client";

/** Staff sessions are kept apart from the applicant app's (different storage key and origin). */
export const api = new Api("tp-admin");
