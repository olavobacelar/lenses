interface ApiKeyBannerProps {
  visible: boolean;
  onOpenSettings: () => void;
}

export function ApiKeyBanner({ visible, onOpenSettings }: ApiKeyBannerProps) {
  return (
    <section id="api-key-banner" className={`api-key-banner ${visible ? "" : "hidden"}`}>
      <div>
        <strong>API key required</strong>
        <span>Add a provider key to use chat, claims, and lens analysis.</span>
      </div>
      <button
        id="api-key-settings"
        className="api-key-settings"
        type="button"
        onClick={onOpenSettings}
      >
        API keys
      </button>
    </section>
  );
}

export function WarningBanner({ message }: { message: string }) {
  return (
    <section id="warning" className={`warning ${message ? "" : "hidden"}`}>
      {message}
    </section>
  );
}
