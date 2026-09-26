"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";

/* Minimal typings for the (prefixed) Web Speech API. */
type SpeechResult = { isFinal: boolean; 0: { transcript: string } };
type SpeechEvent = { resultIndex: number; results: ArrayLike<SpeechResult> };
type Recognition = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((e: SpeechEvent) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
};
type RecognitionCtor = new () => Recognition;

function getCtor(): RecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

const subscribeNoop = () => () => {};

/**
 * Voice dictation via the Web Speech API. `onUpdate(final, interim)` receives the text dictated
 * since `start()`; callers append it to what was typed before. Unsupported browsers get
 * `supported: false` (the mic button is disabled with a hint).
 */
export function useSpeechDictation(opts: { lang?: string; onUpdate: (finalText: string, interim: string) => void }) {
  const supported = useSyncExternalStore(subscribeNoop, () => getCtor() !== null, () => false);
  const [listening, setListening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const recRef = useRef<Recognition | null>(null);
  const finalRef = useRef("");
  const onUpdate = useRef(opts.onUpdate);
  useEffect(() => {
    onUpdate.current = opts.onUpdate;
  });

  const stop = useCallback(() => {
    recRef.current?.stop();
  }, []);

  const start = useCallback(() => {
    const Ctor = getCtor();
    if (!Ctor) return;
    recRef.current?.abort();
    const rec = new Ctor();
    rec.lang = opts.lang || navigator.language || "en-US";
    rec.continuous = true;
    rec.interimResults = true;
    finalRef.current = "";
    rec.onresult = (e) => {
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i]!;
        if (r.isFinal) finalRef.current += r[0].transcript;
        else interim += r[0].transcript;
      }
      onUpdate.current(finalRef.current, interim);
    };
    rec.onerror = (e) => {
      setError(e.error === "not-allowed" || e.error === "service-not-allowed" ? "Microphone access was blocked." : e.error === "no-speech" ? null : "Voice input stopped.");
    };
    rec.onend = () => {
      setListening(false);
      onUpdate.current(finalRef.current, "");
      recRef.current = null;
    };
    recRef.current = rec;
    setError(null);
    try {
      rec.start();
      setListening(true);
    } catch {
      setError("Voice input could not start.");
    }
  }, [opts.lang]);

  useEffect(() => () => recRef.current?.abort(), []);

  return { supported, listening, error, start, stop };
}
