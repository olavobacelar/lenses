import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { z } from "zod";
import {
  DEFAULT_ANTHROPIC_CHAT_MODEL,
  DEFAULT_ANTHROPIC_EXECUTION_MODEL,
} from "../types/claude";
import {
  DEFAULT_MODEL_PROVIDER,
  DEFAULT_OPENAI_CHAT_MODEL,
  DEFAULT_OPENAI_EXECUTION_MODEL,
  validModelsForProvider,
  validateModelForProvider,
  validateProvider,
  type AiModel,
  type ModelProvider,
} from "../types/ai-models";
import {
  AI_SETTINGS_STORAGE_KEYS,
  readAiSettingsStorage,
  readModelProvider,
  readProviderApiKey,
  readProviderChatModel,
  readProviderExecutionModel,
} from "../lib/ai-settings-compat";
import {
  initTheme,
  isThemePreference,
  type ThemeController,
  type ThemePreference,
} from "../lib/theme";
import {
  PAGE_DOCK_ALLOWED_DOMAINS_KEY,
  PAGE_DOCK_DISABLED_HOSTS_KEY,
  PAGE_DOCK_ENABLED_KEY,
  PAGE_DOCK_VISIBILITY_MODE_KEY,
  parsePageDockSettings,
  readPageDockAllowedDomains,
  readPageDockDisabledHosts,
  type PageDockVisibilityMode,
} from "../lib/page-dock-settings";
import {
  SELECTION_TRIGGER_ALLOWED_DOMAINS_KEY,
  SELECTION_TRIGGER_DISABLED_HOSTS_KEY,
  SELECTION_TRIGGER_DOMAIN_STYLES_KEY,
  SELECTION_TRIGGER_ENABLED_KEY,
  SELECTION_TRIGGER_STYLE_KEY,
  SELECTION_TRIGGER_VISIBILITY_MODE_KEY,
  parseSelectionTriggerSettings,
  readSelectionTriggerAllowedDomains,
  readSelectionTriggerDisabledHosts,
  readSelectionTriggerDomainStyles,
  type SelectionTriggerDomainStyle,
  type SelectionTriggerStyle,
  type SelectionTriggerVisibilityMode,
} from "../lib/selection-trigger-settings";
import {
  APP_ACCESS_MODE_STORAGE_KEY,
  DEFAULT_APP_ACCESS_MODE,
  parseAppAccessMode,
  readAppAccessMode,
  type AppAccessMode,
} from "../lib/app-mode";
import { CHAT_ACTIONS_USE_SIDE_PANEL_KEY } from "../lib/chat-surface-settings";

const StorageSettingsSchema = z
  .object({
    debugMode: z.boolean().optional(),
    experimentalUnifiedPanel: z.boolean().optional(),
  })
  .passthrough();

interface ProviderModels {
  chat: AiModel;
  execution: AiModel;
}

type ModelsByProvider = Record<ModelProvider, ProviderModels>;

const DEFAULT_MODELS_BY_PROVIDER: ModelsByProvider = {
  anthropic: {
    chat: DEFAULT_ANTHROPIC_CHAT_MODEL,
    execution: DEFAULT_ANTHROPIC_EXECUTION_MODEL,
  },
  openai: {
    chat: DEFAULT_OPENAI_CHAT_MODEL,
    execution: DEFAULT_OPENAI_EXECUTION_MODEL,
  },
};

export interface OptionsSettingsState {
  appAccessMode: AppAccessMode;
  provider: ModelProvider;
  anthropicApiKey: string;
  openaiApiKey: string;
  selectedModelsByProvider: ModelsByProvider;
  debugMode: boolean;
  experimentalUnifiedPanel: boolean;
  pageDockEnabled: boolean;
  chatActionsUseSidePanel: boolean;
  pageDockVisibilityMode: PageDockVisibilityMode;
  pageDockAllowedDomains: string[];
  pageDockDisabledHosts: string[];
  selectionTriggerEnabled: boolean;
  selectionTriggerVisibilityMode: SelectionTriggerVisibilityMode;
  selectionTriggerAllowedDomains: string[];
  selectionTriggerDisabledHosts: string[];
  selectionTriggerStyle: SelectionTriggerStyle;
  selectionTriggerDomainStyles: SelectionTriggerDomainStyle[];
  theme: ThemePreference;
}

