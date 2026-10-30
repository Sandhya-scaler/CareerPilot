import mammoth from "mammoth";
import { extractText, getDocumentProxy } from "unpdf";
import { HttpError } from "../http.js";

export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

/** Converts an uploaded resume (PDF, DOCX, TXT/MD) to plain text with line structure preserved. */
export async function fileToText(buf: Buffer, filename: string, mimetype = ""): Promise<string> {
  const ext = filename.toLowerCase().split(".").pop() ?? "";
  let text: string;
  if (ext === "pdf" || mimetype === "application/pdf") {
    const pdf = await getDocumentProxy(new Uint8Array(buf));
    const out = await extractText(pdf, { mergePages: true });
    text = Array.isArray(out.text) ? out.text.join("\n") : out.text;
  } else if (ext === "docx" || mimetype.includes("wordprocessingml")) {
    text = (await mammoth.extractRawText({ buffer: buf })).value;
  } else if (["txt", "md", "text"].includes(ext) || mimetype.startsWith("text/")) {
    text = buf.toString("utf8");
  } else {
    throw new HttpError(415, "unsupported file type: upload a PDF, DOCX or TXT");
  }
  text = cleanText(text);
  if (text.replace(/\s/g, "").length < 50) {
    throw new HttpError(422, "could not read text from this file (is it a scanned image?). Try a text-based PDF or DOCX.");
  }
  return text;
}

export function cleanText(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/[   ]/g, " ")
    .replace(/[​-‍﻿]/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .split("\n")
    .map((l) => l.trim())
    .join("\n")
    .trim();
}

export const BULLET_RE = /^\s*(?:[•●▪◦‣∙·*\-–—►>✓✔➢➤]|\d{1,2}[.)])\s+/;
export const stripBullet = (l: string) => l.replace(BULLET_RE, "").trim();

/**
 * Joins hard-wrapped lines (common in PDF extraction) back into logical lines: a line continues the
 * previous one when it isn't a bullet and the previous line didn't end a sentence, or it starts lowercase.
 */
export function logicalLines(lines: string[], isHeading: (l: string) => boolean): string[] {
  const out: string[] = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    const prev = out[out.length - 1];
    const continues =
      prev !== undefined &&
      !BULLET_RE.test(line) &&
      !isHeading(line) &&
      !isHeading(prev) &&
      !/@|^(https?:|www\.)|^[\w-]+\.(com|dev|io|in|me|ai|app)\b/i.test(line) && // contact lines stand alone
      (/^[a-z(&]/.test(line) || (BULLET_RE.test(prev) && !/[.!?:;]$/.test(prev) && prev.length > 60));
    if (continues) out[out.length - 1] = `${prev} ${line}`;
    else out.push(line);
  }
  return out;
}

const URL_RE = /\b(?:https?:\/\/)?(?:www\.)?(?:github\.com|gitlab\.com|linkedin\.com|kaggle\.com|huggingface\.co|[a-z0-9-]+\.(?:dev|io|app|me|ai|com|org|net|in))\/[^\s,;)\]]*/gi;

export function findLinks(text: string): string[] {
  return [...new Set([...text.matchAll(URL_RE)].map((m) => m[0].replace(/[.)]+$/, "")))];
}

/**
 * Quantified outcomes: percentages, multipliers, counts with units, ML metrics.
 * Years (2019-2029) and date ranges are ignored.
 */
const METRIC_RE =
  /(?:\b\d+(?:\.\d+)?\s*(?:%|x\b|×|k\+?\b|K\+?\b|M\+?\b|ms\b|fps\b|qps\b|rps\b|lakh|crore|users|customers|requests|downloads|stars|images|samples|hours|hrs|minutes|mins|seconds|days|weeks|points|pts)|(?:mAP|IoU|F1|AUC|BLEU|accuracy|precision|recall|latency|throughput|top-?[15])\s*(?:of|:|=|to|by)?\s*~?\d+(?:\.\d+)?%?|\b\d+(?:\.\d+)?%?\s*(?:mAP|IoU|F1|AUC|accuracy|precision|recall)|\b(?:rank(?:ed)?|top)\s*#?\d+|\$\s?\d[\d,.]*\s*[kKmM]?|₹\s?\d[\d,.]*)/g;

// Scale: "120 stores", "40 analysts", "9,000 listings", "from 54 to 91".
const SCALE_RE =
  /\b\d[\d,.]*\+?\s+(?:[a-z]+\s+)?(?:users|analysts|customers|stores|teams|engineers|students|businesses|clients|members|people|merchants|listings|records|rows|transactions|orders|services|repos|apis|endpoints|countries|cities|problems|questions|commits|contributors|pull requests|prs)\b|\b\d{1,3}(?:,\d{3})+\+?|\bfrom\s+\d+(?:\.\d+)?%?\s+to\s+\d+(?:\.\d+)?%?/gi;

export function findMetrics(text: string): string[] {
  const all = [...text.matchAll(METRIC_RE), ...text.matchAll(SCALE_RE)].map((m) => m[0].trim());
  return [...new Set(all)].filter((m) => !/^(19|20)\d{2}$/.test(m));
}

const SHIPPED_RE = /\b(deployed|in production|production[- ]grade|shipped|launched|live at|serving|served|open[- ]sourced|published|merged|adopted by|used by|released)\b/i;
export const hasShippedSignal = (text: string) => SHIPPED_RE.test(text);
