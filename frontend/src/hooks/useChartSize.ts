import { useLayoutEffect, useRef, useState } from 'react';

/** Measure the plot viewport so SVG labels stay legible instead of scaling a fixed canvas. */
export function useChartSize() {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 720, height: 260 });
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    const update = () => {
      const width = Math.round(node.clientWidth),
        height = Math.round(node.clientHeight);
      if (!width || !height) return;
      setSize((previous) =>
        previous.width === width && previous.height === height ? previous : { width, height }
      );
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  return { ref, ...size };
}
