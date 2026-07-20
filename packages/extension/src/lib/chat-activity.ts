import {
  foldSearchEvent,
  isSearchInFlight,
  type WebSearchEntry,
  type WebSearchEvent,
} from "./web-search.js";

export type ChatActivityItem =
  | {
      kind: "thinking";
      text: string;
      live?: boolean;
    }
  | {
      kind: "research";
      searches: WebSearchEntry[];
      live?: boolean;
    };

export function legacyActivityItems({
  thinkingText,
  thinkingLive = false,
  searches,
  searching = false,
}: {
  thinkingText?: string;
  thinkingLive?: boolean;
  searches?: WebSearchEntry[];
  searching?: boolean;
}): ChatActivityItem[] {
  const activity: ChatActivityItem[] = [];
  const text = thinkingText?.trim() ?? "";
  if (text) activity.push({ kind: "thinking", text, live: thinkingLive });
  if (searches && searches.length > 0) {
    activity.push({ kind: "research", searches, live: searching || isSearchInFlight(searches) });
  }
  return activity;
}

export function startActivityThinking(activity: ChatActivityItem[]): ChatActivityItem[] {
  const last = activity[activity.length - 1];
  if (last?.kind === "thinking" && last.text.trim().length === 0) {
    return replaceActivityAt(activity, activity.length - 1, { ...last, live: true });
  }
  return [...activity, { kind: "thinking", text: "", live: true }];
}

export function appendActivityThinkingDelta(
  activity: ChatActivityItem[],
  text: string
): ChatActivityItem[] {
  if (!text) return activity;
  const index = lastActivityIndex(activity, "thinking");
  if (index < 0) return [...activity, { kind: "thinking", text, live: true }];
  const item = activity[index];
  if (item.kind !== "thinking") return activity;
  return replaceActivityAt(activity, index, {
    ...item,
    text: `${item.text}${text}`,
    live: true,
  });
}

export function finishActivityThinking(
  activity: ChatActivityItem[],
  fullText?: string
): ChatActivityItem[] {
  const index = lastActivityIndex(activity, "thinking");
  if (index < 0) return activity;
  const item = activity[index];
  if (item.kind !== "thinking") return activity;
  return replaceActivityAt(activity, index, {
    ...item,
    text: fullText ?? item.text,
    live: false,
  });
}

export function foldActivitySearchEvent(
  activity: ChatActivityItem[],
  event: WebSearchEvent
): ChatActivityItem[] {
  const targetIndex =
    event.event === "start"
      ? activity[activity.length - 1]?.kind === "research"
        ? activity.length - 1
        : -1
      : lastOpenResearchIndex(activity, event.kind ?? "search");

  if (targetIndex < 0) {
    return [
      ...activity,
      {
        kind: "research",
        searches: foldSearchEvent([], event),
        live: event.event !== "end",
      },
    ];
  }

  const item = activity[targetIndex];
  if (item.kind !== "research") return activity;
  const searches = foldSearchEvent(item.searches, event);
  return replaceActivityAt(activity, targetIndex, {
    ...item,
    searches,
    live: isSearchInFlight(searches),
  });
}

export function isActivityInFlight(activity: ChatActivityItem[]): boolean {
  return activity.some((item) => {
    if (item.live) return true;
    return item.kind === "research" && isSearchInFlight(item.searches);
  });
}

function lastActivityIndex(
  activity: ChatActivityItem[],
  kind: ChatActivityItem["kind"]
): number {
  for (let index = activity.length - 1; index >= 0; index--) {
    if (activity[index]?.kind === kind) return index;
  }
  return -1;
}

function lastOpenResearchIndex(activity: ChatActivityItem[], kind: WebSearchEvent["kind"]): number {
  const targetKind = kind ?? "search";
  for (let index = activity.length - 1; index >= 0; index--) {
    const item = activity[index];
    if (item?.kind !== "research") continue;
    if (item.searches.some((entry) => !entry.done && entry.kind === targetKind)) return index;
  }
  return lastActivityIndex(activity, "research");
}

function replaceActivityAt(
  activity: ChatActivityItem[],
  index: number,
  item: ChatActivityItem
): ChatActivityItem[] {
  return activity.map((current, currentIndex) => (currentIndex === index ? item : current));
}
