// Thin wrapper around pdf.js: statement PDF -> visual text lines for
// pdf-parsers.js. This is the only module that touches pdfjs-dist, and it's
// only ever loaded via dynamic import from UploadPanel when the user actually
// picks a .pdf — the library (and its worker) stay out of the budgetter
// chunk, and jest never has to parse pdf.js's ESM build.
//
// Like the CSV path, the raw file never leaves the browser: pdf.js runs
// entirely client-side and the extracted rows are all that's ever sent.

// Text items sharing a baseline within this many PDF units are one visual line.
const Y_TOLERANCE = 2.5;
// A horizontal gap bigger than this starts a new segment (a new table cell /
// column); smaller gaps are just word spacing within one run of text.
const SEGMENT_GAP = 15;

/** Group one page's text items into lines of x-sorted segments. */
export function linesFromItems(items) {
  const placed = items
    .filter((it) => it.str && it.str.trim())
    // Drop rotated text (transform [a,b,c,d] with b/c non-zero): banks print
    // vertical print-run IDs along the page margins, and at the wrong y one
    // of those can merge into a transaction row's date cell (seen on a real
    // TD statement). Table content is always axis-aligned.
    .filter((it) => Math.abs(it.transform[1]) < 0.01 && Math.abs(it.transform[2]) < 0.01)
    .map((it) => ({
      text: it.str,
      x: it.transform[4],
      y: it.transform[5],
      width: it.width || 0,
    }));

  // Cluster by baseline y (PDF origin is bottom-left, so top of page = high y).
  const rows = [];
  for (const item of placed.sort((a, b) => b.y - a.y || a.x - b.x)) {
    const row = rows.find((r) => Math.abs(r.y - item.y) <= Y_TOLERANCE);
    if (row) {
      row.items.push(item);
    } else {
      rows.push({ y: item.y, items: [item] });
    }
  }

  return rows.map((row) => {
    const segments = [];
    let current = null;
    for (const item of row.items.sort((a, b) => a.x - b.x)) {
      const gap = current ? item.x - (current.x + current.width) : Infinity;
      if (current && gap <= SEGMENT_GAP) {
        current.text += (gap > 0.5 ? " " : "") + item.text;
        current.width = item.x + item.width - current.x;
      } else {
        current = { x: item.x, width: item.width, text: item.text };
        segments.push(current);
      }
    }
    return {
      segments: segments.map(({ x, text }) => ({ x, text })),
      text: segments.map((s) => s.text).join(" "),
    };
  });
}

/**
 * Extract every page of a PDF (as a Uint8Array) into visual text lines,
 * top-to-bottom, pages concatenated in order.
 */
export async function extractPdfLines(data) {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");

  // Spawn the pdf.js worker through webpack's first-class worker syntax —
  // it compiles the worker into a same-origin chunk that loads correctly in
  // both dev and prod. (The `workerSrc` string alternative points at a raw
  // .mjs static asset, which dev servers may serve with a MIME type module
  // workers refuse.) If Worker creation itself is blocked (CSP), fall back
  // to pdf.js's main-thread "fake worker" via workerSrc.
  let worker = null;
  let pdfWorker;
  try {
    worker = new Worker(
      new URL("pdfjs-dist/legacy/build/pdf.worker.min.mjs", import.meta.url),
      { type: "module" }
    );
    pdfWorker = new pdfjs.PDFWorker({ port: worker });
  } catch (err) {
    worker = null;
    pdfWorker = undefined;
    if (!pdfjs.GlobalWorkerOptions.workerSrc) {
      pdfjs.GlobalWorkerOptions.workerSrc = new URL(
        "pdfjs-dist/legacy/build/pdf.worker.min.mjs",
        import.meta.url
      ).toString();
    }
  }

  const loadingTask = pdfjs.getDocument({
    data,
    isEvalSupported: false,
    worker: pdfWorker,
  });
  try {
    const doc = await loadingTask.promise;
    const lines = [];
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      const content = await page.getTextContent();
      lines.push(...linesFromItems(content.items));
      page.cleanup();
    }
    return lines;
  } finally {
    // Cleanup must never turn a successful extraction into an error (pdfjs
    // v6 has no PDFDocumentProxy.destroy(); teardown lives on the loading
    // task). Worst case a failed teardown leaks until page unload.
    try {
      await loadingTask.destroy();
    } catch {
      /* ignore */
    }
    worker?.terminate();
  }
}
