import { Component, ElementRef, ViewChild, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf';
import jsPDF from 'jspdf';

type Coord = {
  page: number;
  x: number;
  y: number;
  value: string;
  size: number;
  color: string;
};

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './app.html',
  styleUrls: ['./app.scss'],
})
export class AppComponent {
  jsonInput = signal<string>('');
  pdfName = signal<string>('output.pdf');
  pdfDoc: PDFDocumentProxy | null = null;
  pageIndex = signal(1);
  scale = signal(1.2);

  @ViewChild('pdfCanvas', { static: false }) pdfCanvasRef?: ElementRef<HTMLCanvasElement>;
  @ViewChild('annotationsLayer', { static: false })
  annotationsLayerRef?: ElementRef<HTMLDivElement>;

  constructor() {
    (pdfjsLib as any).GlobalWorkerOptions.workerSrc = '/js/pdfjs/pdf.worker.min.mjs';
  }

  get pdfNameValue() {
    return this.pdfName();
  }
  set pdfNameValue(val: string) {
    this.pdfName.set(val);
  }

  get jsonInputValue() {
    return this.jsonInput();
  }
  set jsonInputValue(val: string) {
    this.jsonInput.set(val);
  }

  async onFileSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;

    const buf = await file.arrayBuffer();
    const loadingTask = pdfjsLib.getDocument({ data: buf });
    this.pdfDoc = await loadingTask.promise;

    this.pageIndex.set(1);
    await this.render();
  }

  async render() {
    if (!this.pdfDoc) return;
    const page: PDFPageProxy = await this.pdfDoc.getPage(this.pageIndex());
    const viewport = page.getViewport({ scale: this.scale() });

    const canvas = this.pdfCanvasRef?.nativeElement;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    await page.render({ canvasContext: ctx, canvas, viewport }).promise;

    this.drawAnnotations();
  }

  drawAnnotations() {
    const layer = this.annotationsLayerRef?.nativeElement;
    if (!layer || !this.pdfDoc) return;
    layer.innerHTML = '';

    let coords: Coord[] = [];
    try {
      coords = JSON.parse(this.jsonInput());
    } catch {
      return;
    }

    const scale = this.scale();
    this.pdfDoc.getPage(this.pageIndex()).then((page) => {
      const viewport = page.getViewport({ scale });

      coords
        .filter((c) => c.page === this.pageIndex())
        .forEach((c) => {
          const left = c.x * scale;
          // ✅ invertimos Y igual que en el anotador original
          const top = viewport.height - c.y * scale;

          const el = document.createElement('div');
          el.className = 'annotation';
          el.textContent = c.value;
          el.style.position = 'absolute';
          el.style.left = `${left}px`;
          el.style.top = `${top - c.size}px`; // desplazamos por el tamaño del texto
          el.style.fontSize = `${c.size}px`;
          el.style.color = c.color;

          layer.appendChild(el);
        });
    });
  }

  async prevPage() {
    if (this.pageIndex() > 1) {
      this.pageIndex.update((v) => v - 1);
      await this.render();
    }
  }
  async nextPage() {
    if (this.pdfDoc && this.pageIndex() < this.pdfDoc.numPages) {
      this.pageIndex.update((v) => v + 1);
      await this.render();
    }
  }

  async generatePDF() {
    if (!this.pdfDoc) {
      alert('Sube un PDF primero');
      return;
    }

    let coords: Coord[] = [];
    try {
      coords = JSON.parse(this.jsonInput());
    } catch {
      alert('JSON inválido');
      return;
    }

    const exportScale = 1;

    const firstPage = await this.pdfDoc.getPage(1);
    const firstViewport = firstPage.getViewport({ scale: exportScale });
    const pdf = new jsPDF({
      unit: 'pt',
      format: [firstViewport.width, firstViewport.height],
    });

    for (let pageNum = 1; pageNum <= this.pdfDoc.numPages; pageNum++) {
      if (pageNum > 1) {
        const p = await this.pdfDoc.getPage(pageNum);
        const vp = p.getViewport({ scale: exportScale });
        pdf.addPage([vp.width, vp.height]);
      }

      const page = await this.pdfDoc.getPage(pageNum);
      const viewport = page.getViewport({ scale: exportScale });

      const tCanvas = document.createElement('canvas');
      const tCtx = tCanvas.getContext('2d')!;
      tCanvas.width = Math.floor(viewport.width);
      tCanvas.height = Math.floor(viewport.height);
      await page.render({ canvasContext: tCtx, canvas: tCanvas, viewport }).promise;

      const imgData = tCanvas.toDataURL('image/png');
      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();

      pdf.addImage(imgData, 'PNG', 0, 0, pageWidth, pageHeight);

      coords
        .filter((c) => c.page === pageNum)
        .forEach((c) => {
          pdf.setFontSize(c.size);
          pdf.setTextColor(c.color);
          const y = pageHeight - c.y;
          pdf.text(c.value, c.x, y, { baseline: 'bottom' });
        });
    }

    pdf.save(this.pdfName());
  }
}
