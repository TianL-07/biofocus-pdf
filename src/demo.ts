import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
export async function createDemo() {
  const doc = await PDFDocument.create(),
    regular = await doc.embedFont(StandardFonts.TimesRoman),
    bold = await doc.embedFont(StandardFonts.TimesRomanBold),
    sans = await doc.embedFont(StandardFonts.Helvetica);
  doc.setTitle("Reading the immune landscape — BioFocus sample");
  doc.setAuthor("BioFocus");
  const figure = document.createElement("canvas");
  figure.width = 900;
  figure.height = 510;
  const ctx = figure.getContext("2d")!;
  ctx.fillStyle = "#f4f8f5";
  ctx.fillRect(0, 0, 900, 510);
  ctx.font = "bold 25px sans-serif";
  ctx.fillStyle = "#264f43";
  ctx.fillText("An illustrative immune cell landscape", 35, 45);
  let seed = 47;
  const rand = () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };
  const centers = [
    { x: 210, y: 200, c: "#38866b", label: "T cells" },
    { x: 600, y: 180, c: "#c99550", label: "B cells" },
    { x: 450, y: 360, c: "#718bb6", label: "Myeloid cells" },
  ];
  for (const group of centers) {
    for (let i = 0; i < 95; i++) {
      const angle = rand() * Math.PI * 2,
        radius = Math.sqrt(rand());
      ctx.fillStyle = group.c + "b8";
      ctx.beginPath();
      ctx.arc(
        group.x + Math.cos(angle) * radius * 115,
        group.y + Math.sin(angle) * radius * 70,
        4.5,
        0,
        Math.PI * 2,
      );
      ctx.fill();
    }
    ctx.font = "bold 23px sans-serif";
    ctx.fillStyle = group.c;
    ctx.fillText(group.label, group.x - 35, group.y + 95);
  }
  ctx.font = "20px sans-serif";
  ctx.fillStyle = "#73837b";
  ctx.fillText("Synthetic diagram / no experimental data", 35, 482);
  const png = await doc.embedPng(figure.toDataURL("image/png"));
  const page = doc.addPage([612, 792]);
  const dark = rgb(0.12, 0.2, 0.18),
    muted = rgb(0.4, 0.46, 0.43);
  page.drawText("BIOFOCUS  /  READING SAMPLE", {
    x: 48,
    y: 752,
    size: 9,
    font: sans,
    color: muted,
  });
  page.drawText("Reading the immune landscape", {
    x: 48,
    y: 710,
    size: 27,
    font: bold,
    color: dark,
  });
  page.drawText("A quiet workspace for a deeper understanding", {
    x: 48,
    y: 684,
    size: 14,
    font: regular,
    color: muted,
  });
  page.drawLine({
    start: { x: 48, y: 669 },
    end: { x: 564, y: 669 },
    thickness: 0.7,
    color: rgb(0.78, 0.83, 0.79),
  });
  const lines = [
    "Abstract",
    "Single-cell RNA sequencing reveals the diversity of immune cells.",
    "A transcriptome describes RNA expression in a particular cell state.",
    "T cells and B cells contribute to adaptive immunity through distinct",
    "antigen receptors. Macrophages support tissue homeostasis and repair.",
    "Understanding this heterogeneity requires careful quality control.",
    "",
    "01  Read one idea at a time",
    "Use the focus window to follow the text without losing your place.",
    "Press the up and down arrow keys to move between individual lines.",
    "The left and right arrow keys change how many lines remain bright.",
    "Select a biomedical term such as transcriptome to open the lookup menu.",
    "Highlights, notes, and vocabulary stay connected to this document.",
    "",
    "02  Keep the evidence in view",
    "Images remain visible while the surrounding text becomes quieter.",
    "The illustration below is synthetic and does not report a study result.",
  ];
  let y = 642;
  lines.forEach((line, i) => {
    if (line)
      page.drawText(line, {
        x: 48,
        y,
        size: i === 0 || i === 7 || i === 14 ? 13 : 11.5,
        font: i === 0 || i === 7 || i === 14 ? bold : regular,
        color: dark,
      });
    y -= 19;
  });
  page.drawImage(png, { x: 48, y: 83, width: 335, height: 190 });
  page.drawText(
    "Figure 1. Synthetic cell clusters for testing image protection.",
    { x: 48, y: 66, size: 9, font: regular, color: muted },
  );
  page.drawText("1", { x: 560, y: 35, size: 10, font: sans, color: muted });
  const page2 = doc.addPage([612, 792]);
  page2.drawText("From expression to interpretation", {
    x: 48,
    y: 735,
    size: 23,
    font: bold,
    color: dark,
  });
  page2.drawText("A two-column reading-order example", {
    x: 48,
    y: 708,
    size: 11,
    font: sans,
    color: muted,
  });
  const left = [
    "A note on cellular states",
    "Inflammation changes gene expression",
    "across multiple immune populations.",
    "Differential expression can suggest",
    "a pathway worth investigating.",
    "An association does not establish",
    "a causal mechanism on its own.",
    "",
    "Antigen presentation",
    "Dendritic cells can present antigens",
    "to T cells. Cytokines help coordinate",
    "immune responses across tissues.",
    "A clonotype groups cells by their",
    "antigen-receptor sequence features.",
    "",
    "Questions to carry forward",
    "What is the unit of observation?",
    "Does the evidence support the claim?",
    "Which confounders remain unresolved?",
  ];
  const right = [
    "Working with a paper",
    "Select a sentence to add a highlight.",
    "Attach a note to record your question",
    "or an interpretation of the evidence.",
    "Every vocabulary lookup is saved",
    "with its page and surrounding text.",
    "",
    "Make the workspace yours",
    "Switch between day and night themes.",
    "Adjust the dimming level to find",
    "a comfortable reading contrast.",
    "If a figure was missed, draw a",
    "protected region around the figure.",
    "",
    "A place for future conversations",
    "The GPT panel is prepared for a",
    "future service integration. No model",
    "responses are generated in this version.",
    "Your PDF stays inside your browser.",
  ];
  for (const [col, text] of [
    [48, left],
    [316, right],
  ] as const) {
    let yy = 675;
    text.forEach((line, i) => {
      if (line)
        page2.drawText(line, {
          x: col,
          y: yy,
          size: 11,
          font: i === 0 || i === 8 || i === 15 ? bold : regular,
          color: dark,
        });
      yy -= 22;
    });
  }
  page2.drawText("BioFocus sample / original educational demonstration", {
    x: 48,
    y: 45,
    size: 9,
    font: sans,
    color: muted,
  });
  page2.drawText("2", { x: 560, y: 35, size: 10, font: sans, color: muted });
  return doc.save();
}
