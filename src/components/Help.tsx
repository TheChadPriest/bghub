const FAQ: { q: string; a: string }[] = [
  { q: 'Are my photos uploaded anywhere?', a: 'No. BGhub runs the AI model inside your browser. Your images are decoded, analysed and exported on your device and are never sent to a server. The only downloads are the app itself and the AI model, which is cached after the first visit.' },
  { q: 'Why does the first image take longer?', a: 'The first time, your browser downloads the AI model (about 115 MB) and the runtime. After that they come from the browser cache, so later images start right away.' },
  { q: 'How fast is it?', a: 'It depends on your device. With WebGPU (recent Chrome, Edge or Safari) expect roughly 5–20 seconds per photo; laptops with integrated graphics are at the slower end. Without WebGPU the model runs on the CPU: about 15–40 seconds per photo on a modern laptop, longer on older devices. Decoding and exporting run in parallel while the model works, and you can keep adding photos.' },
  { q: 'Is the output the same size as my photo?', a: 'Yes. The model looks at a 1024×1024 copy, but its mask is scaled back up and applied to your original full-resolution pixels. The PNG has exactly the same width and height as the decoded photo, and the card shows “Resized: No” to confirm it.' },
  { q: 'Does BGhub change my product?', a: 'No. BGhub only decides which pixels are transparent. It never repaints, regenerates, sharpens or recolours the item, and there is no generative AI involved.' },
  { q: 'Do iPhone HEIC photos work?', a: 'Yes. HEIC/HEIF files are decoded in the browser (natively in Safari, with a bundled decoder elsewhere). Rotation is respected. If a HEIF file contains several images, the primary one is processed and you are told about it.' },
  { q: 'The cutout missed a part or kept some background.', a: 'Open “Refine” on the result. Paint with Restore to bring back missing parts or Erase to remove leftovers. Edits only change transparency, never the photo itself. Dark items on dark backgrounds and see-through objects such as glass are the hardest cases.' },
  { q: 'How do I get many images at once?', a: 'Drop or select as many photos as you like and keep adding more while they process. When they are done, use “Download all” for a ZIP, or tick specific cards and use “ZIP selected”.' },
  { q: 'What is the size limit?', a: 'There is no fixed file-size limit; instead BGhub checks the pixel count so the browser does not run out of memory. The default is about 50 megapixels on desktop and 16 megapixels on iPhone/iPad.' },
  { q: 'Which browsers are supported?', a: 'Current versions of Chrome, Edge, Firefox and Safari. WebGPU (fast mode) is available in recent Chrome and Edge and some other browsers; everything else uses the CPU automatically.' },
  { q: 'Can I use the results commercially?', a: 'Your images are yours. The AI model (BiRefNet, MIT licence) permits commercial use. See the project README for full licence details.' },
];

export function Help() {
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="font-display text-3xl font-semibold tracking-tight">Help & FAQ</h1>
        <p className="mt-1 text-muted">Upload. Remove. Replace. Download.</p>
      </div>
      <ol className="grid gap-3 sm:grid-cols-4">
        {['Drop photos into the workspace', 'Wait for the cutout — on your device', 'Optionally place it on a new background', 'Download PNGs or a ZIP'].map((s, i) => (
          <li key={s} className="rounded-xl border border-line bg-panel p-3 text-sm"><span className="mb-1 block font-display text-2xl font-semibold">{i + 1}</span>{s}</li>
        ))}
      </ol>
      <div className="divide-y divide-line rounded-2xl border border-line bg-panel">
        {FAQ.map(f => (
          <details key={f.q} className="group p-4">
            <summary className="cursor-pointer list-none font-medium marker:hidden">
              <span className="mr-2 inline-block transition group-open:rotate-90">›</span>{f.q}
            </summary>
            <p className="mt-2 pl-5 text-sm text-muted">{f.a}</p>
          </details>
        ))}
      </div>
      <p className="text-[12px] text-muted">
        Segmentation model: BiRefNet-lite (MIT) by Peng Zheng et al., ONNX export by onnx-community. Runtime: ONNX Runtime Web (MIT).
        HEIC decoding: libheif (LGPL-3.0). Background textures are generated procedurally by BGhub.
      </p>
    </div>
  );
}