const DEFAULT_STATE: OptionsSettingsState = {
  appAccessMode: DEFAULT_APP_ACCESS_MODE,
  provider: DEFAULT_MODEL_PROVIDER,
  anthropicApiKey: "",
  openaiApiKey: "",
  selectedModelsByProvider: DEFAULT_MODELS_BY_PROVIDER,
  debugMode: false,
  experimentalUnifiedPanel: false,
  pageDockEnabled: true,
  chatActionsUseSidePanel: false,
  pageDockVisibilityMode: "all",
  pageDockAllowedDomains: [],
  pageDockDisabledHosts: [],
  selectionTriggerEnabled: true,
  selectionTriggerVisibilityMode: "all",
  selectionTriggerAllowedDomains: [],
  selectionTriggerDisabledHosts: [],
  selectionTriggerStyle: "immediate",
  selectionTriggerDomainStyles: [],
  theme: "system",
};

// Settings persist automatically. Debounce so typing in the API-key and
// domain-list fields coalesces into a single write instead of one per keystroke.
const AUTOSAVE_DEBOUNCE_MS = 400;
const API_KEY_TEST_DEBOUNCE_MS = 900;

export function useOptionsSettings() {
  const [settings, setSettings] = useState<OptionsSettingsState>(DEFAULT_STATE);
  const [status, setStatus] = useState({ message: "", isError: false, isSuccess: false });
  const [themeController, setThemeController] = useState<ThemeController | null>(null);
  // Stays false until stored values are loaded, so the auto-save effect never
  // writes the defaults over real settings before the restore lands.
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    const controller = initTheme({
      fastCache: true,
      onChange: (preference) => {
        setSettings((current) => ({ ...current, theme: preference }));
      },
    });
    setThemeController(controller);
    return () => controller.destroy();
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function restoreSettings() {
      const [aiStored, displayStored] = await Promise.all([
        readAiSettingsStorage(),
        chrome.storage.sync.get(["debugMode", "experimentalUnifiedPanel"]),
      ]);
      const stored = { ...aiStored, ...displayStored };
      const [localStored, appAccessMode] = await Promise.all([
        chrome.storage.local.get([
          "debugMode",
          PAGE_DOCK_ENABLED_KEY,
          CHAT_ACTIONS_USE_SIDE_PANEL_KEY,
          PAGE_DOCK_VISIBILITY_MODE_KEY,
          PAGE_DOCK_ALLOWED_DOMAINS_KEY,
          PAGE_DOCK_DISABLED_HOSTS_KEY,
          SELECTION_TRIGGER_ENABLED_KEY,
          SELECTION_TRIGGER_VISIBILITY_MODE_KEY,
          SELECTION_TRIGGER_ALLOWED_DOMAINS_KEY,
          SELECTION_TRIGGER_DISABLED_HOSTS_KEY,
          SELECTION_TRIGGER_STYLE_KEY,
          SELECTION_TRIGGER_DOMAIN_STYLES_KEY,
          APP_ACCESS_MODE_STORAGE_KEY,
        ]),
        readAppAccessMode(),
      ]);
      localStored[APP_ACCESS_MODE_STORAGE_KEY] = appAccessMode;
      if (cancelled) return;
      setSettings((current) => ({
        ...current,
        ...settingsFromStorage(stored, localStored),
      }));
      setHydrated(true);
    }

    void restoreSettings().catch((error) => showStatus(formatError(error), true));
    return () => {
      cancelled = true;
    };
  }, []);

  const modelsForProvider = useMemo(
    () => validModelsForProvider(settings.provider),
    [settings.provider]
  );

  const showStatus = useCallback((message: string, isError = false, isSuccess = false) => {
    setStatus({ message, isError, isSuccess });
  }, []);

  const updateSetting = useCallback(
    <K extends keyof OptionsSettingsState>(key: K, value: OptionsSettingsState[K]) => {
      setSettings((current) => ({ ...current, [key]: value }));
    },
    []
  );

  const setProvider = useCallback((provider: string) => {
    setSettings((current) => ({ ...current, provider: validateProvider(provider) }));
  }, []);

  const setModel = useCallback(
    (kind: "chat" | "execution", model: string) => {
      setSettings((current) => {
        const provider = current.provider;
        const fallback =
          kind === "execution"
            ? provider === "openai"
              ? DEFAULT_OPENAI_EXECUTION_MODEL
              : DEFAULT_ANTHROPIC_EXECUTION_MODEL
            : undefined;
        return {
          ...current,
          selectedModelsByProvider: {
            ...current.selectedModelsByProvider,
            [provider]: {
              ...current.selectedModelsByProvider[provider],
              [kind]: validateModelForProvider(model, provider, fallback),
            },
          },
        };
      });
    },
    []
  );

  const setTheme = useCallback(
    (value: string) => {
      if (!isThemePreference(value)) return;
      setSettings((current) => ({ ...current, theme: value }));
      void themeController?.setPreference(value);
    },
    [themeController]
  );

  // Writes a settings snapshot to storage. Domain lists are normalized on the
  // way out (not back into React state) so cleanup never fights the user's
  // typing while the debounced auto-save fires.
  const persistSettings = useCallback(async (snapshot: OptionsSettingsState) => {
    const provider = snapshot.provider;
    const anthropicApiKey = snapshot.anthropicApiKey.trim();
    const openaiApiKey = snapshot.openaiApiKey.trim();

    await chrome.storage.sync.set({
      [AI_SETTINGS_STORAGE_KEYS.provider]: provider,
      [AI_SETTINGS_STORAGE_KEYS.anthropicChatModel]:
        snapshot.selectedModelsByProvider.anthropic.chat,
      [AI_SETTINGS_STORAGE_KEYS.openaiChatModel]:
        snapshot.selectedModelsByProvider.openai.chat,
      [AI_SETTINGS_STORAGE_KEYS.anthropicExecutionModel]:
        snapshot.selectedModelsByProvider.anthropic.execution,
      [AI_SETTINGS_STORAGE_KEYS.openaiExecutionModel]:
        snapshot.selectedModelsByProvider.openai.execution,
      debugMode: __INTERNAL_TOOLS__ && snapshot.debugMode,
      experimentalUnifiedPanel: snapshot.experimentalUnifiedPanel,
    });
    await chrome.storage.local.set({
      [AI_SETTINGS_STORAGE_KEYS.anthropicApiKey]: anthropicApiKey,
      [AI_SETTINGS_STORAGE_KEYS.openaiApiKey]: openaiApiKey,
      debugMode: __INTERNAL_TOOLS__ && snapshot.debugMode,
      [PAGE_DOCK_ENABLED_KEY]: snapshot.pageDockEnabled,
      [CHAT_ACTIONS_USE_SIDE_PANEL_KEY]: snapshot.chatActionsUseSidePanel,
      [PAGE_DOCK_VISIBILITY_MODE_KEY]: snapshot.pageDockVisibilityMode,
      [PAGE_DOCK_ALLOWED_DOMAINS_KEY]: readPageDockAllowedDomains(snapshot.pageDockAllowedDomains),
      [PAGE_DOCK_DISABLED_HOSTS_KEY]: readPageDockDisabledHosts(snapshot.pageDockDisabledHosts),
      [SELECTION_TRIGGER_ENABLED_KEY]: snapshot.selectionTriggerEnabled,
      [SELECTION_TRIGGER_VISIBILITY_MODE_KEY]: snapshot.selectionTriggerVisibilityMode,
      [SELECTION_TRIGGER_ALLOWED_DOMAINS_KEY]: readSelectionTriggerAllowedDomains(
        snapshot.selectionTriggerAllowedDomains
      ),
      [SELECTION_TRIGGER_DISABLED_HOSTS_KEY]: readSelectionTriggerDisabledHosts(
        snapshot.selectionTriggerDisabledHosts
      ),
      [SELECTION_TRIGGER_STYLE_KEY]: snapshot.selectionTriggerStyle,
      [SELECTION_TRIGGER_DOMAIN_STYLES_KEY]: readSelectionTriggerDomainStyles(
        snapshot.selectionTriggerDomainStyles
      ),
      [APP_ACCESS_MODE_STORAGE_KEY]: snapshot.appAccessMode,
    });
  }, []);

  // Skip the first run after hydration: that change is the loaded values, not a
  // user edit, so there is nothing to save.
  const skipNextAutoSave = useRef(true);
  const previousApiKeys = useRef<{ anthropic: string; openai: string } | null>(null);
  const apiKeyTestRun = useRef(0);

  useEffect(() => {
    if (!hydrated) return;
    if (skipNextAutoSave.current) {
      skipNextAutoSave.current = false;
      return;
    }
    // Acknowledge the change immediately so the floating indicator reacts as
    // the user works, then confirm once the debounced write lands.
    showStatus("Saving…");
    const timer = setTimeout(() => {
      persistSettings(settings)
        .then(() => showStatus("Saved", false, true))
        .catch((error) => showStatus(formatError(error), true));
    }, AUTOSAVE_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [settings, hydrated, persistSettings, showStatus]);

  useEffect(() => {
    if (!hydrated) return;
    if (settings.appAccessMode !== "local_byok") {
      apiKeyTestRun.current += 1;
      return;
    }

    const currentKeys = {
      anthropic: settings.anthropicApiKey.trim(),
      openai: settings.openaiApiKey.trim(),
    };
    const previousKeys = previousApiKeys.current;
    previousApiKeys.current = currentKeys;
    if (!previousKeys) return;

    const changedProviders: ModelProvider[] = [];
    if (previousKeys.anthropic !== currentKeys.anthropic) changedProviders.push("anthropic");
    if (previousKeys.openai !== currentKeys.openai) changedProviders.push("openai");
    if (changedProviders.length === 0) return;

    const runId = ++apiKeyTestRun.current;
    const providersToTest = changedProviders.filter((provider) =>
      apiKeyForProvider(currentKeys, provider)
    );
    if (providersToTest.length === 0) return;

    const timer = setTimeout(() => {
      const label =
        providersToTest.length === 1
          ? `${providerLabel(providersToTest[0])} key`
          : "API keys";
      showStatus(`Testing ${label}…`);

      Promise.all(
        providersToTest.map(async (provider) => {
          const valid = await testProviderApiKey(
            provider,
            apiKeyForProvider(currentKeys, provider),
            settings.selectedModelsByProvider[provider].chat
          );
          return { provider, valid };
        })
      )
        .then((results) => {
          if (runId !== apiKeyTestRun.current) return;
          const rejected = results.find((result) => !result.valid);
          if (rejected) {
            showStatus(`${providerLabel(rejected.provider)} key was rejected`, true);
            return;
          }
          showStatus(
            providersToTest.length === 1 ? `${label} accepted` : "API keys accepted",
            false,
            true
          );
        })
        .catch((error) => {
          if (runId !== apiKeyTestRun.current) return;
          showStatus(formatError(error), true);
        });
    }, API_KEY_TEST_DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [
    settings.appAccessMode,
    settings.anthropicApiKey,
    settings.openaiApiKey,
    settings.selectedModelsByProvider,
    hydrated,
    showStatus,
  ]);

  // "Saved" is a transient confirmation — clear it after a moment so the
  // indicator fades out. Errors and in-progress states stay until superseded.
  useEffect(() => {
    if (status.message !== "Saved") return;
    // Keep the success class while opacity transitions out; otherwise the dot
    // snaps back to the default accent color during the fade.
    const timer = setTimeout(
      () => setStatus({ message: "", isError: false, isSuccess: true }),
      1800
    );
    return () => clearTimeout(timer);
  }, [status]);

  return {
    settings,
    status,
    modelsForProvider,
    activeModels: settings.selectedModelsByProvider[settings.provider],
    updateSetting,
    setProvider,
    setModel,
    setTheme,
    showStatus,
  };
}

function apiKeyForProvider(
  keys: { anthropic: string; openai: string },
  provider: ModelProvider
): string {
  return provider === "openai" ? keys.openai : keys.anthropic;
}

function providerLabel(provider: ModelProvider): string {
  return provider === "openai" ? "OpenAI" : "Anthropic";
}

async function testProviderApiKey(
  provider: ModelProvider,
  apiKey: string,
  model: string
): Promise<boolean> {
  const result = await sendRuntimeMessage<{ valid?: boolean }>({
    action: "testApiKey",
    apiKey,
    provider,
    model,
  });
  return result.valid === true;
}

function settingsFromStorage(
  value: unknown,
  localValue: Record<string, unknown>
): Omit<OptionsSettingsState, "theme"> {
  const result = StorageSettingsSchema.safeParse(value);
  const stored = result.success ? result.data : {};
  const storageRecord = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const provider = readModelProvider(storageRecord);
  const pageDockSettings = parsePageDockSettings(localValue);
  const selectionTriggerSettings = parseSelectionTriggerSettings(localValue);

  return {
    appAccessMode: parseAppAccessMode(localValue[APP_ACCESS_MODE_STORAGE_KEY]),
    provider,
    anthropicApiKey: readProviderApiKey(storageRecord, "anthropic") ?? "",
    openaiApiKey: readProviderApiKey(storageRecord, "openai") ?? "",
    selectedModelsByProvider: {
      anthropic: {
        chat: validateModelForProvider(
          readProviderChatModel(storageRecord, "anthropic"),
          "anthropic",
          DEFAULT_ANTHROPIC_CHAT_MODEL
        ),
        execution: validateModelForProvider(
          readProviderExecutionModel(storageRecord, "anthropic"),
          "anthropic",
          DEFAULT_ANTHROPIC_EXECUTION_MODEL
        ),
      },
      openai: {
        chat: validateModelForProvider(
          readProviderChatModel(storageRecord, "openai"),
          "openai",
          DEFAULT_OPENAI_CHAT_MODEL
        ),
        execution: validateModelForProvider(
          readProviderExecutionModel(storageRecord, "openai"),
          "openai",
          DEFAULT_OPENAI_EXECUTION_MODEL
        ),
      },
    },
    debugMode:
      __INTERNAL_TOOLS__ &&
      (typeof localValue.debugMode === "boolean"
        ? localValue.debugMode
        : stored.debugMode === true),
    experimentalUnifiedPanel: stored.experimentalUnifiedPanel === true,
    pageDockEnabled: pageDockSettings.enabled,
    chatActionsUseSidePanel: localValue[CHAT_ACTIONS_USE_SIDE_PANEL_KEY] === true,
    pageDockVisibilityMode: pageDockSettings.visibilityMode,
    pageDockAllowedDomains: pageDockSettings.allowedDomains,
    pageDockDisabledHosts: pageDockSettings.disabledHosts,
    selectionTriggerEnabled: selectionTriggerSettings.enabled,
    selectionTriggerVisibilityMode: selectionTriggerSettings.visibilityMode,
    selectionTriggerAllowedDomains: selectionTriggerSettings.allowedDomains,
    selectionTriggerDisabledHosts: selectionTriggerSettings.disabledHosts,
    selectionTriggerStyle: selectionTriggerSettings.style,
    selectionTriggerDomainStyles: selectionTriggerSettings.domainStyles,
  };
}

function sendRuntimeMessage<T>(message: unknown): Promise<T> {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response) => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(new Error(error.message));
        return;
      }
      resolve(response as T);
    });
  });
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
