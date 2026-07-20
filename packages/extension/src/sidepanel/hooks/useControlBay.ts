import { useCallback, useEffect, useMemo, useState } from "react";
import {
  BAY_COMPOSER_COPY,
  buildLensOptions,
  isUnifiedPanelEnabled,
  orderedSelectedLenses,
  summarizeLensSelection,
} from "../../lib/control-bay";
import type { UserLens } from "../../lib/custom-lens";
import {
  REASONING_EFFORT_KEY,
  clampReasoningEffortToModel,
  reasoningEffortsForModel,
  validateReasoningEffort,
  type ReasoningEffort,
} from "../../lib/reasoning-settings";
import {
  SELECTED_LENSES_KEY,
  STORE_PAGE_LENSES_KEY,
  UNIFIED_PANEL_KEY,
} from "../constants";
import { sendRuntimeMessage } from "../lib/chrome";
import { formatError } from "../lib/format";
import {
  resolveComposerAction,
  type ComposerMode,
  type PendingLensRun,
} from "../../lib/composer";
import {
  DEFAULT_MODEL_PROVIDER,
  defaultChatModelForProvider,
  validateModelForProvider,
  validModelsForProvider,
  type AiModel,
  type ModelProvider,
} from "../../types/ai-models";
import {
  AI_SETTINGS_STORAGE_KEYS,
  readAiSettingsStorage,
  readModelProvider,
  readProviderChatModel,
} from "../../lib/ai-settings-compat";

// Guarded with `typeof` so tests that load this module without the bundler's
// define still run.
const CONTEST_BUILD =
  typeof __CONTEST_BUILD__ === "undefined" ? false : __CONTEST_BUILD__;

interface UseControlBayOptions {
  sendChat: (question: string) => Promise<boolean>;
  refreshFindings: () => Promise<void>;
  showWarning: (message: string) => void;
  onLensRunStart?: (lensIds: readonly string[]) => void;
  onLensRunComplete?: (lensIds: readonly string[]) => void;
  onLensRunError?: (lensIds: readonly string[], error?: string) => void;
  onRunLensIds?: (
    lensIds: readonly string[],
    options?: { storePageLenses?: boolean }
  ) => Promise<void>;
  // When provided, a lens-mode submit builds a named, promotable one-off lens.
  onCreateLens?: (
    instruction: string,
    options?: { storePageLenses?: boolean }
  ) => Promise<void>;
  // Promoted user lenses, surfaced as extra chips after the built-ins so they
  // can be re-selected and re-run from the bar.
  userLenses?: readonly UserLens[];
}

