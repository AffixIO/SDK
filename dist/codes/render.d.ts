import type { CodeFormat } from "./types.js";
export declare const DEFAULT_BARCODE_SYMBOLOGIES: readonly ["code128", "pdf417", "datamatrix", "qrcode", "ean13", "ean8", "upca"];
export declare function renderQrSvg(content: string, ecLevel?: "L" | "M" | "Q" | "H"): Promise<string>;
export declare function renderQrPng(content: string, ecLevel?: "L" | "M" | "Q" | "H"): Promise<Buffer>;
export declare function renderBarcodeSvg(symbology: string, content: string): Promise<string>;
export declare function renderBarcodePng(symbology: string, content: string): Promise<Buffer>;
export declare function renderCode(kind: "qr" | "barcode", content: string, opts?: {
    symbology?: string;
    format?: CodeFormat;
    ecLevel?: "L" | "M" | "Q" | "H";
}): Promise<{
    svg?: string;
    png?: Buffer;
}>;
