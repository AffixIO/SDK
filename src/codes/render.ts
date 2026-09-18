/* Credit: @paparichens */
import QRCode from "qrcode";
import bwipjs from "bwip-js";
import type { CodeFormat } from "./types.js";
export const DEFAULT_BARCODE_SYMBOLOGIES = [
    "code128",
    "pdf417",
    "datamatrix",
    "qrcode",
    "ean13",
    "ean8",
    "upca",
];
export async function renderQrSvg(content: string, ecLevel?: "L" | "M" | "Q" | "H"): Promise<string> {
    return QRCode.toString(content, {
        type: "svg",
        errorCorrectionLevel: ecLevel,
        margin: 2,
        width: 256,
    });
}
export async function renderQrPng(content: string, ecLevel?: "L" | "M" | "Q" | "H"): Promise<Buffer> {
    return QRCode.toBuffer(content, {
        type: "png",
        errorCorrectionLevel: ecLevel,
        margin: 2,
        width: 512,
    });
}
export async function renderBarcodeSvg(symbology: string, content: string): Promise<string> {
    const bcid = symbology === "qrcode" ? "qrcode" : symbology;
    const opts: any = {
        bcid,
        text: content,
        scale: bcid === "pdf417" ? 2 : 3,
        height: bcid === "pdf417" ? 8 : 12,
        includetext: bcid !== "qrcode" && bcid !== "datamatrix",
        textxalign: "center",
    };
    if (bcid === "pdf417")
        opts.columns = 10;
    return bwipjs.toSVG(opts);
}
export async function renderBarcodePng(symbology: string, content: string): Promise<Buffer> {
    const bcid = symbology === "qrcode" ? "qrcode" : symbology;
    const opts: any = {
        bcid,
        text: content,
        scale: bcid === "pdf417" ? 2 : 3,
        height: bcid === "pdf417" ? 8 : 12,
        includetext: bcid !== "qrcode" && bcid !== "datamatrix",
        textxalign: "center",
    };
    if (bcid === "pdf417")
        opts.columns = 10;
    const buf = await bwipjs.toBuffer(opts);
    return Buffer.from(buf);
}
export async function renderCode(kind: "qr" | "barcode", content: string, opts?: {
    symbology?: string;
    format?: CodeFormat;
    ecLevel?: "L" | "M" | "Q" | "H";
}): Promise<{
    svg?: string;
    png?: Buffer;
}> {
    const format = opts?.format ?? "svg";
    const ecLevel = opts?.ecLevel ?? "L";
    if (kind === "qr") {
        if (format === "svg") {
            return { svg: await renderQrSvg(content, ecLevel) };
        }
        return { png: await renderQrPng(content, ecLevel) };
    }
    const sym = opts?.symbology ?? "code128";
    if (format === "svg") {
        return { svg: await renderBarcodeSvg(sym, content) };
    }
    return { png: await renderBarcodePng(sym, content) };
}
