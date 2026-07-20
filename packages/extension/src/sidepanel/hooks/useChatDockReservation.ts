import { useLayoutEffect, type RefObject } from "react";
import { accordionCapPx } from "../lib/chat-dock-layout";

// Caps the accordion's height so the chat dock always keeps room for the
// composer plus a sliver of history (see chat-dock-layout for the why). The cap
// is applied as an inline max-height that overrides the static `42%` rule, and
// is recomputed whenever the composer grows/shrinks or the panel resizes.
//
// `deps` should include anything that changes the header/banner block above the
// accordion (banners, unsupported-page state, source), since that shifts the
// accordion's top edge without resizing the panel itself.
export function useChatDockReservation(
  panelRef: RefObject<HTMLElement | null>,
  accordionRef: RefObject<HTMLElement | null>,
  deps: unknown[]
): void {
  useLayoutEffect(() => {
    const panel = panelRef.current;
    const accordion = accordionRef.current;
    if (!panel || !accordion) return;

    const apply = () => {
      const composer = panel.querySelector<HTMLElement>(".chat-form");
      if (!composer) return;
      const dockHead = panel.querySelector<HTMLElement>(".chat-dock-head");
      const panelRect = panel.getBoundingClientRect();
      const cap = accordionCapPx({
        panelBottom: panelRect.bottom,
        panelHeight: panelRect.height,
        accordionTop: accordion.getBoundingClientRect().top,
        dockHeadHeight: dockHead?.getBoundingClientRect().height ?? 0,
        composerHeight: composer.getBoundingClientRect().height,
      });
      accordion.style.maxHeight = `${cap}px`;
    };

    apply();

    // Watch the panel (window resize) and the composer (textarea auto-grow).
    // Neither resizes as a result of the accordion shrinking, so applying the
    // cap inside the observer can't feed back into another resize.
    const observer = new ResizeObserver(apply);
    observer.observe(panel);
    const composer = panel.querySelector<HTMLElement>(".chat-form");
    if (composer) observer.observe(composer);
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}
