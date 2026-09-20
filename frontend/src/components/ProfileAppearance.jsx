import catalog from "../../../shared/profileCosmetics.json";
import { useLayoutEffect } from "react";
import { createPortal } from "react-dom";
import ProfileEffect from "./ProfileEffect.jsx";
import { profileNameProps } from "./DriverName.jsx";
import { EMPTY_APPEARANCE, EMPTY_PROFILE_CONTENT } from "../../../shared/profileCustomization.mjs";
import { DriverAvatar } from "./ui.jsx";
import { useTheme } from "../hooks/useTheme.js";
import "./profileAppearance.css";

export { EMPTY_APPEARANCE, EMPTY_PROFILE_CONTENT };
export { catalog as PROFILE_COSMETICS };
export const cosmeticFinish = id => catalog.find(item => item.id === id)?.finish || "default";
const cosmeticTone = id => catalog.find(item => item.id === id)?.tone;
const bounded = (value, fallback, min, max) => typeof value === "number" && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;

function accentStyle(value, tone) {
  if (!/^#[\da-f]{6}$/i.test(value || "")) return {};
  let channels = value.slice(1).match(/../g).map(channel => parseInt(channel, 16));
  const luminance = rgb => rgb.map(channel => channel / 255).map(channel => channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4).reduce((sum, channel, index) => sum + channel * [.2126, .7152, .0722][index], 0);
  // The strongest card surfaces in each palette set a conservative contrast floor.
  const surface = luminance(tone === "light" ? [233, 223, 201] : [40, 48, 66]);
  for (let step = 0; step < 24; step++) {
    const ink = luminance(channels);
    if ((Math.max(surface, ink) + .05) / (Math.min(surface, ink) + .05) >= 4.5) break;
    channels = channels.map(channel => Math.round(channel * .86 + (tone === "light" ? 0 : 255) * .14));
  }
  const rgb = channels.join(" ");
  return { "--c-accent": rgb, "--c-link": rgb, "--c-eyebrow": `rgb(${rgb})` };
}

export function useProfilePageTheme(theme, enabled = true, content = EMPTY_PROFILE_CONTENT, teamColour = null) {
  const finish = cosmeticFinish(theme);
  // The team theme mixes every surface from --profile-team, which the wrapper
  // sets inline but the document root does not, and it takes the team colour as
  // its accent unless the member picked one.
  const accent = content?.accentColor || (finish === "team" ? teamColour : null);
  const backgroundImage = content?.backgroundImage;
  const backgroundStrength = content?.backgroundStrength;
  const backgroundPositionX = content?.backgroundPositionX;
  const backgroundPositionY = content?.backgroundPositionY;
  const backgroundFit = content?.backgroundFit;
  const backgroundScroll = content?.backgroundScroll;
  const { theme: viewerTheme } = useTheme();
  const tone = cosmeticTone(theme) || viewerTheme;
  useLayoutEffect(() => {
    if (!enabled) return;
    const root = document.documentElement;
    const previous = root.getAttribute("data-profile-theme");
    const previousTone = root.getAttribute("data-profile-tone");
    const previousBackground = root.getAttribute("data-profile-background");
    // Only a picture this site holds, so a saved profile cannot pull an image
    // (and a visitor's address) from somewhere else. blob: is the studio preview.
    const hasBackground = /^(blob:|\/api\/uploads\/profile-studio\/)/.test(backgroundImage || "");
    const overrides = {
      ...(finish === "team" && teamColour ? { "--profile-team": teamColour } : {}),
      ...accentStyle(accent, tone),
      "--profile-background-image": hasBackground ? `url(${JSON.stringify(backgroundImage)})` : "none",
      "--profile-background-strength": bounded(backgroundStrength, 65, 0, 100) / 100,
      "--profile-background-position": `${bounded(backgroundPositionX, 50, 0, 100)}% ${bounded(backgroundPositionY, 50, 0, 100)}%`,
      "--profile-background-fit": backgroundFit === "contain" ? "contain" : "cover",
      "--profile-background-attachment": backgroundScroll === "scroll" ? "absolute" : "fixed",
    };
    const previousStyles = Object.keys(overrides).map(key => [key, root.style.getPropertyValue(key), root.style.getPropertyPriority(key)]);
    root.setAttribute("data-profile-theme", finish);
    root.setAttribute("data-profile-tone", tone);
    if (hasBackground) root.setAttribute("data-profile-background", "image");
    else root.removeAttribute("data-profile-background");
    Object.entries(overrides).forEach(([key, value]) => root.style.setProperty(key, value));
    return () => {
      if (previous === null) root.removeAttribute("data-profile-theme");
      else root.setAttribute("data-profile-theme", previous);
      if (previousTone === null) root.removeAttribute("data-profile-tone");
      else root.setAttribute("data-profile-tone", previousTone);
      if (previousBackground === null) root.removeAttribute("data-profile-background");
      else root.setAttribute("data-profile-background", previousBackground);
      previousStyles.forEach(([key, value, priority]) => value ? root.style.setProperty(key, value, priority) : root.style.removeProperty(key));
    };
  }, [theme, enabled, accent, tone, finish, teamColour, backgroundImage, backgroundStrength, backgroundPositionX, backgroundPositionY, backgroundFit, backgroundScroll]);
}

export function ProfileBanner({ driver, appearance = EMPTY_APPEARANCE, compact = false, backgroundOnly = false }) {
  const content = driver.profileContent || EMPTY_PROFILE_CONTENT;
  return <div className={`profile-banner ${compact ? "profile-banner--compact" : ""} ${backgroundOnly ? "profile-header-banner" : ""}`} style={{ "--profile-team": driver.team?.color || "#638daf" }} data-finish={cosmeticFinish(appearance.banner)} aria-hidden={backgroundOnly || undefined}>
    {content.bannerImage && <img className="profile-banner-photo" src={content.bannerImage} alt="" style={{ objectPosition: `50% ${content.bannerPosition}%` }} />}
    <div className="profile-banner-lines" aria-hidden="true" />
    {!backgroundOnly && <div className="profile-banner-identity">
      <DriverAvatar name={driver.name} photoUrl={driver.photoUrl} size={compact ? 52 : 76} />
      <div><span className="profile-banner-label">NABS RACING</span><strong>{driver.name}</strong></div>
    </div>}
  </div>;
}

export default function ProfileAppearance({ driver, appearance = driver.appearance || EMPTY_APPEARANCE, children, className = "" }) {
  const decorated = Object.values(appearance).some(Boolean);
  const effect = cosmeticFinish(appearance.effect);
  const { theme: viewerTheme } = useTheme();
  const tone = cosmeticTone(appearance.theme) || viewerTheme;
  const content = driver.profileContent || EMPTY_PROFILE_CONTENT;
  const effectScale = bounded(content.effectStrength, 50, 0, 100) / 50;
  const motion = content.motion !== false;
  const nameProps = profileNameProps(content, appearance.nameplate, driver.team?.color);
  const style = {
    ...nameProps.style,
    "--profile-team": driver.team?.color || "#638daf",
    "--profile-banner-opacity": bounded(content.bannerStrength, 60, 0, 100) / (tone === "light" ? 300 : 100),
    "--profile-effect-scale": effectScale,
    "--profile-name-scale": bounded(content.nameScale, 100, 80, 120) / 100,
    ...accentStyle(content.accentColor || (cosmeticFinish(appearance.theme) === "team" ? driver.team?.color : null), tone),
  };
  return <div {...nameProps} className={`profile-appearance ${decorated ? "profile-appearance--custom" : ""} ${className}`} style={style} data-theme={cosmeticFinish(appearance.theme)} data-theme-tone={tone} data-stats={cosmeticFinish(appearance.stats)} data-effect={effect} data-opaque-panels={effect !== "default" && content.lavaOpaquePanels !== false} data-panel-shape={content.panelShape || "theme"} data-density={content.density || "comfortable"} data-motion={motion}>
    {driver.id && effect !== "default" && effectScale > 0 && createPortal(<ProfileEffect key={appearance.effect} className="profile-page-effect" strength={effectScale} finish={effect} theme={cosmeticFinish(appearance.theme)} tone={tone} motion={motion} lightningColor={content.lightningColor} lavaAmount={content.lavaAmount} lavaColor={content.lavaColor} opaquePanels={content.lavaOpaquePanels} teamColor={driver.team?.color} />, document.body)}
    <div className="profile-appearance-content">{children}</div>
  </div>;
}