export function useControlBay({
  sendChat,
  refreshFindings,
  showWarning,
  onLensRunStart,
  onLensRunComplete,
  onLensRunError,
  onRunLensIds,
  onCreateLens,
  userLenses = [],
}: UseControlBayOptions) {
  // Contest builds have no toolbar popup, so the side panel always hosts the
  // popup's controls; otherwise the unified-panel experiment flag decides.
  const [isUnified, setIsUnified] = useState(CONTEST_BUILD);
  const [selectedLensIds, setSelectedLensIds] = useState<string[]>([]);
  const [storePageLenses, setStorePageLenses] = useState(true);
  const [autoRun, setAutoRun] = useState(false);
  const [mode, setMode] = useState<ComposerMode>("lens");
  const [input, setInput] = useState("");
  const [isModeMenuOpen, setIsModeMenuOpen] = useState(false);
  const [isModelMenuOpen, setIsModelMenuOpen] = useState(false);
  const [modelProvider, setModelProviderState] =
    useState<ModelProvider>(DEFAULT_MODEL_PROVIDER);
  const [chatModelsByProvider, setChatModelsByProvider] = useState<Record<ModelProvider, AiModel>>({
    anthropic: defaultChatModelForProvider("anthropic"),
    openai: defaultChatModelForProvider("openai"),
  });
  const [reasoningEffort, setReasoningEffortState] =
    useState<ReasoningEffort>("medium");
  const [isRunning, setIsRunning] = useState(false);

  // Built-in chips plus promoted user lenses; the derived order/labels extend
  // the lib's built-in defaults so a selected user lens isn't dropped from the
  // ordered run payload or the collapsed-bar summary.
  const lensOptions = useMemo(() => buildLensOptions(userLenses), [userLenses]);
  const lensOrder = useMemo(() => lensOptions.map((option) => option.id), [lensOptions]);
  const lensLabels = useMemo(
    () => Object.fromEntries(lensOptions.map((option) => [option.id, option.label])),
    [lensOptions]
  );

  const orderedLensIds = useMemo(
    () => orderedSelectedLenses(selectedLensIds, lensOrder),
    [selectedLensIds, lensOrder]
  );
  const summary = useMemo(
    () => summarizeLensSelection(orderedLensIds, lensOrder, lensLabels),
    [orderedLensIds, lensOrder, lensLabels]
  );
  const copy = BAY_COMPOSER_COPY[mode];
  const chatModel = chatModelsByProvider[modelProvider];
  const modelOptions = useMemo(() => validModelsForProvider(modelProvider), [modelProvider]);
  // Effort availability is a property of the chosen model, not just its provider
  // (Haiku exposes none). Keying off the model keeps the menu in lockstep with
  // what the API clients actually honour.
  const reasoningEffortOptions = useMemo(
    () => reasoningEffortsForModel(chatModel),
    [chatModel]
  );
  const modelSupportsReasoning = reasoningEffortOptions.length > 0;

  // Keep the active effort valid for the current model. Switching to a model
  // that ignores effort leaves the stored level untouched (so it returns when
  // a supporting model is chosen again); switching to one that supports a
  // narrower set downgrades an out-of-range level to the default.
  useEffect(() => {
    setReasoningEffortState((current) => clampReasoningEffortToModel(current, chatModel));
  }, [chatModel]);

  useEffect(() => {
    let cancelled = false;

    async function loadState() {
      const local = await chrome.storage.local
        .get([SELECTED_LENSES_KEY, STORE_PAGE_LENSES_KEY, "autoRun", "autoAnalyze"])
        .catch(() => ({}) as Record<string, unknown>);
      const [aiSync, panelSync] = await Promise.all([
        readAiSettingsStorage().catch(() => ({}) as Record<string, unknown>),
        chrome.storage.sync
          .get([UNIFIED_PANEL_KEY, REASONING_EFFORT_KEY])
          .catch(() => ({}) as Record<string, unknown>),
      ]);
      const sync = { ...aiSync, ...panelSync };
      if (cancelled) return;

      setSelectedLensIds(readStringArray(local[SELECTED_LENSES_KEY]));
      setStorePageLenses(
        typeof local[STORE_PAGE_LENSES_KEY] === "boolean"
          ? local[STORE_PAGE_LENSES_KEY]
          : true
      );
      setAutoRun(
        typeof local.autoRun === "boolean" ? local.autoRun : local.autoAnalyze === true
      );
      setIsUnified(CONTEST_BUILD || isUnifiedPanelEnabled(sync[UNIFIED_PANEL_KEY]));
      const provider = readModelProvider(sync);
      setModelProviderState(provider);
      setChatModelsByProvider({
        anthropic: validateModelForProvider(
          readProviderChatModel(sync, "anthropic"),
          "anthropic",
          defaultChatModelForProvider("anthropic")
        ),
        openai: validateModelForProvider(
          readProviderChatModel(sync, "openai"),
          "openai",
          defaultChatModelForProvider("openai")
        ),
      });
      setReasoningEffortState(validateReasoningEffort(sync[REASONING_EFFORT_KEY]));
    }

    void loadState();

    const listener = (
      changes: Record<string, chrome.storage.StorageChange>,
      areaName: string
    ) => {
      if (areaName === "sync" && changes[UNIFIED_PANEL_KEY]) {
        setIsUnified(CONTEST_BUILD || isUnifiedPanelEnabled(changes[UNIFIED_PANEL_KEY].newValue));
      }
      if (areaName === "sync") {
        if (changes[AI_SETTINGS_STORAGE_KEYS.provider]) {
          // The model-keyed effect re-clamps the effort once the derived
          // chatModel follows the new provider, so no coercion is needed here.
          setModelProviderState(
            readModelProvider({
              [AI_SETTINGS_STORAGE_KEYS.provider]:
                changes[AI_SETTINGS_STORAGE_KEYS.provider].newValue,
            })
          );
        }
        if (
          changes[AI_SETTINGS_STORAGE_KEYS.anthropicChatModel] ||
          changes[AI_SETTINGS_STORAGE_KEYS.openaiChatModel]
        ) {
          setChatModelsByProvider((current) => ({
            anthropic: validateModelForProvider(
              readString(changes[AI_SETTINGS_STORAGE_KEYS.anthropicChatModel]?.newValue) ??
                String(current.anthropic),
              "anthropic",
              defaultChatModelForProvider("anthropic")
            ),
            openai: validateModelForProvider(
              readString(changes[AI_SETTINGS_STORAGE_KEYS.openaiChatModel]?.newValue) ??
                String(current.openai),
              "openai",
              defaultChatModelForProvider("openai")
            ),
          }));
        }
        if (changes[REASONING_EFFORT_KEY]) {
          setReasoningEffortState(
            validateReasoningEffort(changes[REASONING_EFFORT_KEY].newValue)
          );
        }
        return;
      }
      if (areaName !== "local") return;
      if (changes[SELECTED_LENSES_KEY]) {
        setSelectedLensIds(readStringArray(changes[SELECTED_LENSES_KEY].newValue));
      }
      if (changes[STORE_PAGE_LENSES_KEY]?.newValue !== undefined) {
        setStorePageLenses(changes[STORE_PAGE_LENSES_KEY].newValue === true);
      }
      if (changes.autoRun?.newValue !== undefined) {
        setAutoRun(changes.autoRun.newValue === true);
      }
    };

    chrome.storage.onChanged.addListener(listener);
    return () => {
      cancelled = true;
      chrome.storage.onChanged.removeListener(listener);
    };
  }, []);

  const setLensSelected = useCallback(
    (lensId: string, selected: boolean) => {
      const next = selected
        ? orderedSelectedLenses([...selectedLensIds, lensId], lensOrder)
        : orderedSelectedLenses(selectedLensIds.filter((id) => id !== lensId), lensOrder);
      setSelectedLensIds(next);
      void chrome.storage.local.set({ [SELECTED_LENSES_KEY]: next });
    },
    [selectedLensIds, lensOrder]
  );

  const setAutoRunEnabled = useCallback((enabled: boolean) => {
    setAutoRun(enabled);
    void chrome.storage.local.set({ autoRun: enabled, autoAnalyze: enabled });
  }, []);

  const chooseChatModel = useCallback(
    (model: string) => {
      const nextModel = validateModelForProvider(
        model,
        modelProvider,
        defaultChatModelForProvider(modelProvider)
      );
      setChatModelsByProvider((current) => ({
        ...current,
        [modelProvider]: nextModel,
      }));
      void chrome.storage.sync.set({
        [modelProvider === "openai"
          ? AI_SETTINGS_STORAGE_KEYS.openaiChatModel
          : AI_SETTINGS_STORAGE_KEYS.anthropicChatModel]: nextModel,
      });
    },
    [modelProvider]
  );

  const chooseReasoningEffort = useCallback((effort: ReasoningEffort) => {
    const nextEffort = clampReasoningEffortToModel(effort, chatModel);
    setReasoningEffortState(nextEffort);
    void chrome.storage.sync.set({ [REASONING_EFFORT_KEY]: nextEffort });
  }, [chatModel]);

  const runLensIds = useCallback(
    async (
      lensIds: readonly string[],
      options: { storePageLenses?: boolean } = {}
    ) => {
      const nextLensIds = orderedSelectedLenses(lensIds, lensOrder);
      if (nextLensIds.length === 0 || isRunning) return;
      onLensRunStart?.(nextLensIds);
      setIsRunning(true);
      try {
        if (onRunLensIds) {
          await onRunLensIds(nextLensIds, {
            storePageLenses: options.storePageLenses ?? storePageLenses,
          });
        } else {
          const result = await sendRuntimeMessage<{ error?: string }>({
            type: "run-page-lenses",
            lensIds: nextLensIds,
            storePageLenses: options.storePageLenses ?? storePageLenses,
          });
          await refreshFindings();
          if (result?.error) {
            onLensRunError?.(nextLensIds, result.error);
            showWarning(result.error);
          } else {
            onLensRunComplete?.(nextLensIds);
          }
        }
      } catch (error) {
        const message = formatError(error);
        onLensRunError?.(nextLensIds, message);
        showWarning(message);
      } finally {
        setIsRunning(false);
      }
    },
    [
      isRunning,
      lensOrder,
      onLensRunComplete,
      onLensRunError,
      onLensRunStart,
      onRunLensIds,
      refreshFindings,
      showWarning,
      storePageLenses,
    ]
  );

  const runSelectedLenses = useCallback(async () => {
    await runLensIds(orderedLensIds);
  }, [orderedLensIds, runLensIds]);

  const runCustomLens = useCallback(
    async (
      instruction: string,
      options: { storePageLenses?: boolean } = {}
    ) => {
      // The named one-off flow owns naming, the page run, and promotion; fall
      // back to a bare custom run only if it isn't wired in.
      if (onCreateLens) {
        await onCreateLens(instruction, options);
        return;
      }
      try {
        const result = await sendRuntimeMessage<{ error?: string }>({
          type: "run-page-lenses",
          customLens: { instruction },
          storePageLenses: options.storePageLenses ?? storePageLenses,
        });
        if (result?.error) showWarning(result.error);
        await refreshFindings();
      } catch (error) {
        showWarning(formatError(error));
      }
    },
    [onCreateLens, refreshFindings, showWarning, storePageLenses]
  );

  const runPendingLensRun = useCallback(
    async (run: PendingLensRun) => {
      if (run.customLens) {
        await runCustomLens(run.customLens.instruction, {
          storePageLenses: run.storePageLenses,
        });
        return;
      }
      await runLensIds(run.lensIds ?? [], {
        storePageLenses: run.storePageLenses,
      });
    },
    [runCustomLens, runLensIds]
  );

  const submitComposer = useCallback(async () => {
    const action = resolveComposerAction(mode, input);
    if (action.kind === "noop") return;

    setInput("");
    if (action.kind === "ask") {
      await sendChat(action.instruction);
      return;
    }
    await runCustomLens(action.instruction);
  }, [input, mode, runCustomLens, sendChat]);

  const chooseMode = useCallback(
    async (nextMode: ComposerMode) => {
      setMode(nextMode);
      setIsModeMenuOpen(false);
      if (input.trim()) {
        const action = resolveComposerAction(nextMode, input);
        setInput("");
        if (action.kind === "ask") {
          await sendChat(action.instruction);
        } else if (action.kind === "lens") {
          await runCustomLens(action.instruction);
        }
      }
    },
    [input, runCustomLens, sendChat]
  );

  return {
    isUnified,
    lensOptions,
    selectedLensIds: orderedLensIds,
    storePageLenses,
    autoRun,
    mode,
    copy,
    input,
    setInput,
    summary,
    isModeMenuOpen,
    setIsModeMenuOpen,
    isModelMenuOpen,
    setIsModelMenuOpen,
    modelProvider,
    chatModel,
    modelOptions,
    reasoningEffort,
    reasoningEffortOptions,
    modelSupportsReasoning,
    isRunning,
    canRun: orderedLensIds.length > 0 && !isRunning,
    canSubmit: input.trim().length > 0,
    setLensSelected,
    setAutoRunEnabled,
    chooseChatModel,
    chooseReasoningEffort,
    runSelectedLenses,
    runPendingLensRun,
    submitComposer,
    chooseMode,
  };
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
}
