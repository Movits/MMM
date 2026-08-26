/**
 * PageTransition — Fade Out (escurecer para preto) + Fade In (clarear do preto)
 * Envolve toda a aplicação e dispara a transição a cada mudança de rota.
 */
import { useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";

export function PageTransition({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const [phase, setPhase] = useState<"idle" | "out" | "in">("idle");
  const [displayLocation, setDisplayLocation] = useState(location);
  const overlayRef = useRef<HTMLDivElement>(null);
  const prevLocation = useRef(location);

  useEffect(() => {
    if (location === prevLocation.current) return;

    // Start fade-out
    setPhase("out");

    const outTimer = setTimeout(() => {
      // At peak black, swap content
      setDisplayLocation(location);
      prevLocation.current = location;
      setPhase("in");

      const inTimer = setTimeout(() => {
        setPhase("idle");
      }, 350); // fade-in duration

      return () => clearTimeout(inTimer);
    }, 280); // fade-out duration

    return () => clearTimeout(outTimer);
  }, [location]);

  const overlayOpacity =
    phase === "out" ? 1 :
    phase === "in" ? 0 :
    0;

  const overlayTransition =
    phase === "out"
      ? "opacity 280ms cubic-bezier(0.77,0,0.175,1)"
      : phase === "in"
      ? "opacity 350ms cubic-bezier(0.23,1,0.32,1)"
      : "none";

  return (
    <>
      {/* Black overlay */}
      <div
        ref={overlayRef}
        aria-hidden="true"
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 9999,
          background: "#000",
          opacity: overlayOpacity,
          transition: overlayTransition,
          pointerEvents: phase !== "idle" ? "all" : "none",
        }}
      />
      {children}
    </>
  );
}
