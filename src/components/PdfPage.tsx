import { useEffect, useRef, useState } from "react";
import { pdfjs, pageGeometry, renderedTextLines } from "../pdf";
import { focusWindows, clamp } from "../geometry.mjs";
import type { Highlight, Line, Rect, SelectionInfo } from "../types";
type Props = {
  pdf: pdfjs.PDFDocumentProxy;
  page: number;
  width: number;
  line: number;
  count: number;
  focus: boolean;
  dim: number;
  preserve: boolean;
  highlights: Highlight[];
  regions: Rect[];
  regionMode: boolean;
  search: string;
  onLines: (lines: Line[]) => void;
  onSelect: (s: SelectionInfo | null) => void;
  onLine: (index: number) => void;
  onRegion: (r: Rect) => void;
  onHighlight: (h: Highlight) => void;
  onError: (s: string) => void;
};
export function PdfPage(props: Props) {
  const { pdf, page, width } = props,
    canvasRef = useRef<HTMLCanvasElement>(null),
    textRef = useRef<HTMLDivElement>(null),
    rootRef = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState(width * 1.294),
    [lines, setLines] = useState<Line[]>([]),
    [figures, setFigures] = useState<Rect[]>([]),
    [loading, setLoading] = useState(true),
    [drag, setDrag] = useState<Rect | null>(null),
    [renderError, setRenderError] = useState("");
  const dragStart = useRef<{ x: number; y: number } | null>(null),
    focusRef = useRef<SVGRectElement>(null),
    maskId = `mask-${pdf.fingerprints[0]}-${page}`;
  const callbacks = useRef(props);
  callbacks.current = props;
  useEffect(() => {
    let cancelled = false,
      renderTask: pdfjs.RenderTask | undefined,
      textLayer: pdfjs.TextLayer | undefined;
    setLoading(true);
    setRenderError("");
    setLines([]);
    setFigures([]);
    callbacks.current.onLines([]);
    callbacks.current.onSelect(null);
    (async () => {
      try {
        const proxy = await pdf.getPage(page);
        if (cancelled) return;
        const unit = proxy.getViewport({ scale: 1 }),
          viewport = proxy.getViewport({ scale: width / unit.width });
        setHeight(viewport.height);
        const canvas = canvasRef.current!,
          ratio = Math.min(window.devicePixelRatio || 1, 2);
        canvas.width = Math.floor(viewport.width * ratio);
        canvas.height = Math.floor(viewport.height * ratio);
        const geometryPromise = pageGeometry(proxy, viewport);
        renderTask = proxy.render({
          canvasContext: canvas.getContext("2d")!,
          canvas,
          viewport,
          transform: ratio === 1 ? undefined : [ratio, 0, 0, ratio, 0, 0],
        });
        await renderTask.promise;
        if (cancelled) return;
        const layer = textRef.current!;
        layer.innerHTML = "";
        layer.style.setProperty("--scale-factor", String(viewport.scale));
        layer.style.setProperty("--total-scale-factor", String(viewport.scale));
        textLayer = new pdfjs.TextLayer({
          textContentSource: await proxy.getTextContent(),
          container: layer,
          viewport,
        });
        await textLayer.render();
        if (cancelled) return;
        const geometry = await geometryPromise;
        const visualLines = await renderedTextLines(
          proxy,
          viewport,
          textLayer,
          layer,
        );
        if (cancelled) return;
        setLines(visualLines);
        setFigures(geometry.figures);
        callbacks.current.onLines(visualLines);
        setLoading(false);
      } catch (error) {
        if (cancelled || String(error).includes("RenderingCancelled")) return;
        const message =
          error instanceof Error ? error.message : "无法渲染这一页";
        setRenderError(message);
        setLoading(false);
        callbacks.current.onError(message);
      }
    })();
    return () => {
      cancelled = true;
      renderTask?.cancel();
      textLayer?.cancel();
    };
  }, [pdf, page, width]);
  useEffect(() => {
    if (props.focus && lines.length)
      focusRef.current?.scrollIntoView({
        block: "nearest",
        behavior: "smooth",
      });
  }, [props.line, props.focus, lines.length]);
  const select = () => {
    if (props.regionMode) return;
    window.setTimeout(() => {
      const selection = window.getSelection();
      if (
        !selection ||
        selection.isCollapsed ||
        !rootRef.current?.contains(selection.anchorNode) ||
        !rootRef.current?.contains(selection.focusNode)
      ) {
        props.onSelect(null);
        return;
      }
      const range = selection.getRangeAt(0),
        bounds = rootRef.current!.getBoundingClientRect();
      const rects = Array.from(range.getClientRects())
        .filter((r) => r.width > 0 && r.height > 0)
        .map((r) => ({
          x: clamp((r.left - bounds.left) / bounds.width, 0, 1),
          y: clamp((r.top - bounds.top) / bounds.height, 0, 1),
          w: clamp(r.width / bounds.width, 0, 1),
          h: clamp(r.height / bounds.height, 0, 1),
        }));
      if (!rects.length) return;
      const anchor = range.getBoundingClientRect();
      props.onSelect({
        text: selection.toString().trim().slice(0, 8000),
        rects,
        page,
        left: clamp(
          anchor.left + anchor.width / 2,
          150,
          window.innerWidth - 150,
        ),
        top: anchor.bottom + 8,
      });
    }, 0);
  };
  const point = (e: React.PointerEvent) => {
    const r = rootRef.current!.getBoundingClientRect();
    return {
      x: clamp((e.clientX - r.left) / r.width, 0, 1),
      y: clamp((e.clientY - r.top) / r.height, 0, 1),
    };
  };
  const windows = focusWindows(lines, props.line, props.count) as Rect[],
    protectedRegions = props.preserve ? [...figures, ...props.regions] : [];
  const searched = props.search.trim()
    ? lines.filter((l) =>
        l.text.toLowerCase().includes(props.search.toLowerCase()),
      )
    : [];
  return (
    <div
      ref={rootRef}
      className={`pdf-page ${props.regionMode ? "drawing" : ""}`}
      style={{ width, height }}
      onMouseUp={select}
      onKeyUp={select}
      onClick={(e) => {
        if (props.regionMode || window.getSelection()?.toString()) return;
        const r = e.currentTarget.getBoundingClientRect(),
          x = (e.clientX - r.left) / r.width,
          y = (e.clientY - r.top) / r.height;
        const nearest = lines
          .map((l, i) => ({
            i,
            d:
              Math.abs(l.y + l.h / 2 - y) +
              Math.max(0, l.x - x, x - l.x - l.w) * 2,
          }))
          .sort((a, b) => a.d - b.d)[0];
        if (nearest) props.onLine(nearest.i);
      }}
    >
      <canvas
        ref={canvasRef}
        className="pdf-canvas"
        aria-label={`PDF 第 ${page} 页`}
      />
      <div className="highlight-layer" aria-hidden="true">
        {props.highlights
          .filter((h) => h.page === page)
          .flatMap((h) =>
            h.rects.map((r, i) => (
              <span
                key={h.id + i}
                style={{
                  left: r.x * 100 + "%",
                  top: r.y * 100 + "%",
                  width: r.w * 100 + "%",
                  height: r.h * 100 + "%",
                  background: h.color,
                }}
              />
            )),
          )}
        {searched.map((r, i) => (
          <span
            key={"s" + i}
            style={{
              left: r.x * 100 + "%",
              top: r.y * 100 + "%",
              width: r.w * 100 + "%",
              height: r.h * 100 + "%",
              background: "#f5a84688",
            }}
          />
        ))}
      </div>
      <div ref={textRef} className="textLayer" onDoubleClick={select} />
      {props.focus && !loading && (
        <svg
          className="focus-mask"
          viewBox="0 0 1000 1000"
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          <defs>
            <mask id={maskId}>
              <rect width="1000" height="1000" fill="white" />
              {[...windows, ...protectedRegions].map((r, i) => (
                <rect
                  key={i}
                  x={r.x * 1000}
                  y={r.y * 1000}
                  width={r.w * 1000}
                  height={r.h * 1000}
                  rx="3"
                  fill="black"
                />
              ))}
            </mask>
          </defs>
          <rect
            width="1000"
            height="1000"
            fill="#071713"
            opacity={props.dim}
            mask={`url(#${maskId})`}
          />
          {windows.map((r, i) => (
            <rect
              ref={i === 0 ? focusRef : undefined}
              className="focus-outline"
              key={i}
              x={r.x * 1000}
              y={r.y * 1000}
              width={r.w * 1000}
              height={r.h * 1000}
              rx="3"
              fill="none"
              stroke="#54aa81"
              strokeWidth="1.8"
              vectorEffect="non-scaling-stroke"
            />
          ))}
        </svg>
      )}
      {props.regionMode && (
        <div
          className="region-canvas"
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId);
            dragStart.current = point(e);
          }}
          onPointerMove={(e) => {
            if (!dragStart.current) return;
            const p = point(e),
              s = dragStart.current;
            setDrag({
              x: Math.min(s.x, p.x),
              y: Math.min(s.y, p.y),
              w: Math.abs(s.x - p.x),
              h: Math.abs(s.y - p.y),
            });
          }}
          onPointerUp={(e) => {
            const start = dragStart.current;
            dragStart.current = null;
            if (!start) return;
            const p = point(e),
              r = {
                x: Math.min(start.x, p.x),
                y: Math.min(start.y, p.y),
                w: Math.abs(start.x - p.x),
                h: Math.abs(start.y - p.y),
              };
            if (r.w > 0.01 && r.h > 0.01) props.onRegion(r);
            setDrag(null);
          }}
          onPointerCancel={() => {
            dragStart.current = null;
            setDrag(null);
          }}
        >
          {props.regions.map((r, i) => (
            <div
              className="protected-box"
              key={i}
              style={{
                left: r.x * 100 + "%",
                top: r.y * 100 + "%",
                width: r.w * 100 + "%",
                height: r.h * 100 + "%",
              }}
            >
              图表 {i + 1}
            </div>
          ))}
          {drag && (
            <div
              className="protected-box draft"
              style={{
                left: drag.x * 100 + "%",
                top: drag.y * 100 + "%",
                width: drag.w * 100 + "%",
                height: drag.h * 100 + "%",
              }}
            />
          )}
        </div>
      )}
      {loading && (
        <div className="page-loading">
          <span className="spinner" />
          正在解析文字与图表…
        </div>
      )}
      {renderError && (
        <div className="page-loading error">此页渲染失败：{renderError}</div>
      )}
      {!loading && !lines.length && !renderError && (
        <div className="scan-warning">
          本页没有可提取文字，可能是扫描件。可使用图表保护框；逐行阅读需要带文本层的
          PDF。
        </div>
      )}
    </div>
  );
}
