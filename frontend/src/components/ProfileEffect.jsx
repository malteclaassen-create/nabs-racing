import { useId, useLayoutEffect, useState } from "react";
import "./profileEffects.css";

import { makeStrike } from "./profileLightning.mjs";
import ProfileLava from "./ProfileLava.jsx";
import ProfileFireworks from "./ProfileFireworks.jsx";
import ProfileAtmosphere from "./ProfileAtmosphere.jsx";
import ProfileAmbientEffects from "./ProfileAmbientEffects.jsx";

function LightningStrike({ index, width, height, seed = 7919 + index * 104729 }) {
  const cycle = 13.7 + (index * 2.39) % 9;
  const [strike, setStrike] = useState(() => makeStrike(seed, width, height));
  const refresh = () => setStrike(makeStrike(Math.floor(Math.random() * 4294967296), width, height));
  return <g onAnimationIteration={event => { if (event.target === event.currentTarget) refresh(); }} className="fx-bolt-strike" data-variant={index < 2 ? 0 : index} style={{ "--strike-delay": `${-1 - index * 1.83}s`, "--strike-cycle": `${cycle}s` }}>
    {["aura", "glow", "core"].map(layer => <g key={layer} className={`fx-bolt-${layer}`}>
      {strike.map(({ d, start, span, type }, i) => <path key={i} d={d} pathLength="1" className={`fx-bolt-channel fx-bolt-channel--${type}`} style={{ "--path-start": start, "--path-span": span }} />)}
    </g>)}
  </g>;
}

function Lightning({ width = 1000, height = 700, compact = false }) {
  const count = compact ? 2 : Math.min(24, Math.max(10, Math.ceil(height / 850) * 4));
  return <svg className="premium-fx-art fx-bolt" viewBox={`0 0 ${width} ${height}`} fill="none" preserveAspectRatio="none">
    {Array.from({ length: count }, (_, index) => <LightningStrike key={`${width}-${height}-${index}`} index={index} width={width} height={height} seed={compact ? [791900, 1496691][index] : undefined} />)}
  </svg>;
}

function useEffectPageSize(enabled) {
  const [size, setSize] = useState(null);
  useLayoutEffect(() => {
    if (!enabled) return;
    const root = document.getElementById("root");
    if (!root) return;
    const measure = () => {
      const rect = root.getBoundingClientRect();
      const width = document.documentElement.clientWidth;
      // Measure app content, never the portal itself: this also allows the
      // decoration to shrink when a profile section is collapsed or removed.
      const height = Math.ceil(Math.max(window.innerHeight, rect.bottom + window.scrollY, rect.top + window.scrollY + root.scrollHeight));
      setSize(previous => previous?.width === width && previous?.height === height ? previous : { width, height });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(root);
    window.addEventListener("resize", measure);
    return () => { observer.disconnect(); window.removeEventListener("resize", measure); };
  }, [enabled]);
  return size;
}

/** Shared by catalogue swatches and the page portal; no timers or canvas loop. */
export default function ProfileEffect({ finish, className = "", strength = 1, tone = "dark", motion = true, theme, lightningColor = "default", lavaAmount = 50, lavaColor = "default", opaquePanels = true, teamColor }) {
  const id = `profile-fx-${useId().replace(/:/g, "")}`;
  const pageEffect = className.split(/\s+/).includes("profile-page-effect");
  const pageAnchored = pageEffect && ["lightning", "lava", "fireworks", "meteors", "embers", "rain", "prism", "orbits", "bubbles"].includes(finish);
  const pageLightning = finish === "lightning" && pageEffect;
  const pageSize = useEffectPageSize(pageAnchored);
  const premium = ["lightning", "lava", "fireworks", "meteors", "embers", "rain", "prism", "orbits", "bubbles"].includes(finish);
  const useTeamColor = lightningColor === "team" && /^#(?:[\da-f]{3}|[\da-f]{6})$/i.test(teamColor || "");
  return <div className={`profile-surface-effect ${premium ? "premium-fx" : ""} ${className}`} data-finish={finish} data-opaque-panels={opaquePanels === true} data-theme={theme} data-theme-tone={tone} data-motion={motion} data-lightning-color={useTeamColor ? "team" : "default"} style={{ "--profile-effect-scale": strength, ...(useTeamColor ? { "--profile-lightning-team": teamColor } : {}), ...(pageAnchored && pageSize ? { "--profile-effect-height": `${pageSize.height}px` } : {}) }} aria-hidden="true">
    {finish === "lightning" && (!pageLightning || pageSize) && <Lightning {...(pageLightning ? pageSize : { width: 320, height: 140, compact: true })} />}
    {finish === "lava" && <ProfileLava id={id} compact={!pageEffect} amount={lavaAmount} color={lavaColor} teamColor={teamColor} />}
    {finish === "fireworks" && <ProfileFireworks />}
    {finish === "meteors" && (!pageEffect || pageSize) && <ProfileAtmosphere id={id} {...(pageEffect ? pageSize : {})} />}
    {["embers", "rain", "prism", "orbits", "bubbles"].includes(finish) && (!pageEffect || pageSize) && <ProfileAmbientEffects finish={finish} id={id} {...(pageEffect ? pageSize : {})} />}
  </div>;
}
