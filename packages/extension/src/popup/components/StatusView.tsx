export function StatusView({
  status,
}: {
  status: { visible: boolean; isError: boolean; message: string };
}) {
  return (
    <section
      id="status"
      className={`status ${status.visible ? "" : "hidden"} ${status.isError ? "error" : ""}`}
    >
      <div className="spinner"></div>
      <span id="status-text">{status.message}</span>
    </section>
  );
}
