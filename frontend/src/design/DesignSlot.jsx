import { useEffect, useRef, useState } from "react";
import { DESIGN_ENABLED, useDesignPicks } from "./designPicks.js";

// Wraps one element of a page. When a variant is picked for it in the design
// picker, the element is swapped for that variant's mockup (an auto-sized
// frame of /_design/variants/<page>/<file>.html); otherwise the real element
// renders untouched.
//
//   <DesignSlot id="home/05-title-fight"> …real JSX… </DesignSlot>
//   <DesignSlot id="constructors/03-points-graph" insert />   // new element: only shows when picked
//
// `className` styles the frame's wrapper (e.g. to pin a bottom bar). Built
// sites never get here: DESIGN_ENABLED is false and the children render as is.
export default function DesignSlot({ id, insert = false, className = "", children = null }) {
  if (!DESIGN_ENABLED) return children;
  return (
    <Slot id={id} insert={insert} className={className}>
      {children}
    </Slot>
  );
}

function Slot({ id, insert, className, children }) {
  const { picks, off } = useDesignPicks();
  const pick = off ? null : picks[id];
  if (!pick) {
    if (insert) return <span data-design-slot={id} hidden />;
    return children;
  }
  const page = id.split("/")[0];
  const file = pick.file || `${id.split("/")[1]}-${pick.key}`;
  return (
    <div data-design-slot={id} className={className}>
      <MockFrame src={`/_design/variants/${page}/${file}.html`} title={`${id} · Variante ${pick.key}`} />
    </div>
  );
}

function MockFrame({ src, title }) {
  const ref = useRef(null);
  const [height, setHeight] = useState(240);
  useEffect(() => {
    const frame = ref.current;
    if (!frame) return undefined;
    let observer;
    const measure = () => {
      const doc = frame.contentDocument;
      if (!doc?.documentElement) return;
      setHeight(Math.max(doc.documentElement.scrollHeight, doc.body?.scrollHeight || 0));
    };
    const onLoad = () => {
      const doc = frame.contentDocument;
      if (!doc?.body) return;
      // The mockups are full pages with their own grey ground and padding;
      // inside the site only the element itself should show.
      const style = doc.createElement("style");
      style.textContent = "html,body{background:transparent!important;overflow:hidden}#mock{padding:0!important;max-width:none!important}";
      doc.head.appendChild(style);
      observer = new ResizeObserver(measure);
      observer.observe(doc.body);
      measure();
    };
    frame.addEventListener("load", onLoad);
    // A cached mockup can finish loading before this effect is attached.
    if (frame.contentDocument?.readyState === "complete" && frame.contentWindow?.location.pathname === src) onLoad();
    return () => {
      frame.removeEventListener("load", onLoad);
      observer?.disconnect();
    };
  }, [src]);
  return (
    <iframe
      ref={ref}
      key={src}
      src={src}
      title={title}
      scrolling="no"
      className="block w-full border-0"
      style={{ height, background: "transparent" }}
    />
  );
}
