import { useEffect, useRef } from "react";

const escapeStack = [];

const handleDocumentKeyDown = (e) => {
  if (e.key !== "Escape") return;
  const top = escapeStack[escapeStack.length - 1];
  if (!top) return;
  top.fire();
};

export default function useEscapeKey(isOpen, onEscape) {
  const callbackRef = useRef(onEscape);

  useEffect(() => {
    callbackRef.current = onEscape;
  });

  useEffect(() => {
    if (!isOpen) return;
    const entry = { fire: () => callbackRef.current?.() };
    if (escapeStack.length === 0) {
      document.addEventListener("keydown", handleDocumentKeyDown);
    }
    escapeStack.push(entry);
    return () => {
      const index = escapeStack.indexOf(entry);
      if (index !== -1) escapeStack.splice(index, 1);
      if (escapeStack.length === 0) {
        document.removeEventListener("keydown", handleDocumentKeyDown);
      }
    };
  }, [isOpen]);
}
