"use client";
import { useState } from "react";
import { RotateCw, ZoomIn, ZoomOut, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";

/** The original upload next to the extracted fields: PDFs in a frame, images with zoom and rotate. */
export function Preview({ url, contentType }: { url: string; contentType: string }) {
  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState(0);
  if (contentType === "application/pdf") {
    return (
      <div className="space-y-2">
        <iframe src={url} title="Original prescription (PDF). Use the viewer's own controls to change page or zoom." className="h-[70vh] w-full rounded-xl border-2" />
        <a href={url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 font-semibold underline">
          <ExternalLink aria-hidden="true" className="size-4" /> Open the PDF in a new tab <span className="sr-only">(opens in a new tab)</span>
        </a>
      </div>
    );
  }
  return (
    <div className="space-y-2">
      <div role="group" aria-label="Prescription image controls" className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" onClick={() => setZoom((z) => Math.min(4, z + 0.25))}><ZoomIn aria-hidden="true" /> Zoom in</Button>
        <Button type="button" variant="outline" onClick={() => setZoom((z) => Math.max(0.5, z - 0.25))}><ZoomOut aria-hidden="true" /> Zoom out</Button>
        <Button type="button" variant="outline" onClick={() => setRotation((r) => (r + 90) % 360)}><RotateCw aria-hidden="true" /> Rotate</Button>
      </div>
      <p className="text-sm text-muted-foreground" aria-live="polite">Zoom {Math.round(zoom * 100)}%, rotated {rotation} degrees</p>
      <div className="max-h-[70vh] overflow-auto rounded-xl border-2 bg-muted" tabIndex={0} aria-label="Prescription image. Scroll to move around.">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={url} alt="The uploaded prescription" style={{ width: `${zoom * 100}%`, transform: `rotate(${rotation}deg)`, transformOrigin: "center" }} className="max-w-none" />
      </div>
    </div>
  );
}
