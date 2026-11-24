// Short messages at the bottom of the screen ("Custo salvo.", errors in red), like the old notify().
import { useEffect, useState } from "react";

interface Toast { id: number; text: string; error: boolean }
let push: (t: Toast) => void = () => {};
let next = 0;

export function notify(text: string, error = false) {
  push({ id: next++, text, error });
}

export function Toasts() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  useEffect(() => {
    push = (t) => {
      setToasts((all) => [...all, t]);
      setTimeout(() => setToasts((all) => all.filter((x) => x.id !== t.id)), t.error ? 6000 : 3000);
    };
  }, []);
  return (
    <div id="toasts" role="status" aria-live="polite">
      {toasts.map((t) => <div key={t.id} className={"toast" + (t.error ? " error" : "")}>{t.text}</div>)}
    </div>
  );
}
