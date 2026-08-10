export default function Toast({ toast }) {
  if (!toast) return null;
  return (
    <div className={`app-toast app-toast-${toast.tone || "success"}`} role="status" aria-live="polite">
      {toast.tone === "pending" && <span className="app-toast-spinner" aria-hidden="true" />}
      {toast.message}
    </div>
  );
}
