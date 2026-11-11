// The league-night reminder for this phone, over the shared home-screen
// worker (see Components/AppIdentity/webPush.js). The server decides when
// league night is; this only switches the phone on or off.
import { dropPush, savePush } from "./api";
import * as webPush from "../../Components/AppIdentity/webPush";

const SCOPE = "/bowler";

export const pushSupported = webPush.pushSupported;

export const currentSubscription = () => webPush.currentSubscription(SCOPE);

/** Resolves { ok } or { ok: false, error }. */
export const enableReminders = (getToken, publicKey) =>
  webPush.enablePush({
    scope: SCOPE,
    appName: "Bowler",
    publicKey,
    save: (sub) => savePush(getToken, sub),
  });

export const disableReminders = (getToken) =>
  webPush.disablePush({ scope: SCOPE, drop: (endpoint) => dropPush(getToken, endpoint) });
