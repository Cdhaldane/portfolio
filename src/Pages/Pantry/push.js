// "Tell me when we're low" for this phone, over the shared home-screen
// worker (see Components/AppIdentity/webPush.js).
import { dropPush, savePush } from "./api";
import * as webPush from "../../Components/AppIdentity/webPush";

const SCOPE = "/pantry";

export const pushSupported = webPush.pushSupported;

export const currentSubscription = () => webPush.currentSubscription(SCOPE);

/** Resolves { ok } or { ok: false, error }. */
export const enableReminders = (getToken, publicKey) =>
  webPush.enablePush({
    scope: SCOPE,
    appName: "Pantry",
    publicKey,
    save: (sub) => savePush(getToken, sub),
  });

export const disableReminders = (getToken) =>
  webPush.disablePush({ scope: SCOPE, drop: (endpoint) => dropPush(getToken, endpoint) });
