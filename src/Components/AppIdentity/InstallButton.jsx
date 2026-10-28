import { useState, useSyncExternalStore } from "react";
import { canPromptInstall, isIOS, isStandalone, onInstallChange, promptInstall } from "./install";

/*
 * "Put this on my phone" for an app surface. On Android Chrome it opens the
 * browser's own install dialog (the prompt install.js held for this
 * surface). iPhone Safari has no such dialog, so there it reveals the two
 * taps instead. Renders nothing when already running as the installed app,
 * or when the browser offers neither (including once it's installed).
 *
 * Unstyled on purpose: each surface passes its own classes.
 */
const InstallButton = ({ name, className, tipClassName, children }) => {
  const can = useSyncExternalStore(onInstallChange, canPromptInstall, () => false);
  const [tip, setTip] = useState(false);

  if (isStandalone()) return null;

  if (can) {
    return (
      <button type="button" className={className} onClick={() => promptInstall()}>
        {children}
      </button>
    );
  }

  if (isIOS()) {
    return (
      <>
        <button type="button" className={className} aria-expanded={tip} onClick={() => setTip((t) => !t)}>
          {children}
        </button>
        {tip && (
          <p className={tipClassName} role="note">
            In Safari, tap <b>Share</b>, then <b>Add to Home Screen</b>. {name} opens full screen
            from there.
          </p>
        )}
      </>
    );
  }

  return null;
};

export default InstallButton;
