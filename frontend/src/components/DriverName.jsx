import catalog from "../../../shared/profileCosmetics.json";
import "./profileName.css";

// Both the full profile and compact standings use these attributes and CSS.
export function profileNameProps(content = {}, nameplate, teamColor) {
  const color = /^#[\da-f]{6}$/i.test(content.nameColor || "") ? content.nameColor : null;
  return {
    "data-nameplate": catalog.find(item => item.id === nameplate && item.slot === "nameplate")?.finish || "default",
    "data-name-case": content.nameCase || "theme",
    "data-name-color": color ? "custom" : "default",
    style: {
      "--profile-team": teamColor || "#638daf",
      "--profile-name-color": color || undefined,
      "--profile-name-plate": /^#[\da-f]{6}$/i.test(content.namePlateColor || "") ? content.namePlateColor : undefined,
      "--profile-name-scale": Number.isFinite(content.nameScale) ? Math.min(120, Math.max(80, content.nameScale)) / 100 : 1,
    },
  };
}

export default function DriverName({ driver, className = "" }) {
  if (!driver.nameStyle) return <span className={className}>{driver.name}</span>;
  return <span className={`driver-name-style ${className}`} {...profileNameProps(driver.nameStyle, driver.nameStyle.nameplate, driver.team?.color)}>
    <span className="profile-driver-name">{driver.name}</span>
  </span>;
}
