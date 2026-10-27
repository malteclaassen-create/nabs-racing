import EmojiPicker, { EmojiStyle, SuggestionMode, Theme } from "emoji-picker-react";
import { useTheme } from "../hooks/useTheme.js";

// ---------------------------------------------------------------------------
// The full emoji picker (emoji-picker-react), configured once: the phone's own
// emoji rather than pictures from a CDN, the site's theme, search, recently
// used first. A row of `quick` sits above it for the usual ones, one tap
// each. Loaded only when somebody opens it (NewsReactions.jsx imports it
// lazily): the emoji table is most of its weight.
// ---------------------------------------------------------------------------

export default function EmojiPickerPanel({ quick = [], onPick }) {
  const { theme } = useTheme();
  const pick = (data) => onPick(data.emoji);
  return (
    <div>
      {quick.length > 0 && (
        <div className="mb-3 grid grid-cols-8 gap-1">
          {quick.map((emoji) => (
            <button
              key={emoji}
              type="button"
              onClick={() => onPick(emoji)}
              aria-label={`React with ${emoji}`}
              className="flex aspect-square items-center justify-center rounded-lg text-2xl transition hover:scale-110 hover:bg-surface2"
            >
              {emoji}
            </button>
          ))}
        </div>
      )}
      <EmojiPicker
        onEmojiClick={pick}
        emojiStyle={EmojiStyle.NATIVE}
        theme={theme === "dark" ? Theme.DARK : Theme.LIGHT}
        suggestedEmojisMode={SuggestionMode.RECENT}
        searchPlaceholder="Search emoji"
        previewConfig={{ showPreview: false }}
        lazyLoadEmojis
        width="100%"
        height={340}
        // In the site's own colours rather than the picker's grey box: these
        // win over its theme's values, which it sets on the same element.
        style={{
          "--epr-bg-color": "var(--c-card)",
          "--epr-category-label-bg-color": "var(--c-card)",
          "--epr-picker-border-color": "transparent",
          "--epr-search-input-bg-color": "var(--c-surface2)",
          "--epr-search-input-bg-color-active": "var(--c-surface2)",
          "--epr-search-border-color": "var(--c-border)",
          "--epr-hover-bg-color": "var(--c-surface2)",
          "--epr-focus-bg-color": "var(--c-surface2)",
          "--epr-horizontal-padding": "2px",
        }}
      />
    </div>
  );
}
